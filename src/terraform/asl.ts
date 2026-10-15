import type { PlannedWorkflow, WorkflowState } from "../types.js";

/** Amazon States Language with Terraform interpolations for Lambda ARNs. */
export function renderAsl(workflow: PlannedWorkflow, arnOf: (logicalName: string) => string): string {
  const states: Record<string, unknown> = {};
  for (const [name, state] of Object.entries(workflow.config.states)) {
    states[name] = renderState(workflow.name, name, state, arnOf);
  }
  const definition = {
    Comment: workflow.config.comment ?? `serverless-kit workflow ${workflow.name}`,
    StartAt: workflow.config.startAt,
    States: states,
  };
  let json = JSON.stringify(definition, null, 2);
  json = json.replace(/\$\{/g, "$$$${");
  for (const state of Object.values(workflow.config.states)) {
    if (state.type !== "task") continue;
    const token = `@@ARN:${state.function}@@`;
    json = json.replaceAll(`"${token}"`, `"\${${arnOf(state.function)}}"`);
  }
  return json;
}

function renderState(workflowName: string, stateName: string, state: WorkflowState, _arnOf: (name: string) => string): unknown {
  switch (state.type) {
    case "task":
      return {
        Type: "Task",
        Comment: state.comment,
        Resource: "arn:aws:states:::lambda:invoke",
        Parameters: {
          FunctionName: `@@ARN:${state.function}@@`,
          Payload: {
            __sk: { type: "workflow", workflow: workflowName, step: stateName },
            "input.$": "$",
          },
        },
        ResultSelector: {
          "statusCode.$": "$.Payload.statusCode",
          "body.$": "$.Payload.body",
        },
        OutputPath: "$.body",
        Next: state.end ? undefined : state.next,
        End: state.end || !state.next ? true : undefined,
        Retry: state.retry?.map((retry) => ({
          ErrorEquals: retry.errors,
          IntervalSeconds: retry.intervalSeconds,
          MaxAttempts: retry.maxAttempts,
          BackoffRate: retry.backoffRate,
        })),
        Catch: state.catch?.map((item) => ({
          ErrorEquals: item.errors,
          Next: item.next,
          ResultPath: "$.error",
        })),
      };
    case "choice":
      return {
        Type: "Choice",
        Choices: state.choices.map((choice) => {
          const row: Record<string, unknown> = { Variable: choice.variable, Next: choice.next };
          if (choice.stringEquals !== undefined) row.StringEquals = choice.stringEquals;
          if (choice.numericEquals !== undefined) row.NumericEquals = choice.numericEquals;
          if (choice.numericGreaterThan !== undefined) row.NumericGreaterThan = choice.numericGreaterThan;
          if (choice.booleanEquals !== undefined) row.BooleanEquals = choice.booleanEquals;
          return row;
        }),
        Default: state.default,
      };
    case "wait":
      return { Type: "Wait", Seconds: state.seconds, Next: state.next, End: state.end || !state.next ? true : undefined };
    case "pass":
      return {
        Type: "Pass",
        Result: state.result,
        Next: state.next,
        End: state.end || !state.next ? true : undefined,
      };
    case "succeed":
      return { Type: "Succeed" };
    case "fail":
      return { Type: "Fail", Error: state.error ?? "WorkflowFailed", Cause: state.cause ?? `Failed at ${stateName}` };
    default: {
      const _never: never = state;
      return _never;
    }
  }
}
