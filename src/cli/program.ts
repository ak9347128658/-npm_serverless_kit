import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { PROVIDERS } from "../catalog.js";
import { loadConfig } from "../config/load.js";
import { validateConfig } from "../config/rules.js";
import { runLifecycle } from "../deploy/engine.js";
import { KitError } from "../errors.js";
import { planDeployment } from "../plan/physical.js";
import { buildModel, formatInfo } from "../manifest/model.js";
import { invokeLocal } from "../local/invoke.js";
import { startDevServer } from "../local/dev-server.js";
import { startDashboard, writeDashboard } from "../ui/server.js";
import { initProject } from "./init.js";
import { PROVIDER_NAMES, type KitEventType, type ProviderName } from "../types.js";
import { runWorkflow } from "../runtime/workflow.js";

const EVENT_TYPES = ["http", "schedule", "queue", "topic", "storage", "event", "stream", "workflow", "invoke"] as const;

export function createProgram(): Command {
  const program = new Command();
  program
    .name("sk")
    .description("serverless-kit: one Node.js handler, per-cloud YAML, Terraform underneath.")
    .version("0.1.0");

  program
    .command("init")
    .argument("[dir]", "directory to create", ".")
    .option("--service <name>", "service name", "hello")
    .action((dir: string, opts: { service: string }) => {
      initProject(path.resolve(dir), opts.service);
      console.log(`Created serverless-kit.yml and src/handler.js in ${path.resolve(dir)}`);
    });

  program
    .command("validate")
    .option("-c, --config <file>", "config file")
    .option("--stage <stage>", "override stage")
    .option("--region <region>", "override region")
    .action(async (opts) => {
      const loaded = loadConfig(process.cwd(), opts, opts.config);
      const warnings = validateConfig(loaded.config, { dir: loaded.dir, checkFiles: true, mode: "validate" });
      planDeployment(loaded.config);
      for (const warning of warnings) console.log(`warning: ${warning}`);
      console.log(`Valid ${loaded.file}`);
    });

  program
    .command("package")
    .option("-c, --config <file>", "config file")
    .option("--stage <stage>", "override stage")
    .option("--region <region>", "override region")
    .action(async (opts) => {
      const result = await packageOrDeploy("package", opts);
      console.log(`Packaged ${result.outDir}`);
      console.log(`Preview UI ${result.uiPath}`);
    });

  program
    .command("plan")
    .option("-c, --config <file>", "config file")
    .option("--stage <stage>", "override stage")
    .option("--region <region>", "override region")
    .action(async (opts) => {
      await packageOrDeploy("plan", opts);
    });

  program
    .command("deploy")
    .option("-c, --config <file>", "config file")
    .option("--stage <stage>", "override stage")
    .option("--region <region>", "override region")
    .action(async (opts) => {
      const result = await packageOrDeploy("deploy", opts);
      console.log(`Deployment record ${result.deploymentPath}`);
      console.log(`Dashboard ${result.uiPath}`);
      console.log("Open it with: sk ui");
    });

  program
    .command("destroy")
    .option("-c, --config <file>", "config file")
    .option("--yes", "destroy cloud resources without another prompt")
    .action(async (opts) => {
      if (!opts.yes) {
        throw new KitError("sk destroy removes cloud resources. Re-run with --yes once you have confirmed the workspace.");
      }
      const loaded = loadConfig(process.cwd(), {}, opts.config);
      await runLifecycle({ dir: loaded.dir, config: loaded.config, mode: "destroy", autoApprove: true });
      console.log("Destroy finished.");
    });

  program
    .command("info")
    .option("-c, --config <file>", "config file")
    .action((opts) => {
      const loaded = loadConfig(process.cwd(), {}, opts.config);
      const record = path.join(loaded.dir, ".serverless-kit", "deployment.json");
      if (fs.existsSync(record)) {
        console.log(formatInfo(JSON.parse(fs.readFileSync(record, "utf8"))));
        return;
      }
      const plan = planDeployment(loaded.config);
      console.log(formatInfo(buildModel(loaded.config, plan)));
    });

  program
    .command("ui")
    .option("-c, --config <file>", "config file")
    .option("-p, --port <port>", "local port", "7070")
    .action(async (opts) => {
      const loaded = loadConfig(process.cwd(), {}, opts.config);
      const record = path.join(loaded.dir, ".serverless-kit", "deployment.json");
      const uiPath = loaded.config.ui.out
        ? path.resolve(loaded.dir, loaded.config.ui.out)
        : path.join(loaded.dir, ".serverless-kit", "ui", "index.html");
      if (!fs.existsSync(uiPath)) {
        const raw = fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, "utf8")) : buildModel(loaded.config, planDeployment(loaded.config));
        writeDashboard(uiPath, raw);
      }
      const server = await startDashboard(uiPath, Number(opts.port));
      console.log(`Dashboard ${server.url}`);
      console.log(`File ${uiPath}`);
      await new Promise(() => {});
    });

  program
    .command("invoke")
    .argument("<function>", "logical function name")
    .option("-c, --config <file>", "config file")
    .option("-t, --type <type>", "event type")
    .option("-e, --event <file>", "JSON event file")
    .option("--data <json>", "JSON payload")
    .option("--method <method>", "HTTP method")
    .option("--path <path>", "HTTP path")
    .action(async (name: string, opts) => {
      const loaded = loadConfig(process.cwd(), {}, opts.config);
      const type = opts.type as KitEventType | undefined;
      if (type && !(EVENT_TYPES as readonly string[]).includes(type)) {
        throw new KitError(`--type must be one of ${EVENT_TYPES.join(", ")}.`);
      }
      const event = opts.event ? JSON.parse(fs.readFileSync(path.resolve(opts.event), "utf8")) : opts.data ? JSON.parse(opts.data) : undefined;
      const result = await invokeLocal({
        dir: loaded.dir,
        config: loaded.config,
        name,
        type,
        event,
        method: opts.method,
        path: opts.path,
      });
      console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
    });

  program
    .command("workflow")
    .argument("<name>", "workflow name")
    .option("-c, --config <file>", "config file")
    .option("--data <json>", "JSON input", "{}")
    .action(async (name: string, opts) => {
      const loaded = loadConfig(process.cwd(), {}, opts.config);
      const workflow = loaded.config.workflows[name];
      if (!workflow) throw new KitError(`No workflow named ${name}.`);
      const input = JSON.parse(opts.data) as unknown;
      const output = await runWorkflow(name, { ...workflow, engine: "portable" }, input, async (functionName, payload) => {
        const result = await invokeLocal({
          dir: loaded.dir,
          config: loaded.config,
          name: functionName,
          type: "workflow",
          event: { workflow: name, step: functionName, input: payload },
        });
        return result;
      });
      console.log(JSON.stringify(output, null, 2));
    });

  program
    .command("dev")
    .option("-c, --config <file>", "config file")
    .option("-p, --port <port>", "local port", "3000")
    .action(async (opts) => {
      const loaded = loadConfig(process.cwd(), {}, opts.config);
      const server = await startDevServer(loaded.dir, loaded.config, Number(opts.port));
      console.log(`Local routes at ${server.url}`);
      console.log("Direct invoke: POST /__sk/call/<function>");
      await new Promise(() => {});
    });

  program.command("doctor").action(async () => {
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    console.log(`node ${process.versions.node} ${nodeMajor >= 18 ? "ok" : "need 18+"}`);
    const checks: Array<[string, string[]]> = [
      ["terraform", ["version"]],
      ["aws", ["--version"]],
      ["gcloud", ["--version"]],
      ["az", ["version"]],
      ["doctl", ["version"]],
    ];
    for (const [command, args] of checks) {
      const ok = await exists(command, args);
      console.log(`${command} ${ok ? "found" : "not on PATH"}`);
    }
    console.log("Providers:");
    for (const name of PROVIDER_NAMES) {
      const info = PROVIDERS[name];
      console.log(`  ${name}  ${info.product}`);
    }
  });

  return program;
}

async function packageOrDeploy(
  mode: "package" | "plan" | "deploy",
  opts: { config?: string; stage?: string; region?: string; provider?: ProviderName },
) {
  const loaded = loadConfig(process.cwd(), { stage: opts.stage, region: opts.region, provider: opts.provider }, opts.config);
  const result = await runLifecycle({ dir: loaded.dir, config: loaded.config, mode, autoApprove: true });
  for (const warning of result.warnings) console.log(`warning: ${warning}`);
  return result;
}

async function exists(command: string, args: string[]): Promise<boolean> {
  try {
    const { runCommand } = await import("../deploy/shell.js");
    const result = await runCommand(command, args, process.cwd(), false);
    return result.code === 0;
  } catch {
    return false;
  }
}

