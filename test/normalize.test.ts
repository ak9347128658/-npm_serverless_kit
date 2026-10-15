import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeEvent } from "../src/runtime/normalize.js";

test("API Gateway v2 becomes an HTTP event", () => {
  const event = normalizeEvent(
    {
      version: "2.0",
      rawPath: "/hello",
      body: JSON.stringify({ name: "ada" }),
      headers: { "content-type": "application/json" },
      requestContext: { http: { method: "POST", sourceIp: "127.0.0.1" } },
    },
    { provider: "aws" },
  );
  assert.equal(event.type, "http");
  assert.equal(event.http?.method, "POST");
  assert.equal(event.http?.path, "/hello");
  assert.deepEqual(event.body, { name: "ada" });
});

test("SQS records become a queue event", () => {
  const event = normalizeEvent(
    { Records: [{ eventSource: "aws:sqs", messageId: "m1", body: "{\"ok\":true}" }] },
    { provider: "aws" },
  );
  assert.equal(event.type, "queue");
  assert.equal(event.records?.[0]?.id, "m1");
  assert.deepEqual(event.records?.[0]?.body, { ok: true });
});

test("EventBridge schedule events stay schedules", () => {
  const event = normalizeEvent(
    { source: "aws.events", "detail-type": "Scheduled Event", time: "2026-01-01T00:00:00Z" },
    { provider: "aws" },
  );
  assert.equal(event.type, "schedule");
  assert.equal(event.schedule?.time, "2026-01-01T00:00:00Z");
});

test("a direct invoke payload stays an invoke", () => {
  const event = normalizeEvent({ hello: "world" }, { provider: "oracle" });
  assert.equal(event.type, "invoke");
  assert.equal(event.provider, "oracle");
});

test("workflow envelopes are recognized on every provider", () => {
  const event = normalizeEvent(
    { __sk: { type: "workflow", workflow: "order", step: "charge" }, input: { id: 7 } },
    { provider: "azure" },
  );
  assert.equal(event.type, "workflow");
  assert.equal(event.workflow?.name, "order");
  assert.equal(event.workflow?.step, "charge");
  assert.deepEqual(event.body, { id: 7 });
});
