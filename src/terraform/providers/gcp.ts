import { ARTIFACTS } from "../../paths.js";
import type { PhysicalFunction } from "../../types.js";
import { heredoc, q } from "../../util/hcl.js";
import { bucketName, cloudName } from "../../util/hash.js";
import { normalizeSchedule } from "../../util/schedule.js";
import { renderGcpWorkflow } from "../gcp-workflow.js";
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

export function renderGcp(ctx: RenderContext): Record<string, string> {
  const { config, plan } = ctx;
  const project = config.provider.gcp?.project ?? "";
  const extras = plan.needsInvokeToken ? [randomProvider()] : [];
  const bucket = bucketName(config.service, config.provider.stage, "src");
  const lines: string[] = [
    fileHeader(config),
    versions("hashicorp/google", "~> 6.0", extras),
    randomTokenResource(plan),
    `provider "google" {\n  project = ${q(project)}\n  region  = ${q(config.provider.region)}\n}\n`,
    `resource "google_storage_bucket" "source" {
  name                        = ${q(bucket)}
  location                    = ${q(config.provider.region)}
  uniform_bucket_level_access = true
  force_destroy               = true
}
`,
  ];
  if (config.provider.gcp?.manageApis) {
    for (const service of [
      "cloudfunctions.googleapis.com",
      "run.googleapis.com",
      "cloudbuild.googleapis.com",
      "artifactregistry.googleapis.com",
      "cloudscheduler.googleapis.com",
      "workflows.googleapis.com",
      "eventarc.googleapis.com",
      "pubsub.googleapis.com",
    ]) {
      const id = service.split(".")[0];
      lines.push(`resource "google_project_service" "${id}" {\n  service = ${q(service)}\n}\n`);
    }
  }
  lines.push(serviceAccount("scheduler", config.service, config.provider.stage));
  if (plan.workflows.some((workflow) => workflow.engine === "native")) {
    lines.push(serviceAccount("workflows", config.service, config.provider.stage));
  }
  for (const fn of plan.functions) lines.push(renderFunction(ctx, fn));
  lines.push(renderTopicsAndQueues(ctx));
  lines.push(renderWorkflows(ctx));
  lines.push(renderOutputs(ctx));
  return { "main.tf": lines.filter(Boolean).join("\n") };
}

function serviceAccount(purpose: string, service: string, stage: string): string {
  const account = cloudName([service, stage, purpose], 28).replace(/-/g, "").slice(0, 28);
  const id = account.length < 6 ? `${account}kit`.slice(0, 28) : account;
  return `resource "google_service_account" "${purpose}" {
  account_id   = ${q(id)}
  display_name = ${q(`serverless-kit ${purpose}`)}
}
`;
}

function renderFunction(ctx: RenderContext, fn: PhysicalFunction): string {
  const name = functionName(ctx.config, fn);
  const extra = { ...tokenExtra(ctx.plan) };
  const runner = runnerFunction(ctx.plan);
  if (runner && fn.tfId === runner.tfId) {
    extra.SK_FUNCTION_URL_MAP = urlMapExpression(
      httpInvokeTargets(ctx.plan).map((target) => [
        target.logicalName,
        `"\${google_cloudfunctions2_function.${target.tfId}.service_config[0].uri}/__sk/invoke/${target.logicalName}"`,
      ]),
    );
  }
  const background = fn.events.find((event) => event.type !== "http" && event.type !== "schedule");
  const trigger = background ? eventTrigger(ctx, fn, background) : "";
  const schedules = fn.events
    .filter((event) => event.type === "schedule")
    .map((event, index) => {
      if (event.type !== "schedule") return "";
      const when = normalizeSchedule(event.schedule.expression, event.schedule.timezone);
      return `resource "google_cloud_scheduler_job" "${fn.tfId}_${index}" {
  name      = ${q(functionName(ctx.config, { ...fn, physicalName: `${fn.physicalName}-s-${index}` }))}
  schedule  = ${q(when.unix)}
  time_zone = ${q(event.schedule.timezone || "UTC")}
  http_target {
    http_method = "POST"
    uri         = google_cloudfunctions2_function.${fn.tfId}.service_config[0].uri
    body        = base64encode("{\\"source\\":\\"schedule\\"}")
    oidc_token {
      service_account_email = google_service_account.scheduler.email
    }
  }
}

resource "google_cloud_run_service_iam_member" "${fn.tfId}_sched_${index}" {
  location = google_cloudfunctions2_function.${fn.tfId}.location
  service  = google_cloudfunctions2_function.${fn.tfId}.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:\${google_service_account.scheduler.email}"
}
`;
    })
    .join("\n");
  const isPublic = fn.events.some((event) => event.type === "http" && event.http.auth === "public" && !event.http.internal);
  const invoker = isPublic
    ? `resource "google_cloud_run_service_iam_member" "${fn.tfId}_public" {
  location = google_cloudfunctions2_function.${fn.tfId}.location
  service  = google_cloudfunctions2_function.${fn.tfId}.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
`
    : "";
  return `resource "google_storage_bucket_object" "${fn.tfId}" {
  name   = ${q(`${name}-${fn.physicalName}.zip`)}
  bucket = google_storage_bucket.source.name
  source = "\${path.module}/${ARTIFACTS.zip(fn.physicalName)}"
}

resource "google_cloudfunctions2_function" "${fn.tfId}" {
  name        = ${q(name)}
  location    = ${q(ctx.config.provider.region)}
  description = ${q(fn.description ?? fn.logicalName)}

  build_config {
    runtime     = ${q(fn.providerRuntime)}
    entry_point = "handler"
    source {
      storage_source {
        bucket = google_storage_bucket.source.name
        object = google_storage_bucket_object.${fn.tfId}.name
      }
    }
  }

  service_config {
    available_memory      = ${q(`${fn.memory}M`)}
    timeout_seconds       = ${fn.timeout}
    ingress_settings      = "ALLOW_ALL"
    environment_variables = ${envBlock(envExpressions(ctx.config, fn, extra), 6)}
  }
${trigger}}
${invoker}${schedules}`;
}

function eventTrigger(ctx: RenderContext, fn: PhysicalFunction, event: PhysicalFunction["events"][number]): string {
  if (event.type === "queue" || event.type === "topic" || event.type === "event") {
    const topic = event.type === "queue" ? event.queue.name : event.type === "topic" ? event.topic.name : event.event.bus || event.event.source || fn.logicalName;
    return `  event_trigger {
    trigger_region = ${q(ctx.config.provider.region)}
    event_type     = "google.cloud.pubsub.topic.v1.messagePublished"
    pubsub_topic   = google_pubsub_topic.${topicId(topic ?? fn.logicalName)}.id
    retry_policy   = "RETRY_POLICY_RETRY"
  }
`;
  }
  if (event.type === "storage") {
    const kind = event.storage.events.includes("created") || event.storage.events.length === 0
      ? "google.cloud.storage.object.v1.finalized"
      : "google.cloud.storage.object.v1.deleted";
    const bucket = event.storage.create
      ? `google_storage_bucket.${bucketId(event.storage.bucket)}.name`
      : q(event.storage.bucket);
    return `  event_trigger {
    trigger_region = ${q(ctx.config.provider.region)}
    event_type     = ${q(kind)}
    event_filters {
      attribute = "bucket"
      value     = ${bucket}
    }
  }
`;
  }
  return "";
}

function renderTopicsAndQueues(ctx: RenderContext): string {
  const topics = new Map<string, string>();
  const blocks: string[] = [];
  for (const fn of ctx.plan.functions) {
    for (const event of fn.events) {
      if (event.type === "queue" && event.queue.name) topics.set(event.queue.name, event.queue.name);
      if (event.type === "topic" && event.topic.name) topics.set(event.topic.name, event.topic.name);
      if (event.type === "event") topics.set(event.event.bus || event.event.source || fn.logicalName, event.event.bus || event.event.source || fn.logicalName);
      if (event.type === "storage" && event.storage.create) {
        const id = bucketId(event.storage.bucket);
        if (!blocks.some((block) => block.includes(`"${id}"`))) {
          blocks.push(`resource "google_storage_bucket" "${id}" {
  name                        = ${q(bucketName(ctx.config.service, ctx.config.provider.stage, event.storage.bucket))}
  location                    = ${q(ctx.config.provider.region)}
  uniform_bucket_level_access = true
}
`);
        }
      }
    }
  }
  for (const name of topics.values()) {
    blocks.push(`resource "google_pubsub_topic" "${topicId(name)}" {\n  name = ${q(cloudName([ctx.config.service, ctx.config.provider.stage, name]))}\n}\n`);
  }
  return blocks.join("\n");
}

function renderWorkflows(ctx: RenderContext): string {
  const native = ctx.plan.workflows.filter((workflow) => workflow.engine === "native");
  if (native.length === 0) return "";
  const targets = httpInvokeTargets(ctx.plan);
  const blocks = targets.map(
    (fn) => `resource "google_cloud_run_service_iam_member" "${fn.tfId}_wf" {
  location = google_cloudfunctions2_function.${fn.tfId}.location
  service  = google_cloudfunctions2_function.${fn.tfId}.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:\${google_service_account.workflows.email}"
}
`,
  );
  for (const workflow of native) {
    const body = renderGcpWorkflow(workflow, targets);
    const nameSource = targets[0] ?? ctx.plan.functions[0];
    blocks.push(`resource "google_workflows_workflow" "${workflow.tfId}" {
  name            = ${q(functionName(ctx.config, { ...nameSource, physicalName: workflow.name }))}
  region          = ${q(ctx.config.provider.region)}
  description     = ${q(workflow.config.comment ?? workflow.name)}
  service_account = google_service_account.workflows.id
  source_contents = ${heredoc("YAML", body)}
}
`);
  }
  return blocks.join("\n");
}

function renderOutputs(ctx: RenderContext): string {
  const functions: Record<string, Record<string, string>> = {};
  for (const fn of ctx.plan.functions) {
    functions[fn.physicalName] = {
      logical_name: q(fn.logicalName),
      arn: `google_cloudfunctions2_function.${fn.tfId}.id`,
      id: `google_cloudfunctions2_function.${fn.tfId}.name`,
      url: `google_cloudfunctions2_function.${fn.tfId}.service_config[0].uri`,
    };
  }
  return [
    outputMap("sk_functions", functions),
    workflowOutputs(
      ctx.plan.workflows.filter((workflow) => workflow.engine === "native"),
      (workflow) => ({
        arn: `google_workflows_workflow.${workflow.tfId}.id`,
        id: `google_workflows_workflow.${workflow.tfId}.name`,
        engine: q("native"),
      }),
    ),
  ].join("\n");
}

function topicId(name: string): string {
  return `topic_${name.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40)}`;
}

function bucketId(name: string): string {
  return `data_${name.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40)}`;
}
