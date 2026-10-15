import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";
import { resolveHandler } from "../config/rules.js";
import { KitError } from "../errors.js";
import { runtimeModule, toPosix } from "../paths.js";
import type { EventConfig, KitConfig, PhysicalFunction, PlanResult, WorkflowConfig } from "../types.js";
import { azureResourceName } from "../util/hash.js";
import { normalizeSchedule } from "../util/schedule.js";
import { zipStore, type ZipEntry } from "../util/zip.js";

export interface BundleOutput {
  root: string;
  functions: Array<{
    physicalName: string;
    directory: string;
    file: string;
    zip?: string;
  }>;
  azureZip?: string;
  digitaloceanDir?: string;
}

export async function bundleService(projectDir: string, config: KitConfig, plan: PlanResult, buildDir: string): Promise<BundleOutput> {
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  const functions: BundleOutput["functions"] = [];
  const workflows = Object.fromEntries(plan.workflows.map((workflow) => [workflow.name, workflow.config]));

  for (const fn of plan.functions) {
    const directory = path.join(buildDir, "functions", fn.physicalName);
    fs.mkdirSync(directory, { recursive: true });
    const entry = path.join(directory, "entry.mjs");
    fs.writeFileSync(entry, renderEntry(projectDir, config, fn, workflows), "utf8");
    const format = fn.entry === "cloudflare" ? "esm" : "cjs";
    const extension = format === "esm" ? "mjs" : "js";
    const outfile =
      fn.entry === "cloudflare"
        ? path.join(buildDir, "workers", `${fn.physicalName}.mjs`)
        : path.join(directory, `index.${extension}`);
    fs.mkdirSync(path.dirname(outfile), { recursive: true });
    await esbuild.build({
      absWorkingDir: projectDir,
      entryPoints: [entry],
      bundle: true,
      platform: "node",
      format,
      target: fn.esbuildTarget,
      outfile,
      sourcemap: config.package.sourcemap ?? false,
      minify: config.package.minify ?? false,
      external: config.package.external ?? [],
      logLevel: "silent",
      legalComments: "none",
    });
    let zip: string | undefined;
    if (needsZip(config.provider.name) && fn.entry !== "cloudflare") {
      const zipPath = path.join(buildDir, "zips", `${fn.physicalName}.zip`);
      fs.mkdirSync(path.dirname(zipPath), { recursive: true });
      const js = fs.readFileSync(outfile);
      fs.writeFileSync(zipPath, zipStore([{ name: "index.js", data: js }]));
      zip = zipPath;
    }
    if (fn.entry === "oracle") {
      const oracleDir = path.join(buildDir, "oracle", fn.physicalName);
      fs.mkdirSync(oracleDir, { recursive: true });
      fs.copyFileSync(outfile, path.join(oracleDir, "index.js"));
      fs.writeFileSync(path.join(oracleDir, "Dockerfile"), dockerfile(fn.providerRuntime), "utf8");
    }
    functions.push({ physicalName: fn.physicalName, directory, file: outfile, zip });
  }

  let azureZip: string | undefined;
  if (config.provider.name === "azure") {
    azureZip = writeAzureSite(buildDir, plan.functions);
  }
  let digitaloceanDir: string | undefined;
  if (config.provider.name === "digitalocean") {
    digitaloceanDir = writeDigitalOcean(buildDir, config, plan.functions);
  }
  return { root: buildDir, functions, azureZip, digitaloceanDir };
}

function needsZip(provider: KitConfig["provider"]["name"]): boolean {
  return provider !== "cloudflare" && provider !== "digitalocean" && provider !== "oracle";
}

function renderEntry(
  projectDir: string,
  config: KitConfig,
  fn: PhysicalFunction,
  workflows: Record<string, WorkflowConfig>,
): string {
  const adapter = importPath(runtimeModule("adapter"));
  const metaJson = JSON.stringify({
    provider: config.provider.name,
    functionName: fn.physicalName,
    logicalName: fn.logicalName,
    memory: fn.memory,
    timeout: fn.timeout,
    azureBinding: fn.azureBinding,
  });
  const userSource =
    fn.logicalName === "__sk_workflow_runner"
      ? `import { createWorkflowHandler } from ${adapter};
const user = createWorkflowHandler(${JSON.stringify(workflows)});`
      : userImport(projectDir, fn);
  return platformWrap(fn, adapter, `${userSource}\nconst meta = ${metaJson};`);
}

function userImport(projectDir: string, fn: PhysicalFunction): string {
  const resolved = resolveHandler(projectDir, fn.handler, fn.logicalName);
  return `import * as userMod from ${importPath(resolved.file)};
const exportName = ${JSON.stringify(resolved.exportName)};
const user = userMod[exportName] || userMod.default;
if (typeof user !== "function") {
  throw new Error("serverless-kit: " + ${JSON.stringify(fn.handler)} + " does not export a function named " + exportName);
}`;
}

function platformWrap(fn: PhysicalFunction, adapter: string, head: string): string {
  switch (fn.entry) {
    case "cloudflare":
      return `${head}
import { createCloudflareHandlers } from ${adapter};
export default createCloudflareHandlers(user, meta);
`;
    case "gcp-http":
      return `${head}
import { createGcpHttpHandler } from ${adapter};
export const handler = createGcpHttpHandler(user, meta);
`;
    case "gcp-event":
      return `${head}
import { createGcpEventHandler } from ${adapter};
export const handler = createGcpEventHandler(user, meta);
`;
    case "azure":
      return `${head}
import { createAzureHandler } from ${adapter};
export const handler = createAzureHandler(user, meta);
`;
    case "openwhisk":
      return `${head}
import { createOpenWhiskHandler } from ${adapter};
export const main = createOpenWhiskHandler(user, meta);
`;
    case "oracle":
      return `${head}
import http from "node:http";
import { createLambdaHandler, createOracleHandler } from ${adapter};
const handle = createOracleHandler(user, meta);
export const handler = createLambdaHandler(user, meta);
if (process.env.SK_ORACLE_LISTEN !== "0") {
  const port = Number(process.env.PORT || process.env.FN_PORT || 8080);
  http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(error instanceof Error ? error.message : "error");
    });
  }).listen(port);
}
`;
    default:
      return `${head}
import { createLambdaHandler } from ${adapter};
export const handler = createLambdaHandler(user, meta);
`;
  }
}

function importPath(file: string): string {
  return JSON.stringify(toPosix(file));
}

function dockerfile(imageTag: string): string {
  const base = imageTag.startsWith("node:") ? imageTag : "node:20-bookworm-slim";
  return `FROM ${base}
WORKDIR /function
COPY index.js ./index.js
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "index.js"]
`;
}

function writeAzureSite(buildDir: string, functions: PhysicalFunction[]): string {
  const entries: ZipEntry[] = [
    {
      name: "host.json",
      data: Buffer.from(
        JSON.stringify(
          {
            version: "2.0",
            extensionBundle: {
              id: "Microsoft.Azure.Functions.ExtensionBundle",
              version: "[4.*, 5.0.0)",
            },
          },
          null,
          2,
        ),
      ),
    },
  ];
  for (const fn of functions) {
    const js = fs.readFileSync(path.join(buildDir, "functions", fn.physicalName, "index.js"));
    entries.push({ name: `${fn.physicalName}/index.js`, data: js });
    entries.push({
      name: `${fn.physicalName}/function.json`,
      data: Buffer.from(JSON.stringify(azureFunctionJson(fn), null, 2)),
    });
  }
  const zipPath = path.join(buildDir, "azure-site.zip");
  fs.writeFileSync(zipPath, zipStore(entries));
  return zipPath;
}

function azureFunctionJson(fn: PhysicalFunction): unknown {
  const event = fn.events[0];
  const binding = bindingFor(fn, event);
  return {
    entryPoint: "handler",
    scriptFile: "index.js",
    bindings: [binding, ...(fn.azureBinding === "http" || !fn.azureBinding ? [{ type: "http", direction: "out", name: "$return" }] : [])],
  };
}

function bindingFor(fn: PhysicalFunction, event: EventConfig | undefined): Record<string, unknown> {
  if (!event || event.type === "http") {
    const http = event?.type === "http" ? event.http : undefined;
    const route = (http?.path ?? `/invoke/${fn.logicalName}`).replace(/^\//, "");
    const authLevel = http?.internal ? "anonymous" : http?.auth === "public" ? "anonymous" : "function";
    return {
      authLevel,
      type: "httpTrigger",
      direction: "in",
      name: "req",
      methods: [(http?.method ?? "POST").toLowerCase() === "any" ? "get" : (http?.method ?? "POST").toLowerCase()],
      route,
    };
  }
  if (event.type === "schedule") {
    return {
      name: "timer",
      type: "timerTrigger",
      direction: "in",
      schedule: normalizeSchedule(event.schedule.expression, event.schedule.timezone).azure,
    };
  }
  if (event.type === "queue") {
    return {
      name: "queueItem",
      type: "queueTrigger",
      direction: "in",
      queueName: azureResourceName(event.queue.name ?? "kit-queue", "queue"),
      connection: "AzureWebJobsStorage",
    };
  }
  if (event.type === "topic") {
    return {
      name: "message",
      type: "serviceBusTrigger",
      direction: "in",
      topicName: event.topic.name ?? "kit-topic",
      subscriptionName: "kit",
      connection: "SK_SERVICEBUS",
    };
  }
  return {
    name: "blob",
    type: "blobTrigger",
    direction: "in",
    path: `${event.type === "storage" ? azureResourceName(event.storage.bucket, "data") : "data"}/{name}`,
    connection: "AzureWebJobsStorage",
  };
}

function writeDigitalOcean(buildDir: string, config: KitConfig, functions: PhysicalFunction[]): string {
  const root = path.join(buildDir, "digitalocean");
  const packageName = config.service.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30) || "kit";
  for (const fn of functions) {
    const destDir = path.join(root, "packages", packageName, fn.physicalName);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(path.join(buildDir, "functions", fn.physicalName, "index.js"), path.join(destDir, "index.js"));
  }
  const spec = {
    packages: [
      {
        name: packageName,
        environment: reservedEnv(config, "service"),
        functions: functions.map((fn) => ({
          name: fn.physicalName,
          runtime: fn.providerRuntime,
          web: fn.events.some((event) => event.type === "http") || fn.events.length === 0,
          limits: { timeout: fn.timeout * 1000, memory: fn.memory },
          environment: {
            ...fn.environment,
            SK_PROVIDER: "digitalocean",
            SK_FUNCTION_NAME: fn.physicalName,
            SK_LOGICAL_NAME: fn.logicalName,
            SK_SERVICE: config.service,
            SK_STAGE: config.provider.stage,
            SK_REGION: config.provider.region,
          },
          triggers: fn.events
            .filter((event) => event.type === "schedule")
            .map((event, index) => ({
              name: `${fn.physicalName}-schedule-${index + 1}`,
              sourceType: "scheduler",
              sourceDetails: {
                cron: normalizeSchedule(event.schedule.expression, event.schedule.timezone).unix,
              },
            })),
        })),
      },
    ],
  };
  const projectYaml = toProjectYaml(spec);
  fs.writeFileSync(path.join(root, "project.yml"), projectYaml, "utf8");
  const stamps = functions.map((fn) => {
    const file = path.join(root, "packages", packageName, fn.physicalName, "index.js");
    const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    return `${fn.physicalName} ${digest}`;
  });
  fs.writeFileSync(path.join(root, ".sk-code-stamp"), `${stamps.join("\n")}\n`, "utf8");
  return root;
}

function reservedEnv(config: KitConfig, _kind: string): Record<string, string> {
  return {
    SK_PROVIDER: config.provider.name,
    SK_SERVICE: config.service,
    SK_STAGE: config.provider.stage,
    SK_REGION: config.provider.region,
  };
}

function toProjectYaml(spec: {
  packages: Array<{
    name: string;
    environment: Record<string, string>;
    functions: Array<Record<string, unknown>>;
  }>;
}): string {
  const lines: string[] = ["packages:"];
  for (const pkg of spec.packages) {
    lines.push(`  - name: ${pkg.name}`);
    lines.push("    environment:");
    for (const [key, value] of Object.entries(pkg.environment)) lines.push(`      ${key}: ${JSON.stringify(value)}`);
    lines.push("    functions:");
    for (const fn of pkg.functions) {
      lines.push(`      - name: ${String(fn.name)}`);
      lines.push(`        runtime: ${JSON.stringify(fn.runtime)}`);
      lines.push(`        web: ${fn.web ? "true" : "false"}`);
      const limits = fn.limits as { timeout: number; memory: number };
      lines.push("        limits:");
      lines.push(`          timeout: ${limits.timeout}`);
      lines.push(`          memory: ${limits.memory}`);
      lines.push("        environment:");
      for (const [key, value] of Object.entries(fn.environment as Record<string, string>)) {
        lines.push(`          ${key}: ${JSON.stringify(value)}`);
      }
      const triggers = fn.triggers as Array<{ name: string; sourceType: string; sourceDetails: { cron: string } }>;
      if (triggers.length > 0) {
        lines.push("        triggers:");
        for (const trigger of triggers) {
          lines.push(`          - name: ${trigger.name}`);
          lines.push(`            sourceType: ${trigger.sourceType}`);
          lines.push("            sourceDetails:");
          lines.push(`              cron: ${JSON.stringify(trigger.sourceDetails.cron)}`);
        }
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function assertBundled(output: BundleOutput): void {
  if (output.functions.length === 0) throw new KitError("Nothing was bundled.");
}
