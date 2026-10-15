import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseConfig } from "../src/config/schema.js";
import { validateConfig } from "../src/config/rules.js";
import { bundleService } from "../src/package/bundle.js";
import { planDeployment } from "../src/plan/physical.js";
import yaml from "js-yaml";

test("JavaScript and TypeScript handlers bundle to the same handler export", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sk-bundle-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(
    path.join(dir, "src", "js-handler.js"),
    "exports.handler = async (event) => ({ statusCode: 200, body: event.type });\n",
  );
  fs.writeFileSync(
    path.join(dir, "src", "ts-handler.ts"),
    "export async function handler(event: { provider: string }): Promise<{ statusCode: number; body: { provider: string } }> {\n  return { statusCode: 200, body: { provider: event.provider } };\n}\n",
  );
  const config = parseConfig(
    yaml.load(`
service: shop
provider: { name: aws, runtime: nodejs20 }
functions:
  fromJs:
    handler: src/js-handler.handler
    events:
      - http: { path: /js }
  fromTs:
    handler: src/ts-handler.handler
    events:
      - http: { path: /ts }
`),
  );
  validateConfig(config, { dir, checkFiles: true });
  const plan = planDeployment(config);
  const built = await bundleService(dir, config, plan, path.join(dir, ".serverless-kit", "build"));
  for (const name of ["fromJs", "fromTs"]) {
    const file = path.join(built.root, "functions", name, "index.js");
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /exports\.handler|handler/);
    const zip = fs.readFileSync(path.join(built.root, "zips", `${name}.zip`));
    assert.equal(zip.subarray(0, 2).toString("latin1"), "PK");
  }
  const tsBundle = fs.readFileSync(path.join(built.root, "functions", "fromTs", "index.js"), "utf8");
  assert.match(tsBundle, /statusCode/);
  assert.doesNotMatch(tsBundle, /import type/);
});
