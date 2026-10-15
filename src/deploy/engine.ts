import fs from "node:fs";
import path from "node:path";
import { validateConfig } from "../config/rules.js";
import { KitError } from "../errors.js";
import type { KitConfig, PlanResult } from "../types.js";
import { planDeployment } from "../plan/physical.js";
import { bundleService } from "../package/bundle.js";
import { buildModel, type TerraformOutputs } from "../manifest/model.js";
import { renderTerraform, writeTerraform } from "../terraform/render.js";
import { writeDashboard } from "../ui/server.js";
import { runHook } from "./hooks.js";
import { runCommand } from "./shell.js";

export interface DeployOptions {
  dir: string;
  config: KitConfig;
  mode: "package" | "plan" | "deploy" | "destroy";
  autoApprove?: boolean;
}

export interface DeployResult {
  outDir: string;
  uiPath: string;
  deploymentPath: string;
  warnings: string[];
}

export async function runLifecycle(options: DeployOptions): Promise<DeployResult> {
  const warnings = validateConfig(options.config, {
    dir: options.dir,
    checkFiles: true,
    mode: options.mode === "destroy" ? "deploy" : options.mode === "plan" ? "package" : options.mode,
  });
  const plan = planDeployment(options.config);
  warnings.push(...plan.warnings);
  const outDir = path.join(options.dir, ".serverless-kit");
  const buildDir = path.join(outDir, "build");
  const tfDir = path.join(outDir, "terraform");
  const deploymentPath = path.join(outDir, "deployment.json");
  const uiPath = options.config.ui.out ? path.resolve(options.dir, options.config.ui.out) : path.join(outDir, "ui", "index.html");

  if (options.mode === "destroy") {
    await terraform(tfDir, ["destroy", "-input=false", ...(options.autoApprove ? ["-auto-approve"] : [])]);
    return { outDir, uiPath, deploymentPath, warnings };
  }

  await runHook(options.dir, options.config, "beforePackage", { mode: options.mode });
  await bundleService(options.dir, options.config, plan, buildDir);
  const files = renderTerraform(options.config, plan);
  writeTerraform(tfDir, files);
  await runHook(options.dir, options.config, "afterPackage", { terraformDir: tfDir, buildDir });

  const planned = buildModel(options.config, plan, undefined);
  if (options.mode === "package") {
    writeDashboard(uiPath, planned);
    fs.writeFileSync(deploymentPath, JSON.stringify(planned, null, 2));
    return { outDir, uiPath, deploymentPath, warnings };
  }

  await runHook(options.dir, options.config, "beforeDeploy", { mode: options.mode });
  await terraform(tfDir, ["init", "-input=false"]);
  if (options.mode === "plan") {
    await terraform(tfDir, ["plan", "-input=false"]);
    writeDashboard(uiPath, planned);
    fs.writeFileSync(deploymentPath, JSON.stringify(planned, null, 2));
    return { outDir, uiPath, deploymentPath, warnings };
  }

  await terraform(tfDir, ["apply", "-input=false", "-auto-approve"]);
  const output = await terraform(tfDir, ["output", "-json"], false);
  let parsed: TerraformOutputs = {};
  try {
    parsed = JSON.parse(output.stdout) as TerraformOutputs;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new KitError(`Terraform apply finished, but the output was not JSON. ${message}`);
  }
  const deployed = buildModel(options.config, plan, parsed, new Date().toISOString());
  fs.writeFileSync(deploymentPath, JSON.stringify(deployed, null, 2));
  writeDashboard(uiPath, deployed);
  await runHook(options.dir, options.config, "afterDeploy", { deployment: deployed, uiPath });
  return { outDir, uiPath, deploymentPath, warnings };
}

async function terraform(cwd: string, args: string[], echo = true): Promise<{ stdout: string; stderr: string }> {
  if (!fs.existsSync(cwd)) {
    throw new KitError(`Terraform directory ${cwd} does not exist. Run sk package or sk deploy first.`);
  }
  let result;
  try {
    result = await runCommand("terraform", args, cwd, echo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new KitError(`${message}\nInstall Terraform from https://developer.hashicorp.com/terraform/install`);
  }
  if (result.code !== 0) {
    throw new KitError(`terraform ${args[0]} exited ${result.code}.`);
  }
  return result;
}

export function loadDeployment(dir: string): { file: string; raw: string } {
  const file = path.join(dir, ".serverless-kit", "deployment.json");
  if (!fs.existsSync(file)) {
    throw new KitError("No deployment record. Run sk package or sk deploy in this project.");
  }
  return { file, raw: fs.readFileSync(file, "utf8") };
}

export function previewPlan(config: KitConfig, dir: string): { plan: PlanResult; warnings: string[] } {
  const warnings = validateConfig(config, { dir, checkFiles: true, mode: "validate" });
  const plan = planDeployment(config);
  return { plan, warnings: [...warnings, ...plan.warnings] };
}
