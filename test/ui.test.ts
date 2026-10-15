import assert from "node:assert/strict";
import { test } from "node:test";
import { buildModel } from "../src/manifest/model.js";
import { renderDashboard } from "../src/ui/render.js";
import { compile } from "./helpers.js";

test("the dashboard lists triggers and omits environment values", () => {
  const { config, plan } = compile(`
service: shop
provider:
  name: aws
  environment: { LOG_LEVEL: super-secret-value-xyz }
functions:
  charge:
    handler: src/charge.handler
    description: Takes a payment
    events:
      - http: { path: /charge, method: POST }
      - schedule: { expression: rate(5 minutes) }
`);
  const html = renderDashboard(buildModel(config, plan));
  assert.match(html, /charge/);
  assert.match(html, /Takes a payment/);
  assert.match(html, /POST/);
  assert.match(html, /rate\(5 minutes\)/);
  assert.match(html, /LOG_LEVEL/);
  assert.match(html, /sk deploy/);
  assert.doesNotMatch(html, /super-secret-value-xyz/);
});

test("a deployed model shows the ARN and not the preview banner text as the only state", () => {
  const { config, plan } = compile(`
service: shop
provider: { name: aws }
functions:
  charge:
    handler: src/charge.handler
    events:
      - http: { path: /charge }
`);
  const model = buildModel(
    config,
    plan,
    { sk_functions: { value: { [plan.functions[0].physicalName]: { arn: "arn:aws:lambda:us-east-1:1:function:charge", url: "https://example.test/charge", id: "charge" } } } },
    "2026-10-15T00:00:00.000Z",
  );
  const html = renderDashboard(model);
  assert.match(html, /arn:aws:lambda:us-east-1:1:function:charge/);
  assert.match(html, /https:\/\/example\.test\/charge/);
  assert.match(html, /2026-10-15T00:00:00.000Z/);
});
