import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import yaml from "js-yaml";
import { parseConfig } from "../src/config/schema.js";
import { validateConfig } from "../src/config/rules.js";
import { planDeployment } from "../src/plan/physical.js";
import { renderTerraform } from "../src/terraform/render.js";

test("every example YAML validates, plans, and renders Terraform", () => {
  const root = path.join(process.cwd(), "examples");
  const files = walk(root).filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"));
  assert.ok(files.length >= 20, `expected example YAML files, found ${files.length}`);
  for (const file of files) {
    const config = parseConfig(yaml.load(fs.readFileSync(file, "utf8")));
    validateConfig(config, { dir: path.dirname(file), checkFiles: true });
    const plan = planDeployment(config);
    const generated = renderTerraform(config, plan, "linux");
    assert.match(generated["main.tf"], /required_providers/, file);
  }
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
