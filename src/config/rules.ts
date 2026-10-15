import fs from "node:fs";
import path from "node:path";
import { EVENT_SUPPORT, NATIVE_WORKFLOW, unsupportedHint } from "../catalog.js";
import { ConfigError, UnsupportedEventError } from "../errors.js";
import type { KitConfig } from "../types.js";
import { normalizeSchedule } from "../util/schedule.js";

const HANDLER_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".cts"];

export interface CheckOptions {
  dir?: string;
  checkFiles?: boolean;
  /** deploy requires an Oracle image. package and validate do not. */
  mode?: "validate" | "package" | "deploy";
}

export function validateConfig(config: KitConfig, options: CheckOptions = {}): string[] {
  const warnings: string[] = [];
  const provider = config.provider.name;
  requireProviderBlock(config);

  if (config.provider.memory < 128) {
    throw new ConfigError("provider.memory must be at least 128 MB.");
  }
  if (config.provider.timeout < 1 || config.provider.timeout > 900) {
    throw new ConfigError("provider.timeout must be between 1 and 900 seconds.");
  }

  for (const [name, fn] of Object.entries(config.functions)) {
    const memory = fn.memory ?? config.provider.memory;
    const timeout = fn.timeout ?? config.provider.timeout;
    if (memory < 128) throw new ConfigError(`Function "${name}" memory must be at least 128 MB.`);
    if (timeout < 1 || timeout > 900) {
      throw new ConfigError(`Function "${name}" timeout must be between 1 and 900 seconds.`);
    }
    if (options.checkFiles !== false && options.dir) {
      resolveHandler(options.dir, fn.handler, name);
    }
    if (provider === "gcp") {
      const background = fn.events.filter((event) => event.type !== "http" && event.type !== "schedule");
      if (background.length > 1) {
        throw new ConfigError(
          `Function "${name}" has ${background.length} background triggers (${background.map((event) => event.type).join(", ")}). Google Cloud Functions (2nd gen) allows one event trigger per function. Split them into separate functions. HTTP routes and schedules can stay together because schedules call the HTTP function.`,
        );
      }
    }
    for (const event of fn.events) {
      if (EVENT_SUPPORT[provider][event.type] !== "yes") {
        throw new UnsupportedEventError(provider, name, event.type, unsupportedHint(event.type));
      }
      if (event.type === "schedule") {
        normalizeSchedule(event.schedule.expression, event.schedule.timezone);
      }
      if ((event.type === "queue" || event.type === "topic" || event.type === "storage") && provider === "alibaba") {
        if (!config.provider.alibaba?.roleArn) {
          throw new ConfigError(
            `Function "${name}" uses a ${event.type} trigger on Alibaba Cloud. Set provider.alibaba.roleArn to the Function Compute RAM role that can reach that service.`,
          );
        }
      }
      if (event.type === "queue" && event.queue.create === false && !event.queue.arn && !event.queue.name) {
        throw new ConfigError(`Function "${name}" queue trigger needs a name or an arn.`);
      }
    }
  }

  for (const [name, workflow] of Object.entries(config.workflows)) {
    if (workflow.engine === "native" && !NATIVE_WORKFLOW[provider]) {
      warnings.push(`Workflow "${name}" requested engine native. ${provider} uses the portable runner.`);
    }
    for (const [stateName, state] of Object.entries(workflow.states)) {
      if (state.type === "wait" && workflow.engine === "portable" && state.seconds > 10) {
        throw new ConfigError(
          `Workflow "${name}" state "${stateName}" waits ${state.seconds}s. The portable runner only waits up to 10 seconds inside one invocation. Use engine: native on AWS or Google Cloud for longer waits.`,
        );
      }
    }
  }

  if (provider === "digitalocean" && Object.keys(config.workflows).length > 0) {
    throw new ConfigError(
      "DigitalOcean Functions in serverless-kit support HTTP and schedules. A workflow needs invoke URLs while Terraform is planning, and DigitalOcean only assigns those URLs during deploy. Use HTTP calls, or run the workflow on AWS or Google Cloud.",
    );
  }

  if (
    provider === "cloudflare" &&
    Object.values(config.workflows).some((workflow) => workflow.engine === "portable") &&
    !config.provider.cloudflare?.workersDevSubdomain
  ) {
    throw new ConfigError(
      "A portable workflow on Cloudflare calls functions over HTTP. Set provider.cloudflare.workersDevSubdomain to the account's workers.dev subdomain.",
    );
  }

  if (options.mode === "deploy" && provider === "oracle" && !config.provider.oracle?.image) {
    throw new ConfigError(
      "Deploying to Oracle Cloud needs provider.oracle.image (an OCIR image tag). Run sk package first. It writes a Dockerfile under .serverless-kit/build/oracle. Build and push that image, set provider.oracle.image, then deploy.",
    );
  }

  return warnings;
}

function requireProviderBlock(config: KitConfig): void {
  const name = config.provider.name;
  if (name === "gcp" && !config.provider.gcp?.project) {
    throw new ConfigError("Google Cloud needs provider.gcp.project.");
  }
  if (name === "cloudflare" && !config.provider.cloudflare?.accountId) {
    throw new ConfigError("Cloudflare needs provider.cloudflare.accountId.");
  }
  if (name === "ibm" && !config.provider.ibm?.namespace) {
    throw new ConfigError("IBM Cloud needs provider.ibm.namespace (the Cloud Functions namespace).");
  }
  if (name === "oracle") {
    if (!config.provider.oracle?.compartmentId || !config.provider.oracle.subnetIds?.length) {
      throw new ConfigError("Oracle Cloud needs provider.oracle.compartmentId and provider.oracle.subnetIds.");
    }
  }
  if (name === "huawei" && !config.provider.huawei?.agency) {
    throw new ConfigError("Huawei FunctionGraph needs provider.huawei.agency (the IAM agency name).");
  }
}

export function resolveHandler(dir: string, handler: string, functionName: string): { file: string; exportName: string } {
  const dot = handler.lastIndexOf(".");
  const rel = handler.slice(0, dot);
  const exportName = handler.slice(dot + 1);
  const candidates = [
    ...HANDLER_EXTENSIONS.map((ext) => path.resolve(dir, rel + ext)),
    ...HANDLER_EXTENSIONS.map((ext) => path.resolve(dir, rel, "index" + ext)),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) {
    throw new ConfigError(
      `Function "${functionName}" handler file not found for "${handler}". Tried:\n${candidates.map((item) => `  - ${item}`).join("\n")}`,
    );
  }
  return { file, exportName };
}
