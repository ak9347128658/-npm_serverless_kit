import assert from "node:assert/strict";
import { test } from "node:test";
import { compile } from "./helpers.js";

test("AWS keeps every trigger on one function", () => {
  const { plan } = compile(`
service: shop
provider: { name: aws }
functions:
  worker:
    handler: src/handler.handler
    events:
      - http: { path: /work, method: POST }
      - schedule: { expression: rate(5 minutes) }
      - queue: { name: jobs }
`);
  const user = plan.functions.filter((fn) => fn.logicalName === "worker");
  assert.equal(user.length, 1);
  assert.equal(user[0].events.length, 3);
});

test("Azure splits one physical function per trigger", () => {
  const { plan } = compile(`
service: shop
provider: { name: azure }
functions:
  worker:
    handler: src/handler.handler
    events:
      - http: { path: /work }
      - queue: { name: jobs }
`);
  const user = plan.functions.filter((fn) => fn.logicalName === "worker");
  assert.equal(user.length, 2);
  assert.deepEqual(
    user.map((fn) => fn.events[0].type),
    ["http", "queue"],
  );
});

test("Google Cloud keeps HTTP and schedule together and splits one background trigger", () => {
  const { plan } = compile(`
service: shop
provider:
  name: gcp
  gcp: { project: demo-project }
functions:
  worker:
    handler: src/handler.handler
    events:
      - http: { path: /work }
      - schedule: { expression: rate(5 minutes) }
      - queue: { name: jobs }
`);
  const user = plan.functions.filter((fn) => fn.logicalName === "worker");
  assert.equal(user.length, 2);
  assert.equal(user[0].entry, "gcp-http");
  assert.equal(user[1].entry, "gcp-event");
});

test("a portable workflow adds an internal route and a runner", () => {
  const { plan } = compile(`
service: shop
provider: { name: azure }
functions:
  charge:
    handler: src/charge.handler
    events:
      - http: { path: /charge, method: POST }
workflows:
  order:
    engine: portable
    startAt: charge
    states:
      charge: { type: task, function: charge, end: true }
`);
  assert.equal(plan.needsInvokeToken, true);
  assert.ok(plan.functions.some((fn) => fn.logicalName === "__sk_workflow_runner"));
  const charge = plan.functions.find((fn) => fn.logicalName === "charge" && fn.events.some((event) => event.type === "http" && event.http.internal));
  assert.ok(charge);
});
