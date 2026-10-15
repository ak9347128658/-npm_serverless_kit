import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { KitError } from "../errors.js";
import type { KitConfig, KitEventType, PhysicalFunction } from "../types.js";
import { planDeployment } from "../plan/physical.js";
import { bundleService } from "../package/bundle.js";
import { sampleEvent } from "./samples.js";

const require = createRequire(import.meta.url);

export interface InvokeOptions {
  dir: string;
  config: KitConfig;
  name: string;
  type?: KitEventType;
  event?: unknown;
  method?: string;
  path?: string;
}

export async function invokeLocal(options: InvokeOptions): Promise<unknown> {
  const plan = planDeployment(options.config);
  const fn = plan.functions.find((item) => item.logicalName === options.name || item.physicalName === options.name);
  if (!fn) throw new KitError(`No function named "${options.name}".`);
  const buildDir = path.join(options.dir, ".serverless-kit", "build");
  const bundled = await bundleService(options.dir, options.config, plan, buildDir);
  const artifact = bundled.functions.find((item) => item.physicalName === fn.physicalName);
  if (!artifact) throw new KitError(`Bundle for ${fn.physicalName} was not written.`);
  const previous = process.env.SK_ORACLE_LISTEN;
  process.env.SK_ORACLE_LISTEN = "0";
  try {
    return await callHandler(fn, artifact.file, options);
  } finally {
    if (previous === undefined) delete process.env.SK_ORACLE_LISTEN;
    else process.env.SK_ORACLE_LISTEN = previous;
  }
}

async function callHandler(fn: PhysicalFunction, file: string, options: InvokeOptions): Promise<unknown> {
  const type = options.type ?? "invoke";
  const payload = options.event ?? {};
  if (fn.entry === "cloudflare") {
    const mod = load(file) as { default: { fetch: (request: Request, env: NodeJS.ProcessEnv) => Promise<Response>; scheduled: Function; queue: Function } };
    if (type === "schedule") {
      await mod.default.scheduled(sampleEvent(options.config.provider.name, "schedule", payload), process.env, {});
      return { ok: true };
    }
    if (type === "queue") {
      await mod.default.queue(sampleEvent(options.config.provider.name, "queue", payload), process.env);
      return { ok: true };
    }
    const request = new Request(`http://127.0.0.1${options.path ?? "/"}`, {
      method: options.method ?? "POST",
      headers: { "content-type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
    const response = await mod.default.fetch(request, process.env);
    const text = await response.text();
    return { statusCode: response.status, body: parseJson(text) };
  }
  const mod = load(file) as { handler?: Function; main?: Function; default?: Function };
  const handler = mod.handler || mod.main || (typeof mod.default === "function" ? mod.default : undefined);
  if (!handler) throw new KitError(`Bundle ${file} has no handler export.`);
  const raw = options.event && options.type === undefined ? options.event : sampleEvent(options.config.provider.name, type, payload, { method: options.method, path: options.path });
  const context = {
    awsRequestId: `local-${Date.now()}`,
    functionName: fn.physicalName,
    getRemainingTimeInMillis: () => (fn.timeout ?? 30) * 1000,
  };
  return handler(raw, context);
}

function load(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) throw new KitError(`Missing bundle ${file}`);
  const resolved = path.resolve(file);
  delete require.cache[resolved];
  return require(resolved) as Record<string, unknown>;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function matchRoute(template: string, method: string, actualMethod: string, pathname: string): Record<string, string> | undefined {
  if (method !== "ANY" && method.toUpperCase() !== actualMethod.toUpperCase()) return undefined;
  const left = template.split("/").filter(Boolean);
  const right = pathname.split("/").filter(Boolean);
  if (left.length !== right.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < left.length; i += 1) {
    const token = left[i];
    if (token.startsWith("{") && token.endsWith("}")) params[token.slice(1, -1)] = decodeURIComponent(right[i]);
    else if (token !== right[i]) return undefined;
  }
  return params;
}
