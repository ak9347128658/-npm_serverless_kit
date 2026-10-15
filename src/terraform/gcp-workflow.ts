import type { PhysicalFunction, PlannedWorkflow } from "../types.js";

/**
 * Google Cloud Workflows YAML.
 * Terraform interpolations use ${...}. Workflow expressions are written as $${...}
 * so Terraform turns them into ${...} for the workflow runtime.
 */
export function renderGcpWorkflow(workflow: PlannedWorkflow, targets: PhysicalFunction[]): string {
  const urlOf = new Map(targets.map((fn) => [fn.logicalName, gcpUrl(fn)]));
  const lines: string[] = ["main:", "  params: [input]", "  steps:"];
  const entries = Object.entries(workflow.config.states);
  entries.forEach(([name, state], index) => {
    const id = stepId(name, index);
    lines.push(`    - ${id}:`);
    if (state.type === "task") {
      const url = urlOf.get(state.function);
      if (!url) {
        throw new Error(`Workflow ${workflow.name} calls ${state.function}, which has no Google Cloud HTTP function.`);
      }
      lines.push("        call: http.post");
      lines.push("        args:");
      lines.push(`          url: ${url}`);
      lines.push("          auth:");
      lines.push("            type: OIDC");
      lines.push("          headers:");
      lines.push("            content-type: application/json");
      lines.push('            x-sk-internal: "1"');
      lines.push("          body:");
      lines.push("            __sk:");
      lines.push("              type: workflow");
      lines.push(`              workflow: ${workflow.name}`);
      lines.push(`              step: ${name}`);
      lines.push(`            input: $\${input}`);
      lines.push(`        result: ${id}_result`);
      const next = nextStep(entries, state.next, state.end);
      if (next) lines.push(`        next: ${next}`);
    } else if (state.type === "choice") {
      lines.push("        switch:");
      for (const choice of state.choices) {
        lines.push(`          - condition: $\${${choiceCondition(choice)}}`);
        lines.push(`            next: ${stepIdOf(entries, choice.next)}`);
      }
      if (state.default) lines.push(`        next: ${stepIdOf(entries, state.default)}`);
    } else if (state.type === "wait") {
      lines.push("        call: sys.sleep");
      lines.push("        args:");
      lines.push(`          seconds: ${state.seconds}`);
      const next = nextStep(entries, state.next, state.end);
      if (next) lines.push(`        next: ${next}`);
    } else if (state.type === "pass") {
      lines.push("        assign:");
      lines.push(`          - input: $\${${state.result !== undefined ? JSON.stringify(state.result) : "input"}}`);
      const next = nextStep(entries, state.next, state.end);
      if (next) lines.push(`        next: ${next}`);
    } else if (state.type === "succeed") {
      lines.push("        return: $\${input}");
    } else {
      lines.push("        raise:");
      lines.push(`          message: ${JSON.stringify(state.cause || state.error || "workflow failed")}`);
    }
  });
  return lines.join("\n");
}

function gcpUrl(fn: PhysicalFunction): string {
  const path = internalHttpPath(fn) ?? `/__sk/invoke/${fn.logicalName}`;
  return `"\${google_cloudfunctions2_function.${fn.tfId}.service_config[0].uri}${path}"`;
}

function internalHttpPath(fn: PhysicalFunction): string | undefined {
  for (const event of fn.events) {
    if (event.type === "http" && event.http.internal) return event.http.path;
  }
  return undefined;
}

function stepId(name: string, index: number): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return `${index}_${clean}`;
}

function stepIdOf(entries: Array<[string, unknown]>, name: string): string {
  const index = entries.findIndex(([key]) => key === name);
  return stepId(name, Math.max(index, 0));
}

function nextStep(entries: Array<[string, unknown]>, next: string | undefined, end?: boolean): string | undefined {
  if (end || !next) return undefined;
  return stepIdOf(entries, next);
}

function choiceCondition(choice: {
  variable: string;
  stringEquals?: string;
  numericEquals?: number;
  numericGreaterThan?: number;
  booleanEquals?: boolean;
}): string {
  const path = choice.variable.replace(/^\$\.?/, "");
  const left = path ? `input.${path}` : "input";
  if (choice.stringEquals !== undefined) return `${left} == ${JSON.stringify(choice.stringEquals)}`;
  if (choice.numericEquals !== undefined) return `${left} == ${choice.numericEquals}`;
  if (choice.numericGreaterThan !== undefined) return `${left} > ${choice.numericGreaterThan}`;
  if (choice.booleanEquals !== undefined) return `${left} == ${choice.booleanEquals}`;
  return "false";
}
