import yaml from "js-yaml";
import { parseConfig } from "../src/config/schema.js";
import { validateConfig } from "../src/config/rules.js";
import { planDeployment } from "../src/plan/physical.js";
import { renderTerraform } from "../src/terraform/render.js";
import type { KitConfig, PlanResult } from "../src/types.js";

export function compile(doc: string, platform: NodeJS.Platform = "linux"): {
  config: KitConfig;
  warnings: string[];
  plan: PlanResult;
  tf: string;
} {
  const config = parseConfig(yaml.load(doc));
  const warnings = validateConfig(config, { checkFiles: false });
  const plan = planDeployment(config);
  const files = renderTerraform(config, plan, platform);
  return { config, warnings, plan, tf: files["main.tf"] };
}
