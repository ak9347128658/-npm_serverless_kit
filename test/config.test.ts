import assert from "node:assert/strict";
import { test } from "node:test";
import yaml from "js-yaml";
import { parseConfig } from "../src/config/schema.js";
import { validateConfig } from "../src/config/rules.js";
import { ConfigError, UnsupportedEventError } from "../src/errors.js";

const http = `
service: shop
provider:
  name: aws
functions:
  hello:
    handler: src/handler.handler
    events:
      - http:
          path: hello
          method: post
`;

test("defaults fill region, stage, runtime, and a leading slash", () => {
  const config = parseConfig(parseYaml(http));
  assert.equal(config.provider.region, "us-east-1");
  assert.equal(config.provider.stage, "dev");
  assert.equal(config.provider.runtime, "nodejs20");
  assert.equal(config.functions.hello.events[0].type, "http");
  if (config.functions.hello.events[0].type === "http") {
    assert.equal(config.functions.hello.events[0].http.path, "/hello");
    assert.equal(config.functions.hello.events[0].http.method, "POST");
  }
});

test("CLI overlay replaces provider, stage, and region", () => {
  const config = parseConfig(parseYaml(http), { provider: "gcp", stage: "prod", region: "europe-west1" });
  assert.equal(config.provider.name, "gcp");
  assert.equal(config.provider.stage, "prod");
  assert.equal(config.provider.region, "europe-west1");
});

test("an event with two keys is rejected", () => {
  assert.throws(
    () =>
      parseConfig(
        parseYaml(`
service: shop
provider: { name: aws }
functions:
  hello:
    handler: src/handler.handler
    events:
      - http: { path: /a }
        schedule: { expression: "* * * * *" }
`),
      ),
    ConfigError,
  );
});

test("Oracle schedules are unsupported", () => {
  const config = parseConfig(
    parseYaml(`
service: shop
provider:
  name: oracle
  oracle:
    compartmentId: ocid1.compartment.oc1..example
    subnetIds: [ocid1.subnet.oc1..example]
functions:
  hello:
    handler: src/handler.handler
    events:
      - schedule: { expression: "rate(5 minutes)" }
`),
  );
  assert.throws(() => validateConfig(config, { checkFiles: false }), UnsupportedEventError);
});

test("a portable wait longer than 10 seconds is rejected", () => {
  const config = parseConfig(
    parseYaml(`
service: shop
provider: { name: azure }
functions:
  charge:
    handler: src/handler.handler
    events: []
workflows:
  order:
    engine: portable
    startAt: wait
    states:
      wait: { type: wait, seconds: 30, next: done }
      done: { type: succeed }
`),
  );
  assert.throws(() => validateConfig(config, { checkFiles: false }), /10 seconds/);
});

test("DigitalOcean workflows are rejected", () => {
  const config = parseConfig(
    parseYaml(`
service: shop
provider: { name: digitalocean }
functions:
  charge:
    handler: src/handler.handler
    events:
      - http: { path: /charge }
workflows:
  order:
    startAt: done
    states:
      done: { type: succeed }
`),
  );
  assert.throws(() => validateConfig(config, { checkFiles: false }), /workflow/i);
});

test("Huawei queues are rejected with a hint", () => {
  const config = parseConfig(
    parseYaml(`
service: shop
provider:
  name: huawei
  huawei: { agency: kit-agency }
functions:
  worker:
    handler: src/handler.handler
    events:
      - queue: { name: jobs }
`),
  );
  assert.throws(() => validateConfig(config, { checkFiles: false }), /topic|HTTP/i);
});

function parseYaml(text: string): unknown {
  return yaml.load(text);
}
