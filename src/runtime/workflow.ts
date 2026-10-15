import { WorkflowError } from "../errors.js";
import type { ChoiceRule, KitResult, WorkflowConfig, WorkflowState } from "../types.js";

export type WorkflowInvoke = (functionName: string, payload: unknown, step: string) => Promise<unknown>;

const MAX_STEPS = 50;
const MAX_PORTABLE_WAIT_SECONDS = 10;

export async function runWorkflow(
  name: string,
  workflow: WorkflowConfig,
  input: unknown,
  invoke: WorkflowInvoke,
): Promise<unknown> {
  let current = workflow.startAt;
  let payload = input;
  const seen = new Map<string, number>();

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const state = workflow.states[current];
    if (!state) throw new WorkflowError(`Workflow "${name}" entered missing state "${current}".`);
    seen.set(current, (seen.get(current) ?? 0) + 1);
    if ((seen.get(current) ?? 0) > 10) {
      throw new WorkflowError(`Workflow "${name}" visited state "${current}" more than 10 times.`);
    }
    const outcome = await executeState(name, current, state, payload, workflow, invoke);
    if (outcome.done) return outcome.output;
    payload = outcome.output;
    current = outcome.next;
  }
  throw new WorkflowError(`Workflow "${name}" exceeded ${MAX_STEPS} transitions.`);
}

interface StepOutcome {
  done: boolean;
  next: string;
  output: unknown;
}

async function executeState(
  workflowName: string,
  stateName: string,
  state: WorkflowState,
  payload: unknown,
  workflow: WorkflowConfig,
  invoke: WorkflowInvoke,
): Promise<StepOutcome> {
  switch (state.type) {
    case "task": {
      let attempt = 0;
      const retries = state.retry ?? [];
      for (;;) {
        try {
          const raw = await invoke(state.function, payload, stateName);
          const output = unwrapTaskOutput(raw);
          if (state.end || !state.next) return { done: true, next: "", output };
          return { done: false, next: state.next, output };
        } catch (error) {
          const message = error instanceof Error ? error.name || error.message : "Error";
          const retry = retries.find((item) => matchesError(item.errors, message));
          if (retry && attempt < retry.maxAttempts) {
            const waitMs = retry.intervalSeconds * 1000 * retry.backoffRate ** attempt;
            attempt += 1;
            if (workflow.engine === "portable") await delay(Math.min(waitMs, MAX_PORTABLE_WAIT_SECONDS * 1000));
            else await delay(waitMs);
            continue;
          }
          const caught = (state.catch ?? []).find((item) => matchesError(item.errors, message));
          if (caught) return { done: false, next: caught.next, output: { error: message, input: payload } };
          throw error;
        }
      }
    }
    case "choice": {
      for (const choice of state.choices) {
        if (choiceMatches(payload, choice)) return { done: false, next: choice.next, output: payload };
      }
      if (!state.default) {
        throw new WorkflowError(`Workflow "${workflowName}" choice "${stateName}" matched nothing and has no default.`);
      }
      return { done: false, next: state.default, output: payload };
    }
    case "wait": {
      if (state.seconds > MAX_PORTABLE_WAIT_SECONDS && workflow.engine === "portable") {
        throw new WorkflowError(
          `Portable workflow "${workflowName}" cannot wait ${state.seconds}s. Use a native AWS or Google Cloud workflow for long waits.`,
        );
      }
      await delay(state.seconds * 1000);
      if (state.end || !state.next) return { done: true, next: "", output: payload };
      return { done: false, next: state.next, output: payload };
    }
    case "pass": {
      const output = state.result !== undefined ? state.result : payload;
      if (state.end || !state.next) return { done: true, next: "", output };
      return { done: false, next: state.next, output };
    }
    case "succeed":
      return { done: true, next: "", output: payload };
    case "fail":
      throw new WorkflowError(state.cause || state.error || `Workflow "${workflowName}" failed at "${stateName}".`);
    default: {
      const _never: never = state;
      throw new WorkflowError(`Unknown state ${JSON.stringify(_never)}`);
    }
  }
}

function unwrapTaskOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const record = raw as KitResult & { Payload?: unknown };
  if (record.Payload && typeof record.Payload === "object") {
    const payload = record.Payload as KitResult;
    if ("body" in payload) return payload.body;
  }
  if ("statusCode" in record && "body" in record) return record.body;
  return raw;
}

function matchesError(patterns: string[], name: string): boolean {
  return patterns.some((pattern) => pattern === "States.ALL" || pattern === "States.TaskFailed" || pattern === name || name.includes(pattern));
}

function choiceMatches(payload: unknown, choice: ChoiceRule): boolean {
  const value = readPath(payload, choice.variable);
  if (choice.stringEquals !== undefined) return value === choice.stringEquals;
  if (choice.numericEquals !== undefined) return value === choice.numericEquals;
  if (choice.numericGreaterThan !== undefined) return typeof value === "number" && value > choice.numericGreaterThan;
  if (choice.booleanEquals !== undefined) return value === choice.booleanEquals;
  return false;
}

export function readPath(input: unknown, variable: string): unknown {
  if (!variable.startsWith("$")) {
    throw new WorkflowError(`Choice variable "${variable}" must start with $.`);
  }
  const path = variable.replace(/^\$\.?/, "");
  if (!path) return input;
  let current: unknown = input;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
