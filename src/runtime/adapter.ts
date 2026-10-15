import type { AdapterMeta, KitContext, KitEvent, KitResult, WorkflowConfig } from "../types.js";
import { asRecord, stringField } from "./json.js";
import { normalizeEvent } from "./normalize.js";
import { bodyText, normalizeResult, resultHeaders, safeEqual, toLambdaResponse } from "./respond.js";
import { runWorkflow } from "./workflow.js";

export type UserHandler = (event: KitEvent, context: KitContext) => Promise<unknown> | unknown;

export async function dispatch(
  user: UserHandler,
  raw: unknown,
  contextRaw: unknown,
  meta: AdapterMeta,
  invokeToken?: string,
): Promise<{ transport: KitEvent["type"]; event: KitEvent; result: KitResult }> {
  let event = normalizeEvent(raw, { provider: meta.provider, azureBinding: meta.azureBinding });
  const transport = event.type;
  if (event.type === "http" && isInternalCall(event)) {
    const expected = invokeToken ?? readEnv("SK_INVOKE_TOKEN");
    const got = event.headers?.["x-sk-token"];
    if (expected && (!got || !safeEqual(got, expected))) {
      return {
        event,
        transport,
        result: { statusCode: 401, headers: { "content-type": "application/json" }, body: { error: "invalid invoke token" } },
      };
    }
    const body = asRecord(event.body);
    if (body?.__sk) event = normalizeEvent(body, { provider: meta.provider });
  }
  const context = buildContext(meta, contextRaw);
  const result = normalizeResult(await user(event, context));
  return { transport, event, result };
}

export function createLambdaHandler(user: UserHandler, meta: AdapterMeta) {
  return async function handler(event: unknown, context: unknown): Promise<unknown> {
    const ran = await dispatch(user, event, context, meta);
    return toLambdaResponse(ran.transport, ran.event, ran.result);
  };
}

export function createOpenWhiskHandler(user: UserHandler, meta: AdapterMeta) {
  return async function main(args: unknown): Promise<unknown> {
    const ran = await dispatch(user, args, args, meta);
    if (ran.event.type === "http") {
      return {
        statusCode: ran.result.statusCode ?? 200,
        headers: resultHeaders(ran.result),
        body: bodyText(ran.result),
      };
    }
    return ran.result.body ?? { ok: true };
  };
}

interface NodeRequest {
  method?: string;
  url?: string;
  headers?: unknown;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>;
}

interface NodeResponse {
  writeHead(status: number, headers: Record<string, string>): void;
  end(body: string): void;
}

export function createOracleHandler(user: UserHandler, meta: AdapterMeta) {
  return async function handle(req: NodeRequest, res: NodeResponse): Promise<void> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
    }
    const body = new TextDecoder().decode(concatBytes(chunks));
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const raw = {
      __skShape: "http",
      method: req.method ?? "GET",
      path: url.pathname,
      headers: req.headers,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
    };
    const ran = await dispatch(user, raw, req, meta);
    res.writeHead(ran.result.statusCode ?? 200, resultHeaders(ran.result));
    res.end(bodyText(ran.result));
  };
}

interface GcpRequest {
  method?: string;
  path?: string;
  url?: string;
  headers?: unknown;
  query?: unknown;
  body?: unknown;
}

interface GcpResponse {
  status(code: number): { set(headers: Record<string, string>): { send(body: string): void } };
}

export function createGcpHttpHandler(user: UserHandler, meta: AdapterMeta) {
  return async function handler(req: GcpRequest, res: GcpResponse): Promise<void> {
    const raw = {
      __skShape: "http",
      method: req.method,
      path: (req.path || req.url || "/").split("?")[0],
      headers: req.headers,
      query: req.query,
      body: req.body,
    };
    const ran = await dispatch(user, raw, req, meta);
    res.status(ran.result.statusCode ?? 200).set(resultHeaders(ran.result)).send(bodyText(ran.result));
  };
}

export function createGcpEventHandler(user: UserHandler, meta: AdapterMeta) {
  return async function handler(cloudEvent: unknown): Promise<unknown> {
    const ran = await dispatch(user, cloudEvent, cloudEvent, meta);
    return ran.result.body ?? { statusCode: ran.result.statusCode ?? 200 };
  };
}

export function createAzureHandler(user: UserHandler, meta: AdapterMeta) {
  return async function azureHandler(context: unknown, input: unknown): Promise<unknown> {
    const binding = meta.azureBinding ?? "http";
    const req = asRecord(input) ?? {};
    const raw =
      binding === "http"
        ? {
            __skShape: "http",
            method: req.method,
            path: azurePath(req),
            headers: req.headers,
            query: req.query,
            params: req.params,
            body: req.body,
          }
        : {
            __skShape: binding,
            input,
            container: stringField(asRecord(asRecord(context)?.bindingData), "container"),
            name: stringField(asRecord(asRecord(context)?.bindingData), "name"),
          };
    const ran = await dispatch(user, raw, context, meta);
    if (binding !== "http") return ran.result.body ?? { ok: true };
    return {
      status: ran.result.statusCode ?? 200,
      headers: resultHeaders(ran.result),
      body: ran.result.body == null || typeof ran.result.body === "string" ? ran.result.body ?? "" : ran.result.body,
    };
  };
}

interface CfEnv {
  SK_INVOKE_TOKEN?: string;
}

export function createCloudflareHandlers(user: UserHandler, meta: AdapterMeta) {
  return {
    async fetch(request: Request, env: CfEnv): Promise<Response> {
      copyWorkerEnv(env);
      const url = new URL(request.url);
      const raw = {
        __skShape: "http",
        method: request.method,
        path: url.pathname,
        headers: Object.fromEntries(request.headers.entries()),
        query: Object.fromEntries(url.searchParams.entries()),
        body: await request.text(),
      };
      const ran = await dispatch(user, raw, request, meta, env?.SK_INVOKE_TOKEN);
      return new Response(bodyText(ran.result), {
        status: ran.result.statusCode ?? 200,
        headers: resultHeaders(ran.result),
      });
    },
    async scheduled(controller: { cron?: string; scheduledTime?: number }, env: CfEnv, _ctx: unknown): Promise<void> {
      copyWorkerEnv(env);
      const raw = {
        __skShape: "schedule",
        cron: controller?.cron,
        time: controller?.scheduledTime ? new Date(controller.scheduledTime).toISOString() : undefined,
      };
      await dispatch(user, raw, controller, meta, env?.SK_INVOKE_TOKEN);
    },
    async queue(batch: { messages?: Array<{ id?: string; body?: unknown }> }, env: CfEnv): Promise<void> {
      copyWorkerEnv(env);
      const raw = { __skShape: "queue", records: batch?.messages ?? [] };
      await dispatch(user, raw, batch, meta, env?.SK_INVOKE_TOKEN);
    },
  };
}

export function createWorkflowHandler(definitions: Record<string, WorkflowConfig>): UserHandler {
  return async function handler(event: KitEvent): Promise<KitResult> {
    const body = asRecord(event.body) ?? {};
    const name = workflowName(event, body);
    const input = body.input !== undefined ? body.input : event.body;
    if (!name || !definitions[name]) {
      return { statusCode: 400, body: { error: `Unknown workflow "${name ?? ""}".` } };
    }
    const urls = readUrlMap();
    const output = await runWorkflow(name, definitions[name], input, async (functionName, payload, step) => {
      const url = urls[functionName];
      if (!url) {
        throw new Error(`Workflow runner has no URL for function "${functionName}". Deploy the function with an HTTP route.`);
      }
      const response = await fetch(joinUrl(url, `/__sk/invoke/${functionName}`), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sk-token": readEnv("SK_INVOKE_TOKEN") ?? "",
          "x-sk-internal": "1",
        },
        body: JSON.stringify({
          __sk: { type: "workflow", workflow: name, step },
          input: payload,
        }),
      });
      const text = await response.text();
      const parsed: unknown = text ? JSON.parse(text) : null;
      if (!response.ok) {
        throw new Error(`Function "${functionName}" returned HTTP ${response.status}: ${text.slice(0, 500)}`);
      }
      return parsed;
    });
    return { statusCode: 200, body: output };
  };
}

function workflowName(event: KitEvent, body: Record<string, unknown>): string | undefined {
  const fromParam = event.http?.pathParameters?.name;
  if (fromParam) return fromParam;
  const match = event.http?.path.match(/\/workflows\/([^/]+)/);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return stringField(body, "workflow");
}

function copyWorkerEnv(env: object | undefined): void {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  if (!env || !proc?.env) return;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && proc.env[key] === undefined) proc.env[key] = value;
  }
}

function buildContext(meta: AdapterMeta, raw: unknown): KitContext {
  const record = asRecord(raw);
  const remaining = record?.getRemainingTimeInMillis;
  return {
    functionName: meta.functionName,
    logicalName: meta.logicalName,
    provider: meta.provider,
    requestId:
      stringField(record, "awsRequestId") ||
      stringField(record, "requestId") ||
      stringField(asRecord(record?.requestContext), "requestId") ||
      `sk_${Date.now().toString(36)}`,
    memoryMb: meta.memory,
    timeoutMs: meta.timeout ? meta.timeout * 1000 : undefined,
    remainingTimeMs: typeof remaining === "function" ? () => Number(remaining.call(raw)) : undefined,
    raw,
  };
}

function isInternalCall(event: KitEvent): boolean {
  if (event.headers?.["x-sk-internal"] === "1") return true;
  const path = event.http?.path ?? "";
  return path.includes("/__sk/invoke") || path.includes("/sk/invoke/");
}

function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

function readUrlMap(): Record<string, string> {
  const raw = readEnv("SK_FUNCTION_URL_MAP");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    const record = asRecord(parsed);
    if (!record) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function joinUrl(base: string, suffix: string): string {
  if (base.includes("/__sk/invoke")) return base;
  return `${base.replace(/\/$/, "")}${suffix}`;
}

function azurePath(req: Record<string, unknown>): string {
  const explicit = stringField(req, "path");
  if (explicit) return explicit.split("?")[0];
  const url = stringField(req, "url") ?? "/";
  try {
    if (url.startsWith("http")) return new URL(url).pathname;
  } catch {
    /* use the raw path */
  }
  return url.split("?")[0] || "/";
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
