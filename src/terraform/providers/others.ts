import { ARTIFACTS } from "../../paths.js";
import { KitError } from "../../errors.js";
import type { PhysicalFunction } from "../../types.js";
import { q } from "../../util/hcl.js";
import { bucketName, cloudName } from "../../util/hash.js";
import { normalizeSchedule } from "../../util/schedule.js";
import {
  envBlock,
  envExpressions,
  fileHeader,
  functionName,
  httpInvokeTargets,
  outputMap,
  randomProvider,
  randomTokenResource,
  runnerFunction,
  tokenExtra,
  type RenderContext,
  urlMapExpression,
  versions,
  workflowOutputs,
} from "../support.js";

export function renderCloudflare(ctx: RenderContext): Record<string, string> {
  const account = ctx.config.provider.cloudflare?.accountId ?? "";
  const subdomain = ctx.config.provider.cloudflare?.workersDevSubdomain;
  const extras = ctx.plan.needsInvokeToken ? [randomProvider()] : [];
  const blocks: string[] = [
    fileHeader(ctx.config),
    versions("cloudflare/cloudflare", "~> 5.0", extras),
    randomTokenResource(ctx.plan),
    `provider "cloudflare" {\n  # CLOUDFLARE_API_TOKEN supplies credentials.\n}\n`,
  ];
  const queues = new Map<string, string>();
  for (const fn of ctx.plan.functions) {
    for (const event of fn.events) {
      if (event.type === "queue" && event.queue.name && event.queue.create) queues.set(event.queue.name, event.queue.name);
    }
  }
  for (const name of queues.values()) {
    blocks.push(`resource "cloudflare_queue" "${safe(name)}" {
  account_id = ${q(account)}
  queue_name = ${q(cloudName([ctx.config.service, ctx.config.provider.stage, name]))}
}
`);
  }
  for (const fn of ctx.plan.functions) blocks.push(worker(ctx, fn, account, subdomain));
  blocks.push(outputs(ctx, (fn) => workerUrl(ctx, fn, subdomain)));
  return { "main.tf": blocks.join("\n") };
}

function worker(ctx: RenderContext, fn: PhysicalFunction, account: string, subdomain: string | undefined): string {
  const script = functionName(ctx.config, fn);
  const file = ARTIFACTS.worker(fn.physicalName);
  const extra = { ...tokenExtra(ctx.plan) };
  const runner = runnerFunction(ctx.plan);
  if (runner && runner.tfId === fn.tfId && subdomain) {
    extra.SK_FUNCTION_URL_MAP = urlMapExpression(
      httpInvokeTargets(ctx.plan).map((target) => [
        target.logicalName,
        q(`https://${functionName(ctx.config, target)}.${subdomain}.workers.dev/__sk/invoke/${target.logicalName}`),
      ]),
    );
  }
  const bindings = Object.entries(envExpressions(ctx.config, fn, extra)).map(([key, value]) => {
    return `    {\n      type = "plain_text"\n      name = ${q(key)}\n      text = ${value}\n    }`;
  });
  const schedules = fn.events.filter((event) => event.type === "schedule");
  const cron = schedules.length
    ? `resource "cloudflare_workers_cron_trigger" "${fn.tfId}" {
  account_id  = ${q(account)}
  script_name = cloudflare_workers_script.${fn.tfId}.script_name
  schedules = [
${schedules
  .map((event) => {
    if (event.type !== "schedule") return "";
    return `    { cron = ${q(normalizeSchedule(event.schedule.expression, event.schedule.timezone).unix)} }`;
  })
  .join(",\n")}
  ]
}
`
    : "";
  const consumers = fn.events
    .filter((event) => event.type === "queue" && event.queue.name)
    .map((event, index) => {
      if (event.type !== "queue" || !event.queue.name) return "";
      const queue = event.queue.create ? `cloudflare_queue.${safe(event.queue.name)}.id` : q(event.queue.name);
      return `resource "cloudflare_queue_consumer" "${fn.tfId}_${index}" {
  account_id  = ${q(account)}
  queue_id    = ${queue}
  script_name = cloudflare_workers_script.${fn.tfId}.script_name
  type        = "worker"
  settings = {
    batch_size = ${event.queue.batchSize}
  }
}
`;
    })
    .join("\n");
  const zone = ctx.config.provider.cloudflare?.zoneId;
  const pattern = ctx.config.provider.cloudflare?.routePattern;
  const route =
    zone && pattern
      ? `resource "cloudflare_workers_route" "${fn.tfId}" {
  zone_id = ${q(zone)}
  pattern = ${q(pattern)}
  script  = cloudflare_workers_script.${fn.tfId}.script_name
}
`
      : "";
  return `resource "cloudflare_workers_script" "${fn.tfId}" {
  account_id         = ${q(account)}
  script_name        = ${q(script)}
  content_file       = "\${path.module}/${file}"
  content_sha256     = filesha256("\${path.module}/${file}")
  main_module        = ${q(`${fn.physicalName}.mjs`)}
  compatibility_date = "2026-01-01"
  compatibility_flags = ["nodejs_compat"]
  bindings = [
${bindings.join(",\n")}
  ]
}
${cron}${consumers}${route}`;
}

export function renderAlibaba(ctx: RenderContext): Record<string, string> {
  const role = ctx.config.provider.alibaba?.roleArn;
  const bucket = bucketName(ctx.config.service, ctx.config.provider.stage, "code");
  const head = [
    fileHeader(ctx.config),
    versions("aliyun/alicloud", "~> 1.240", ctx.plan.needsInvokeToken ? [randomProvider()] : []),
    randomTokenResource(ctx.plan),
    `provider "alicloud" {\n  region = ${q(ctx.config.provider.region)}\n}\n`,
    `data "alicloud_account" "current" {}\n`,
    `resource "alicloud_oss_bucket" "code" {\n  bucket = ${q(bucket)}\n}\n`,
  ];
  const shared: string[] = [];
  const queues = new Map<string, string>();
  const topics = new Map<string, string>();
  const buckets = new Map<string, string>();
  const functions: string[] = [];
  for (const fn of ctx.plan.functions) {
    const name = functionName(ctx.config, fn);
    const triggers = fn.events
      .map((event, index) => alibabaTrigger(ctx, fn, event, index, { shared, queues, topics, buckets }))
      .join("\n");
    functions.push(`resource "alicloud_oss_bucket_object" "${fn.tfId}" {
  bucket = alicloud_oss_bucket.code.bucket
  key    = ${q(`${name}.zip`)}
  source = "\${path.module}/${ARTIFACTS.zip(fn.physicalName)}"
}

resource "alicloud_fcv3_function" "${fn.tfId}" {
  function_name = ${q(name)}
  description   = ${q(fn.description ?? fn.logicalName)}
  runtime       = ${q(fn.providerRuntime)}
  handler       = "index.handler"
  memory_size   = ${q(String(fn.memory))}
  timeout       = ${q(String(fn.timeout))}
  disk_size     = "512"
  role          = ${role ? q(role) : "null"}
  code {
    oss_bucket_name = alicloud_oss_bucket.code.bucket
    oss_object_name = alicloud_oss_bucket_object.${fn.tfId}.key
  }
  environment_variables = ${envBlock(envExpressions(ctx.config, fn, tokenExtra(ctx.plan)), 4)}
}
${triggers}
`);
  }
  return { "main.tf": [...head, ...shared, ...functions, outputs(ctx, () => "null")].join("\n") };
}

interface AliSide {
  shared: string[];
  queues: Map<string, string>;
  topics: Map<string, string>;
  buckets: Map<string, string>;
}

function alibabaTrigger(
  ctx: RenderContext,
  fn: PhysicalFunction,
  event: PhysicalFunction["events"][number],
  index: number,
  side: AliSide,
): string {
  const role = ctx.config.provider.alibaba?.roleArn ?? "";
  if (event.type === "http") {
    const methods =
      event.http.method === "ANY"
        ? ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
        : [event.http.method];
    return fcTrigger(fn, index, "http", {
      authType: event.http.auth === "public" ? "anonymous" : "function",
      methods,
    });
  }
  if (event.type === "schedule") {
    const cron = normalizeSchedule(event.schedule.expression, event.schedule.timezone).seconds;
    return fcTrigger(fn, index, "timer", { cronExpression: cron, enable: true, payload: "schedule" });
  }
  if (event.type === "queue") {
    const queueName = alibabaName(ctx, event.queue.name, event.queue.create, "queue");
    if (event.queue.create) remember(side.queues, side.shared, queueName, (id) => `resource "alicloud_message_service_queue" "${id}" {\n  queue_name = ${q(queueName)}\n}\n`);
    return fcTrigger(
      fn,
      index,
      "eventbridge",
      {
        triggerEnable: true,
        eventSourceConfig: {
          eventSourceType: "MNS",
          eventSourceParameters: { sourceMNSParameters: { QueueName: queueName, IsBase64Decode: false } },
        },
      },
      role,
      mnsArn(ctx, "queues", queueName),
    );
  }
  if (event.type === "topic") {
    const topicName = alibabaName(ctx, event.topic.name, event.topic.create, "topic");
    if (event.topic.create) remember(side.topics, side.shared, topicName, (id) => `resource "alicloud_message_service_topic" "${id}" {\n  topic_name = ${q(topicName)}\n}\n`);
    return fcTrigger(
      fn,
      index,
      "mns_topic",
      { notifyContentFormat: "JSON", notifyStrategy: "BACKOFF_RETRY" },
      role,
      event.topic.arn ? q(event.topic.arn) : mnsArn(ctx, "topics", topicName),
    );
  }
  if (event.type === "storage") {
    const created = event.storage.create ? bucketName(ctx.config.service, ctx.config.provider.stage, event.storage.bucket) : event.storage.bucket;
    if (event.storage.create) remember(side.buckets, side.shared, created, (id) => `resource "alicloud_oss_bucket" "${id}" {\n  bucket = ${q(created)}\n}\n`);
    const events = event.storage.events.map((item) => (item === "deleted" ? "oss:ObjectRemoved:*" : "oss:ObjectCreated:*"));
    return fcTrigger(
      fn,
      index,
      "oss",
      { events, filter: { key: { prefix: event.storage.prefix ?? "", suffix: event.storage.suffix ?? "" } } },
      role,
      `"acs:oss:${ctx.config.provider.region}:\${data.alicloud_account.current.id}:${created}"`,
    );
  }
  return "";
}

function fcTrigger(
  fn: PhysicalFunction,
  index: number,
  type: string,
  config: unknown,
  role?: string,
  sourceArn?: string,
): string {
  const roleLine = role ? `  invocation_role = ${q(role)}\n` : "";
  const sourceLine = sourceArn ? `  source_arn      = ${sourceArn}\n` : "";
  return `resource "alicloud_fcv3_trigger" "${fn.tfId}_${index}" {
  function_name  = alicloud_fcv3_function.${fn.tfId}.function_name
  trigger_name   = ${q(`${type}-${index}`)}
  trigger_type   = ${q(type)}
  qualifier      = "LATEST"
${roleLine}${sourceLine}  trigger_config = ${q(JSON.stringify(config))}
}
`;
}

function mnsArn(ctx: RenderContext, kind: "queues" | "topics", name: string): string {
  return `"acs:mns:${ctx.config.provider.region}:\${data.alicloud_account.current.id}:/${kind}/${name}"`;
}

function alibabaName(ctx: RenderContext, name: string | undefined, create: boolean, kind: string): string {
  if (!name) {
    throw new KitError(
      `Alibaba Cloud ${kind} triggers need a name. Set ${kind}.name so Function Compute can subscribe. An ARN by itself is not enough.`,
    );
  }
  return create ? cloudName([ctx.config.service, ctx.config.provider.stage, name], 120) : name;
}

function remember(seen: Map<string, string>, blocks: string[], name: string, render: (id: string) => string): void {
  if (seen.has(name)) return;
  const id = safe(name);
  seen.set(name, id);
  blocks.push(render(id));
}

export function renderIbm(ctx: RenderContext): Record<string, string> {
  const namespace = ctx.config.provider.ibm?.namespace ?? "";
  const blocks = [
    fileHeader(ctx.config),
    versions("IBM-Cloud/ibm", "~> 1.70", ctx.plan.needsInvokeToken ? [randomProvider()] : []),
    randomTokenResource(ctx.plan),
    `provider "ibm" {\n  region = ${q(ctx.config.provider.region)}\n}\n`,
  ];
  for (const fn of ctx.plan.functions) {
    const limits = `  limits {\n    timeout = ${fn.timeout * 1000}\n    memory  = ${fn.memory}\n  }\n`;
    const web = fn.events.some((event) => event.type === "http") || fn.events.length === 0;
    const annotations = web
      ? `  user_defined_annotations = ${q(JSON.stringify([{ key: "web-export", value: true }, { key: "require-whisk-auth", value: false }]))}\n`
      : "";
    blocks.push(`resource "ibm_function_action" "${fn.tfId}" {
  name      = ${q(functionName(ctx.config, fn))}
  namespace = ${q(namespace)}
${limits}${annotations}  exec {
    kind      = ${q(fn.providerRuntime)}
    code_path = "\${path.module}/${ARTIFACTS.ibmZip(fn.physicalName)}"
    main      = "main"
  }
}
`);
    fn.events.forEach((event, index) => {
      if (event.type !== "schedule") return;
      const cron = normalizeSchedule(event.schedule.expression, event.schedule.timezone).unix;
      blocks.push(`resource "ibm_function_trigger" "${fn.tfId}_${index}" {
  name      = ${q(`${functionName(ctx.config, fn)}-tick-${index}`)}
  namespace = ${q(namespace)}
  feed {
    name = "/whisk.system/alarms/alarm"
    parameters = ${q(JSON.stringify([{ key: "cron", value: cron }]))}
  }
}

resource "ibm_function_rule" "${fn.tfId}_${index}" {
  name         = ${q(`${functionName(ctx.config, fn)}-rule-${index}`)}
  namespace    = ${q(namespace)}
  trigger_name = ibm_function_trigger.${fn.tfId}_${index}.name
  action_name  = ibm_function_action.${fn.tfId}.name
}
`);
    });
  }
  const region = ctx.config.provider.region;
  blocks.push(
    outputs(ctx, (fn) =>
      q(`https://${region}.functions.appdomain.cloud/api/v1/web/${encodeURIComponent(namespace)}/default/${functionName(ctx.config, fn)}`),
    ),
  );
  return { "main.tf": blocks.join("\n") };
}

export function renderOracle(ctx: RenderContext): Record<string, string> {
  const oracle = ctx.config.provider.oracle;
  const blocks = [
    fileHeader(ctx.config),
    versions("oracle/oci", "~> 6.0", ctx.plan.needsInvokeToken ? [randomProvider()] : []),
    randomTokenResource(ctx.plan),
    `provider "oci" {\n  region = ${q(ctx.config.provider.region)}\n}\n`,
    `resource "oci_functions_application" "app" {
  compartment_id = ${q(oracle?.compartmentId ?? "")}
  display_name   = ${q(cloudName([ctx.config.service, ctx.config.provider.stage]))}
  subnet_ids     = [${(oracle?.subnetIds ?? []).map((id) => q(id)).join(", ")}]
}
`,
  ];
  for (const fn of ctx.plan.functions) {
    const image = oracle?.image ? q(oracle.image) : q("");
    blocks.push(`# Image context: \${path.module}/${ARTIFACTS.oracleDir(fn.physicalName)}
# Build and push the Dockerfile in that directory, then set provider.oracle.image.
resource "oci_functions_function" "${fn.tfId}" {
  application_id = oci_functions_application.app.id
  display_name   = ${q(functionName(ctx.config, fn))}
  memory_in_mbs  = ${fn.memory}
  image          = ${image}
  config = ${envBlock(
    envExpressions(ctx.config, fn, {
      ...tokenExtra(ctx.plan),
      PORT: q("8080"),
    }),
    4,
  )}
}
`);
  }
  blocks.push(outputs(ctx, (fn) => `oci_functions_function.${fn.tfId}.invoke_endpoint`));
  return { "main.tf": blocks.join("\n") };
}

export function renderTencent(ctx: RenderContext): Record<string, string> {
  const head = [
    fileHeader(ctx.config),
    versions("tencentcloudstack/tencentcloud", "~> 1.81", ctx.plan.needsInvokeToken ? [randomProvider()] : []),
    randomTokenResource(ctx.plan),
    `provider "tencentcloud" {\n  region = ${q(ctx.config.provider.region)}\n}\n`,
  ];
  const shared: string[] = [];
  const queues = new Map<string, string>();
  const topics = new Map<string, string>();
  const buckets = new Map<string, string>();
  const functions: string[] = [];
  for (const fn of ctx.plan.functions) {
    const triggers = fn.events
      .map((event, index) => tencentTrigger(ctx, event, index, { shared, queues, topics, buckets }))
      .filter(Boolean)
      .join("\n");
    functions.push(`resource "tencentcloud_scf_function" "${fn.tfId}" {
  name     = ${q(functionName(ctx.config, fn))}
  handler  = "index.handler"
  runtime  = ${q(fn.providerRuntime)}
  mem_size = ${fn.memory}
  timeout  = ${fn.timeout}
  zip_file = filebase64("\${path.module}/${ARTIFACTS.zip(fn.physicalName)}")
${triggers}
  environment {
    variables = ${envBlock(envExpressions(ctx.config, fn, tokenExtra(ctx.plan)), 6)}
  }
}
`);
  }
  return { "main.tf": [...head, ...shared, ...functions, outputs(ctx, () => "null")].join("\n") };
}

interface TencentSide {
  shared: string[];
  queues: Map<string, string>;
  topics: Map<string, string>;
  buckets: Map<string, string>;
}

function tencentTrigger(
  ctx: RenderContext,
  event: PhysicalFunction["events"][number],
  index: number,
  side: TencentSide,
): string {
  if (event.type === "schedule") {
    const cron = tencentCron(event.schedule.expression, event.schedule.timezone);
    return `  triggers {
    name         = ${q(`timer-${index}`)}
    type         = "timer"
    trigger_desc = ${q(cron)}
  }`;
  }
  if (event.type === "http") {
    return `  triggers {
    name = ${q(`http-${index}`)}
    type = "apigw"
    trigger_desc = ${q(JSON.stringify({
      api: { authRequired: "FALSE", requestConfig: { method: event.http.method === "ANY" ? "ANY" : event.http.method, path: event.http.path }, isIntegratedResponse: "TRUE" },
      service: { serviceName: "SCF" },
      release: { environmentName: "release" },
    }))}
  }`;
  }
  if (event.type === "queue") {
    if (!event.queue.name) {
      throw new KitError("Tencent Cloud queue triggers need queue.name. TCMQ subscribes by queue name.");
    }
    const queueName = event.queue.create ? letterName([ctx.config.service, ctx.config.provider.stage, event.queue.name], 64) : event.queue.name;
    if (event.queue.create) {
      remember(side.queues, side.shared, queueName, (id) => `resource "tencentcloud_tcmq_queue" "${id}" {\n  queue_name = ${q(queueName)}\n}\n`);
    }
    return cmqTrigger(queueName);
  }
  if (event.type === "topic") {
    if (!event.topic.name) {
      throw new KitError("Tencent Cloud topic triggers need topic.name. TCMQ subscribes by topic name.");
    }
    const topicName = event.topic.create ? letterName([ctx.config.service, ctx.config.provider.stage, event.topic.name], 64) : event.topic.name;
    if (event.topic.create) {
      remember(side.topics, side.shared, topicName, (id) => `resource "tencentcloud_tcmq_topic" "${id}" {\n  topic_name = ${q(topicName)}\n}\n`);
    }
    return cmqTrigger(topicName);
  }
  if (event.type === "storage") {
    if (event.storage.events.length !== 1) {
      throw new KitError(
        "A Tencent COS trigger accepts one event string. Set storage.events to created or deleted, and split the other event onto its own function.",
      );
    }
    const bucketId = tencentBucketId(ctx, event.storage.bucket, event.storage.create);
    if (event.storage.create) {
      remember(side.buckets, side.shared, bucketId, (id) => `resource "tencentcloud_cos_bucket" "${id}" {\n  bucket = ${q(bucketId)}\n  acl    = "private"\n}\n`);
    }
    return event.storage.events
      .map((item) => {
        const cosEvent = item === "deleted" ? "cos:ObjectRemoved:*" : "cos:ObjectCreated:*";
        return `  triggers {
    name       = ${q(bucketId)}
    type       = "cos"
    cos_region = ${q(ctx.config.provider.region)}
    trigger_desc = ${q(JSON.stringify({ event: cosEvent, filter: { Prefix: event.storage.prefix ?? "", Suffix: event.storage.suffix ?? "" } }))}
  }`;
      })
      .join("\n");
  }
  return "";
}

function cmqTrigger(queueOrTopic: string): string {
  return `  triggers {
    name         = ${q(queueOrTopic)}
    type         = "cmq"
    trigger_desc = "{}"
  }`;
}

function tencentCron(expression: string, timezone: string): string {
  const seconds = normalizeSchedule(expression, timezone).seconds;
  const count = seconds.split(/\s+/).length;
  return count === 6 ? `${seconds} *` : seconds;
}

function tencentBucketId(ctx: RenderContext, bucket: string, create: boolean): string {
  const appId = ctx.config.provider.tencent?.appId;
  if (create) {
    if (!appId) {
      throw new KitError(
        "Creating a Tencent COS bucket needs provider.tencent.appId. COS bucket ids look like name-appid. Set appId, or set storage.create to false and pass the existing bucket id.",
      );
    }
    const room = Math.max(3, 63 - appId.length - 1);
    const base = bucketName(ctx.config.service, ctx.config.provider.stage, bucket).slice(0, room).replace(/-$/g, "");
    return `${base}-${appId}`;
  }
  if (appId && !bucket.endsWith(`-${appId}`)) return `${bucket}-${appId}`;
  return bucket;
}

function letterName(parts: string[], max: number): string {
  const name = cloudName(parts, max);
  return /^[a-z]/.test(name) ? name : `q-${name}`.slice(0, max);
}

export function renderHuawei(ctx: RenderContext): Record<string, string> {
  const agency = ctx.config.provider.huawei?.agency ?? "";
  const head = [
    fileHeader(ctx.config),
    versions("huaweicloud/huaweicloud", "~> 1.70", ctx.plan.needsInvokeToken ? [randomProvider()] : []),
    randomTokenResource(ctx.plan),
    `provider "huaweicloud" {\n  region = ${q(ctx.config.provider.region)}\n}\n`,
  ];
  const shared: string[] = [];
  const topics = new Map<string, string>();
  const buckets = new Map<string, string>();
  const functions: string[] = [];
  for (const fn of ctx.plan.functions) {
    functions.push(`resource "huaweicloud_fgs_function" "${fn.tfId}" {
  name          = ${q(functionName(ctx.config, fn))}
  agency        = ${q(agency)}
  handler       = "index.handler"
  runtime       = ${q(fn.providerRuntime)}
  memory_size   = ${fn.memory}
  timeout       = ${fn.timeout}
  app           = "default"
  code_type     = "zip"
  code_filename = "\${path.module}/${ARTIFACTS.zip(fn.physicalName)}"
  description   = ${q(fn.description ?? fn.logicalName)}
  user_data     = jsonencode(${envBlock(envExpressions(ctx.config, fn, tokenExtra(ctx.plan)), 4)})
}
`);
    fn.events.forEach((event, index) => {
      functions.push(huaweiTrigger(ctx, fn, event, index, { shared, topics, buckets }));
    });
  }
  return { "main.tf": [...head, ...shared, ...functions, outputs(ctx, (fn) => `huaweicloud_fgs_function.${fn.tfId}.urn`)].join("\n") };
}

interface HuaweiSide {
  shared: string[];
  topics: Map<string, string>;
  buckets: Map<string, string>;
}

function huaweiTrigger(
  ctx: RenderContext,
  fn: PhysicalFunction,
  event: PhysicalFunction["events"][number],
  index: number,
  side: HuaweiSide,
): string {
  if (event.type === "schedule") {
    const cron = normalizeSchedule(event.schedule.expression, event.schedule.timezone).seconds;
    return `resource "huaweicloud_fgs_function_trigger" "${fn.tfId}_${index}" {
  function_urn = huaweicloud_fgs_function.${fn.tfId}.urn
  type         = "TIMER"
  event_data   = jsonencode({
    name          = ${q(`timer-${index}`)}
    schedule_type = "Cron"
    schedule      = ${q(cron)}
    user_event    = "schedule"
  })
}
`;
  }
  if (event.type === "topic") {
    if (!event.topic.name && !event.topic.arn) {
      throw new KitError("Huawei topic triggers need topic.name or topic.arn.");
    }
    const topicName = event.topic.create && event.topic.name
      ? letterName([ctx.config.service, ctx.config.provider.stage, event.topic.name], 64)
      : event.topic.name;
    let urn = event.topic.arn ? q(event.topic.arn) : "";
    if (event.topic.create && topicName) {
      remember(side.topics, side.shared, topicName, (id) => `resource "huaweicloud_smn_topic" "${id}" {\n  name = ${q(topicName)}\n}\n`);
      urn = `huaweicloud_smn_topic.${safe(topicName)}.topic_urn`;
    }
    if (!urn) {
      throw new KitError("Huawei topic triggers that do not create a topic need topic.arn (the SMN topic URN).");
    }
    return `resource "huaweicloud_fgs_trigger" "${fn.tfId}_smn_${index}" {
  function_urn = huaweicloud_fgs_function.${fn.tfId}.urn
  type         = "SMN"
  status       = "ACTIVE"
  smn {
    topic_urn = ${urn}
  }
}
`;
  }
  if (event.type === "storage") {
    if (event.storage.prefix) {
      throw new KitError(
        "Huawei OBS triggers generated by serverless-kit filter with a suffix only. Remove storage.prefix or filter inside the handler.",
      );
    }
    const bucket = event.storage.create
      ? bucketName(ctx.config.service, ctx.config.provider.stage, event.storage.bucket)
      : event.storage.bucket;
    if (event.storage.create) {
      remember(side.buckets, side.shared, bucket, (id) => `resource "huaweicloud_obs_bucket" "${id}" {\n  bucket = ${q(bucket)}\n  acl    = "private"\n}\n`);
    }
    const events = event.storage.events.map((item) => (item === "deleted" ? "ObjectRemoved" : "ObjectCreated"));
    const suffix = event.storage.suffix ? `\n    suffix                  = ${q(event.storage.suffix)}` : "";
    return `resource "huaweicloud_fgs_trigger" "${fn.tfId}_obs_${index}" {
  function_urn = huaweicloud_fgs_function.${fn.tfId}.urn
  type         = "OBS"
  status       = "ACTIVE"
  obs {
    bucket_name             = ${q(bucket)}
    event_notification_name = ${q(`obs-${index}`)}
    events                  = ${JSON.stringify(events)}${suffix}
  }
}
`;
  }
  return "";
}

export function renderDigitalOcean(ctx: RenderContext): Record<string, string> {
  const command = ctx.platform === "win32" ? "doctl serverless deploy ." : "doctl serverless deploy .";
  const interpreter =
    ctx.platform === "win32"
      ? `interpreter = ["powershell", "-NoProfile", "-Command"]\n    command     = ${q(command)}`
      : `command = ${q(command)}`;
  return {
    "main.tf": `${fileHeader(ctx.config)}
${versions("hashicorp/null", "~> 3.2")}
# DigitalOcean's Terraform provider does not upload Functions source.
# Terraform runs doctl, which is the supported deploy path. Connect a namespace first:
#   doctl serverless connect <namespace-id>
# The project.yml and packaged actions are in \${path.module}/${ARTIFACTS.digitaloceanDir}

resource "null_resource" "functions" {
  triggers = {
    project = filesha256("\${path.module}/${ARTIFACTS.digitaloceanDir}/project.yml")
    code    = filesha256("\${path.module}/${ARTIFACTS.digitaloceanDir}/.sk-code-stamp")
  }

  provisioner "local-exec" {
    working_dir = "\${path.module}/${ARTIFACTS.digitaloceanDir}"
    ${interpreter}
  }
}

${outputs(ctx, () => q("deployed-by-doctl"))}
`,
  };
}

function outputs(ctx: RenderContext, urlOf: (fn: PhysicalFunction) => string): string {
  const functions: Record<string, Record<string, string>> = {};
  for (const fn of ctx.plan.functions) {
    const url = urlOf(fn);
    functions[fn.physicalName] = {
      logical_name: q(fn.logicalName),
      arn: url === "null" ? q(fn.physicalName) : url,
      id: q(functionName(ctx.config, fn)),
      url,
    };
  }
  return [
    outputMap("sk_functions", functions),
    workflowOutputs(ctx.plan.workflows, (workflow) => ({
      arn: q(workflow.name),
      id: q(workflow.name),
      engine: q(workflow.engine),
    })),
  ].join("\n");
}

function workerUrl(ctx: RenderContext, fn: PhysicalFunction, subdomain: string | undefined): string {
  if (!subdomain) return "null";
  return q(`https://${functionName(ctx.config, fn)}.${subdomain}.workers.dev`);
}

function safe(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+/, "");
  const id = cleaned.slice(0, 40) || "q";
  return /^[0-9]/.test(id) ? `q_${id}` : id;
}
