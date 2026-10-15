import { PROVIDERS } from "../catalog.js";
import type { DeploymentModel, FunctionView, KitConfig, PlanResult, TriggerView, WorkflowView } from "../types.js";

export interface TerraformOutputs {
  sk_functions?: { value?: Record<string, OutputFunction> };
  sk_workflows?: { value?: Record<string, OutputWorkflow> };
}

interface OutputFunction {
  logical_name?: string;
  arn?: string | null;
  id?: string | null;
  url?: string | null;
}

interface OutputWorkflow {
  arn?: string | null;
  id?: string | null;
  engine?: string;
}

export function buildModel(config: KitConfig, plan: PlanResult, outputs?: TerraformOutputs, deployedAt?: string): DeploymentModel {
  const fnOut = outputs?.sk_functions?.value ?? {};
  const wfOut = outputs?.sk_workflows?.value ?? {};
  const functions: FunctionView[] = plan.functions.map((fn) => {
    const found = fnOut[fn.physicalName] ?? {};
    return {
      logicalName: fn.logicalName,
      physicalName: fn.physicalName,
      handler: fn.handler,
      runtime: fn.runtime,
      providerRuntime: fn.providerRuntime,
      memory: fn.memory,
      timeout: fn.timeout,
      description: fn.description,
      entry: fn.entry,
      arn: empty(found.arn),
      url: empty(found.url),
      id: empty(found.id),
      environmentKeys: Object.keys({ ...config.provider.environment, ...fn.environment }).filter((key) => !key.startsWith("SK_")).sort(),
      triggers: fn.events.map(toTrigger),
    };
  });
  const workflows: WorkflowView[] = plan.workflows.map((workflow) => ({
    name: workflow.name,
    engine: workflow.engine,
    type: workflow.config.type,
    startAt: workflow.config.startAt,
    comment: workflow.config.comment,
    arn: empty(wfOut[workflow.name]?.arn),
    url: empty(wfOut[workflow.name]?.id) && workflow.engine === "portable" ? undefined : empty(wfOut[workflow.name]?.arn),
  }));
  return {
    service: config.service,
    provider: config.provider.name,
    providerTitle: PROVIDERS[config.provider.name].title,
    region: config.provider.region,
    stage: config.provider.stage,
    runtime: config.provider.runtime,
    status: outputs ? "deployed" : "planned",
    deployedAt,
    title: config.ui.title ?? `${config.service} (${config.provider.stage})`,
    warnings: plan.warnings,
    functions,
    workflows,
  };
}

function toTrigger(event: PlanResult["functions"][number]["events"][number]): TriggerView {
  switch (event.type) {
    case "http":
      return {
        type: "http",
        method: event.http.method,
        path: event.http.path,
        internal: event.http.internal,
        detail: `${event.http.method} ${event.http.path} auth=${event.http.auth}`,
      };
    case "schedule":
      return { type: "schedule", expression: event.schedule.expression, detail: event.schedule.expression };
    case "queue":
      return { type: "queue", name: event.queue.name ?? event.queue.arn, detail: event.queue.arn ?? event.queue.name };
    case "topic":
      return { type: "topic", name: event.topic.name ?? event.topic.arn, detail: event.topic.arn ?? event.topic.name };
    case "storage":
      return { type: "storage", name: event.storage.bucket, detail: `${event.storage.bucket} ${event.storage.events.join(",")}` };
    case "event":
      return { type: "event", name: event.event.bus, detail: [event.event.source, event.event.detailType].filter(Boolean).join(" / ") };
    case "stream":
      return { type: "stream", name: event.stream.arn, detail: event.stream.arn };
    default: {
      const _never: never = event;
      return _never;
    }
  }
}

function empty(value: string | null | undefined): string | undefined {
  if (!value || value === "null" || value === "deployed-by-doctl") return value === "deployed-by-doctl" ? value : undefined;
  return value;
}

export function formatInfo(model: DeploymentModel): string {
  const lines = [
    `${model.title}`,
    `${model.providerTitle}  ${model.region}  stage ${model.stage}  ${model.status}`,
    model.deployedAt ? `Deployed ${model.deployedAt}` : "Not deployed yet. URLs and ARNs appear after sk deploy.",
    "",
  ];
  if (model.warnings.length) {
    lines.push("Warnings:");
    for (const warning of model.warnings) lines.push(`  - ${warning}`);
    lines.push("");
  }
  for (const fn of model.functions) {
    lines.push(`${fn.logicalName}${fn.physicalName === fn.logicalName ? "" : ` (${fn.physicalName})`}`);
    lines.push(`  handler ${fn.handler}  ${fn.providerRuntime}  ${fn.memory} MB  ${fn.timeout}s`);
    if (fn.arn) lines.push(`  arn ${fn.arn}`);
    if (fn.url) lines.push(`  url ${fn.url}`);
    if (fn.id && fn.id !== fn.arn) lines.push(`  id  ${fn.id}`);
    for (const trigger of fn.triggers) {
      const flag = trigger.internal ? " internal" : "";
      lines.push(`  trigger ${trigger.type}${flag}  ${trigger.detail ?? ""}`);
    }
    lines.push("");
  }
  for (const workflow of model.workflows) {
    lines.push(`workflow ${workflow.name}  ${workflow.engine} ${workflow.type}  start ${workflow.startAt}`);
    if (workflow.arn) lines.push(`  arn ${workflow.arn}`);
  }
  return lines.join("\n").trimEnd() + "\n";
}
