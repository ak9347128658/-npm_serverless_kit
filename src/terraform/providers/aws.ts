import { ARTIFACTS } from "../../paths.js";
import type { EventConfig, PhysicalFunction } from "../../types.js";
import { q } from "../../util/hcl.js";
import { normalizeSchedule } from "../../util/schedule.js";
import { renderAsl } from "../asl.js";
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
  userFunctions,
  versions,
  workflowOutputs,
} from "../support.js";

export function renderAws(ctx: RenderContext): Record<string, string> {
  const { config, plan } = ctx;
  const header = fileHeader(config);
  const extras = plan.needsInvokeToken ? [randomProvider()] : [];
  const httpFns = plan.functions.filter((fn) => fn.events.some((event) => event.type === "http"));
  const lines: string[] = [
    header,
    versions("hashicorp/aws", "~> 5.80", extras),
    randomTokenResource(plan),
    `provider "aws" {\n  region = ${q(config.provider.region)}\n}\n`,
    `locals {\n  service = ${q(config.service)}\n  stage   = ${q(config.provider.stage)}\n}\n`,
  ];

  const needsApi = httpFns.length > 0;
  if (needsApi) lines.push(renderApi(ctx, httpFns));

  for (const fn of plan.functions) lines.push(renderFunction(ctx, fn, needsApi));
  lines.push(renderQueues(ctx));
  lines.push(renderTopics(ctx));
  lines.push(renderStorage(ctx));
  lines.push(renderSchedules(ctx));
  lines.push(renderEvents(ctx));
  lines.push(renderStreams(ctx));
  lines.push(renderWorkflows(ctx));
  lines.push(renderOutputs(ctx, needsApi));
  return { "main.tf": lines.filter(Boolean).join("\n") };
}

function renderApi(ctx: RenderContext, httpFns: PhysicalFunction[]): string {
  const cors = httpFns.some((fn) => fn.events.some((event) => event.type === "http" && event.http.cors && !event.http.internal));
  const corsBlock = cors
    ? `
  cors_configuration {
    allow_headers = ["*"]
    allow_methods = ["*"]
    allow_origins = ["*"]
  }`
    : "";
  return `resource "aws_apigatewayv2_api" "http" {
  name          = ${q(`${ctx.config.service}-${ctx.config.provider.stage}`)}
  protocol_type = "HTTP"${corsBlock}
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}
`;
}

function renderFunction(ctx: RenderContext, fn: PhysicalFunction, needsApi: boolean): string {
  const name = functionName(ctx.config, fn, 64);
  const zip = ARTIFACTS.zip(fn.physicalName);
  const extra = { ...tokenExtra(ctx.plan) };
  const runner = runnerFunction(ctx.plan);
  if (runner && fn.tfId === runner.tfId) {
    const entries = httpInvokeTargets(ctx.plan).map((target): [string, string] => [
      target.logicalName,
      `"\${trimsuffix(aws_lambda_function_url.${target.tfId}.function_url, "/")}/__sk/invoke/${target.logicalName}"`,
    ]);
    extra.SK_FUNCTION_URL_MAP = urlMapExpression(entries);
  }
  const hasHttp = fn.events.some((event) => event.type === "http");
  const statements = [
    {
      Effect: "Allow",
      Action: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      Resource: "*",
    },
  ];
  for (const event of fn.events) {
    if (event.type === "queue") {
      statements.push({
        Effect: "Allow",
        Action: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
        Resource: event.queue.arn && !event.queue.create ? event.queue.arn : "*",
      });
    }
  }
  const policy = { Version: "2012-10-17", Statement: statements };
  const tracing = ctx.config.provider.aws?.tracing
    ? `\n  tracing_config {\n    mode = "Active"\n  }`
    : "";
  const routes = fn.events.filter((event) => event.type === "http");
  const routeBlocks = routes.map((event, index) => renderRoute(fn, event, index)).join("\n");
  const permission = hasHttp && needsApi
    ? `
resource "aws_lambda_permission" "${fn.tfId}_apigw" {
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.${fn.tfId}.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "\${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
`
    : "";
  const functionUrl =
    fn.events.some((event) => event.type === "http" && event.http.internal) && runner
      ? `
resource "aws_lambda_function_url" "${fn.tfId}" {
  function_name      = aws_lambda_function.${fn.tfId}.function_name
  authorization_type = "NONE"
}
`
      : "";
  return `resource "aws_iam_role" "${fn.tfId}" {
  name = ${q(`${name}-role`.slice(0, 64))}
  assume_role_policy = ${q(JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }] }))}
}

resource "aws_iam_role_policy" "${fn.tfId}" {
  name   = "inline"
  role   = aws_iam_role.${fn.tfId}.id
  policy = ${q(JSON.stringify(policy))}
}

resource "aws_cloudwatch_log_group" "${fn.tfId}" {
  name              = "/aws/lambda/${name}"
  retention_in_days = ${ctx.config.provider.aws?.logRetentionDays ?? 14}
}

resource "aws_lambda_function" "${fn.tfId}" {
  function_name    = ${q(name)}
  description      = ${q(fn.description ?? `serverless-kit function ${fn.logicalName}`)}
  role             = aws_iam_role.${fn.tfId}.arn
  runtime          = ${q(fn.providerRuntime)}
  handler          = "index.handler"
  memory_size      = ${fn.memory}
  timeout          = ${fn.timeout}
  filename         = "\${path.module}/${zip}"
  source_code_hash = filebase64sha256("\${path.module}/${zip}")
  architectures    = [${q(fn.architecture)}]

  environment {
    variables = ${envBlock(envExpressions(ctx.config, fn, extra), 6)}
  }${tracing}

  depends_on = [aws_cloudwatch_log_group.${fn.tfId}, aws_iam_role_policy.${fn.tfId}]
}
${permission}${functionUrl}${needsApi && routes.length > 0 ? `
resource "aws_apigatewayv2_integration" "${fn.tfId}" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.${fn.tfId}.invoke_arn
  payload_format_version = "2.0"
}
${routeBlocks}` : ""}
`;
}

function renderRoute(fn: PhysicalFunction, event: EventConfig, index: number): string {
  if (event.type !== "http") return "";
  const auth = event.http.auth === "iam" ? "AWS_IAM" : "NONE";
  const method = event.http.method === "ANY" ? "ANY" : event.http.method;
  return `resource "aws_apigatewayv2_route" "${fn.tfId}_${index}" {
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = ${q(`${method} ${event.http.path}`)}
  target             = "integrations/\${aws_apigatewayv2_integration.${fn.tfId}.id}"
  authorization_type = ${q(auth)}
}
`;
}

function renderQueues(ctx: RenderContext): string {
  const blocks: string[] = [];
  const created = new Map<string, string>();
  for (const fn of ctx.plan.functions) {
    fn.events.forEach((event, index) => {
      if (event.type !== "queue") return;
      let arnExpr = event.queue.arn ? q(event.queue.arn) : "";
      if (event.queue.create && event.queue.name) {
        if (!created.has(event.queue.name)) {
          const id = `q_${safe(event.queue.name)}`;
          created.set(event.queue.name, id);
          const qName = functionName(ctx.config, { ...fn, physicalName: event.queue.name }, 80);
          blocks.push(`resource "aws_sqs_queue" "${id}" {
  name                       = ${q(qName)}
  visibility_timeout_seconds = ${Math.max(fn.timeout * 6, 30)}
}
`);
        }
        arnExpr = `aws_sqs_queue.${created.get(event.queue.name)}.arn`;
      }
      if (!arnExpr && event.queue.name) {
        arnExpr = q(`arn:aws:sqs:${ctx.config.provider.region}:*:${event.queue.name}`);
      }
      blocks.push(`resource "aws_lambda_event_source_mapping" "${fn.tfId}_q_${index}" {
  event_source_arn = ${arnExpr}
  function_name    = aws_lambda_function.${fn.tfId}.arn
  batch_size       = ${event.queue.batchSize}
}
`);
    });
  }
  return blocks.join("\n");
}

function renderTopics(ctx: RenderContext): string {
  const blocks: string[] = [];
  const created = new Map<string, string>();
  for (const fn of ctx.plan.functions) {
    fn.events.forEach((event, index) => {
      if (event.type !== "topic") return;
      let arnExpr = event.topic.arn ? q(event.topic.arn) : "";
      if (event.topic.create && event.topic.name) {
        if (!created.has(event.topic.name)) {
          const id = `topic_${safe(event.topic.name)}`;
          created.set(event.topic.name, id);
          blocks.push(`resource "aws_sns_topic" "${id}" {\n  name = ${q(functionName(ctx.config, { ...fn, physicalName: event.topic.name }, 80))}\n}\n`);
        }
        arnExpr = `aws_sns_topic.${created.get(event.topic.name)}.arn`;
      }
      blocks.push(`resource "aws_sns_topic_subscription" "${fn.tfId}_sns_${index}" {
  topic_arn = ${arnExpr}
  protocol  = "lambda"
  endpoint  = aws_lambda_function.${fn.tfId}.arn
}

resource "aws_lambda_permission" "${fn.tfId}_sns_${index}" {
  statement_id  = "AllowSNS${index}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.${fn.tfId}.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = ${arnExpr}
}
`);
    });
  }
  return blocks.join("\n");
}

function renderStorage(ctx: RenderContext): string {
  const byBucket = new Map<string, Array<{ fn: PhysicalFunction; index: number; event: Extract<EventConfig, { type: "storage" }> }>>();
  for (const fn of ctx.plan.functions) {
    fn.events.forEach((event, index) => {
      if (event.type !== "storage") return;
      const list = byBucket.get(event.storage.bucket) ?? [];
      list.push({ fn, index, event });
      byBucket.set(event.storage.bucket, list);
    });
  }
  const blocks: string[] = [];
  for (const [bucket, items] of byBucket) {
    const id = `bucket_${safe(bucket)}`;
    const create = items.some((item) => item.event.storage.create);
    if (create) {
      blocks.push(`resource "aws_s3_bucket" "${id}" {\n  bucket = ${q(functionName(ctx.config, { ...items[0].fn, physicalName: bucket }, 63))}\n}\n`);
    }
    const bucketRef = create ? `aws_s3_bucket.${id}.id` : q(bucket);
    for (const item of items) {
      blocks.push(`resource "aws_lambda_permission" "${item.fn.tfId}_s3_${item.index}" {
  statement_id  = "AllowS3${item.index}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.${item.fn.tfId}.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = ${create ? `aws_s3_bucket.${id}.arn` : `"arn:aws:s3:::${bucket}"`}
}
`);
    }
    const notifications = items
      .map((item) => {
        const events = item.event.storage.events.map((kind) => (kind === "deleted" ? "s3:ObjectRemoved:*" : "s3:ObjectCreated:*"));
        const prefix = item.event.storage.prefix ? `\n    filter_prefix       = ${q(item.event.storage.prefix)}` : "";
        const suffix = item.event.storage.suffix ? `\n    filter_suffix       = ${q(item.event.storage.suffix)}` : "";
        return `  lambda_function {\n    lambda_function_arn = aws_lambda_function.${item.fn.tfId}.arn\n    events              = ${JSON.stringify(events).replaceAll('"', "") === "" ? "[]" : `[${events.map((event) => q(event)).join(", ")}]`} ${prefix}${suffix}\n  }`;
      })
      .join("\n");
    blocks.push(`resource "aws_s3_bucket_notification" "${id}" {
  bucket = ${bucketRef}
${notifications}
  depends_on = [${items.map((item) => `aws_lambda_permission.${item.fn.tfId}_s3_${item.index}`).join(", ")}]
}
`);
  }
  return blocks.join("\n");
}

function renderSchedules(ctx: RenderContext): string {
  const blocks: string[] = [];
  for (const fn of ctx.plan.functions) {
    fn.events.forEach((event, index) => {
      if (event.type !== "schedule") return;
      const expression = normalizeSchedule(event.schedule.expression, event.schedule.timezone).aws;
      const id = `${fn.tfId}_sched_${index}`;
      blocks.push(`resource "aws_cloudwatch_event_rule" "${id}" {
  name                = ${q(functionName(ctx.config, { ...fn, physicalName: `${fn.physicalName}-sched-${index}` }, 64))}
  description         = ${q(event.schedule.description ?? `Schedule for ${fn.logicalName}`)}
  schedule_expression = ${q(expression)}
}

resource "aws_cloudwatch_event_target" "${id}" {
  rule      = aws_cloudwatch_event_rule.${id}.name
  target_id = "lambda"
  arn       = aws_lambda_function.${fn.tfId}.arn
}

resource "aws_lambda_permission" "${id}" {
  statement_id  = "AllowSchedule${index}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.${fn.tfId}.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.${id}.arn
}
`);
    });
  }
  return blocks.join("\n");
}

function renderEvents(ctx: RenderContext): string {
  const blocks: string[] = [];
  for (const fn of ctx.plan.functions) {
    fn.events.forEach((event, index) => {
      if (event.type !== "event") return;
      const pattern: Record<string, unknown> = { ...(event.event.pattern ?? {}) };
      if (event.event.source) pattern.source = [event.event.source];
      if (event.event.detailType) pattern["detail-type"] = [event.event.detailType];
      const id = `${fn.tfId}_evt_${index}`;
      const bus = event.event.bus && event.event.bus !== "default" ? `\n  event_bus_name = ${q(event.event.bus)}` : "";
      blocks.push(`resource "aws_cloudwatch_event_rule" "${id}" {
  name          = ${q(functionName(ctx.config, { ...fn, physicalName: `${fn.physicalName}-evt-${index}` }, 64))}
  event_pattern = ${q(JSON.stringify(pattern))}${bus}
}

resource "aws_cloudwatch_event_target" "${id}" {
  rule      = aws_cloudwatch_event_rule.${id}.name
  target_id = "lambda"
  arn       = aws_lambda_function.${fn.tfId}.arn${bus}
}

resource "aws_lambda_permission" "${id}" {
  statement_id  = "AllowEvent${index}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.${fn.tfId}.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.${id}.arn
}
`);
    });
  }
  return blocks.join("\n");
}

function renderStreams(ctx: RenderContext): string {
  const blocks: string[] = [];
  for (const fn of ctx.plan.functions) {
    fn.events.forEach((event, index) => {
      if (event.type !== "stream") return;
      blocks.push(`resource "aws_lambda_event_source_mapping" "${fn.tfId}_stream_${index}" {
  event_source_arn  = ${q(event.stream.arn)}
  function_name     = aws_lambda_function.${fn.tfId}.arn
  starting_position = ${q(event.stream.startingPosition)}
  batch_size        = ${event.stream.batchSize}
}
`);
    });
  }
  return blocks.join("\n");
}

function renderWorkflows(ctx: RenderContext): string {
  const native = ctx.plan.workflows.filter((workflow) => workflow.engine === "native");
  if (native.length === 0) return "";
  const arns = userFunctions(ctx.plan).map((fn) => `aws_lambda_function.${fn.tfId}.arn`);
  const blocks = [`resource "aws_iam_role" "sfn" {
  name = ${q(`${ctx.config.service}-${ctx.config.provider.stage}-sfn`.slice(0, 64))}
  assume_role_policy = ${q(JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "states.amazonaws.com" }, Action: "sts:AssumeRole" }] }))}
}

resource "aws_iam_role_policy" "sfn" {
  name = "invoke"
  role = aws_iam_role.sfn.id
  policy = ${q(JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["lambda:InvokeFunction"], Resource: "*" }] }))}
}
`];
  void arns;
  for (const workflow of native) {
    const asl = renderAsl(workflow, (logical) => {
      const fn = ctx.plan.functions.find((item) => item.logicalName === logical);
      if (!fn) throw new Error(`Workflow ${workflow.name} references missing function ${logical}`);
      return `aws_lambda_function.${fn.tfId}.arn`;
    });
    blocks.push(`resource "aws_sfn_state_machine" "${workflow.tfId}" {
  name     = ${q(functionName(ctx.config, { ...userFunctions(ctx.plan)[0], physicalName: workflow.name }, 80))}
  role_arn = aws_iam_role.sfn.arn
  type     = ${q(workflow.config.type)}
  definition = <<-ASL
${asl}
ASL
}
`);
  }
  return blocks.join("\n");
}

function publicHttpPath(events: EventConfig[]): string | undefined {
  for (const event of events) {
    if (event.type === "http" && !event.http.internal) return event.http.path;
  }
  return undefined;
}

function renderOutputs(ctx: RenderContext, needsApi: boolean): string {
  const functions: Record<string, Record<string, string>> = {};
  for (const fn of ctx.plan.functions) {
    const path = publicHttpPath(fn.events);
    const safeUrl = path && needsApi
      ? `"\${aws_apigatewayv2_stage.default.invoke_url}${path}"`
      : "null";
    functions[fn.physicalName] = {
      logical_name: q(fn.logicalName),
      arn: `aws_lambda_function.${fn.tfId}.arn`,
      id: `aws_lambda_function.${fn.tfId}.arn`,
      url: safeUrl,
    };
  }
  return [
    outputMap("sk_functions", functions),
    workflowOutputs(ctx.plan.workflows.filter((workflow) => workflow.engine === "native"), (workflow) => ({
      arn: `aws_sfn_state_machine.${workflow.tfId}.arn`,
      id: `aws_sfn_state_machine.${workflow.tfId}.id`,
      engine: q("native"),
    })),
  ].join("\n");
}

function safe(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "res";
}
