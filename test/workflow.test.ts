import assert from "node:assert/strict";
import { test } from "node:test";
import { WorkflowError } from "../src/errors.js";
import { readPath, runWorkflow } from "../src/runtime/workflow.js";
import type { WorkflowConfig } from "../src/types.js";

test("readPath walks dotted paths", () => {
  assert.equal(readPath({ order: { id: 9 } }, "$.order.id"), 9);
  assert.equal(readPath({ ok: false }, "$.missing"), undefined);
});

test("the portable runner calls a task, retries, and succeeds", async () => {
  const workflow: WorkflowConfig = {
    engine: "portable",
    type: "STANDARD",
    startAt: "charge",
    states: {
      charge: {
        type: "task",
        function: "charge",
        retry: [{ errors: ["States.ALL"], intervalSeconds: 0, maxAttempts: 2, backoffRate: 1 }],
        next: "choice",
      },
      choice: {
        type: "choice",
        choices: [{ variable: "$.ok", booleanEquals: true, next: "done" }],
        default: "failed",
      },
      done: { type: "succeed" },
      failed: { type: "fail", error: "No" },
    },
  };
  let calls = 0;
  const result = await runWorkflow("order", workflow, { ok: false }, async () => {
    calls += 1;
    if (calls === 1) throw new Error("try again");
    return { ok: true };
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, { ok: true });
});

test("a failing state raises WorkflowError", async () => {
  const workflow: WorkflowConfig = {
    engine: "portable",
    type: "STANDARD",
    startAt: "failed",
    states: { failed: { type: "fail", cause: "nope" } },
  };
  await assert.rejects(runWorkflow("order", workflow, {}, async () => ({})), WorkflowError);
});
