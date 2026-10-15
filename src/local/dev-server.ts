import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { KitError } from "../errors.js";
import type { KitConfig } from "../types.js";
import { planDeployment } from "../plan/physical.js";
import { bundleService } from "../package/bundle.js";
import { matchRoute } from "./invoke.js";

const require = createRequire(import.meta.url);

export async function startDevServer(dir: string, config: KitConfig, port: number): Promise<{ url: string; close: () => Promise<void> }> {
  const plan = planDeployment(config);
  const buildDir = path.join(dir, ".serverless-kit", "build");
  const previous = process.env.SK_ORACLE_LISTEN;
  process.env.SK_ORACLE_LISTEN = "0";
  const bundled = await bundleService(dir, config, plan, buildDir);
  if (previous === undefined) delete process.env.SK_ORACLE_LISTEN;
  else process.env.SK_ORACLE_LISTEN = previous;

  const loaded = new Map<string, Record<string, unknown>>();
  for (const fn of plan.functions) {
    const artifact = bundled.functions.find((item) => item.physicalName === fn.physicalName);
    if (!artifact) continue;
    loaded.set(fn.physicalName, require(path.resolve(artifact.file)) as Record<string, unknown>);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString("utf8");
      let body: unknown = text;
      if ((req.headers["content-type"] ?? "").includes("json") && text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      if (url.pathname.startsWith("/__sk/call/")) {
        const name = decodeURIComponent(url.pathname.slice("/__sk/call/".length));
        const fn = plan.functions.find((item) => item.logicalName === name || item.physicalName === name);
        if (!fn) {
          send(res, 404, { error: `Unknown function ${name}` });
          return;
        }
        const mod = loaded.get(fn.physicalName);
        const handler = mod?.handler || mod?.main;
        if (typeof handler !== "function") {
          send(res, 500, { error: "Function has no handler export." });
          return;
        }
        const result = await handler(body ?? {}, { awsRequestId: "dev", functionName: fn.physicalName, getRemainingTimeInMillis: () => fn.timeout * 1000 });
        send(res, 200, result);
        return;
      }
      for (const fn of plan.functions) {
        for (const event of fn.events) {
          if (event.type !== "http" || event.http.internal) continue;
          const params = matchRoute(event.http.path, event.http.method, req.method ?? "GET", url.pathname);
          if (!params) continue;
          const mod = loaded.get(fn.physicalName);
          const raw = {
            version: "2.0",
            rawPath: url.pathname,
            headers: req.headers,
            body: text,
            pathParameters: params,
            queryStringParameters: Object.fromEntries(url.searchParams.entries()),
            requestContext: { http: { method: req.method ?? "GET", path: url.pathname, sourceIp: "127.0.0.1" } },
            __skShape: "http",
            method: req.method,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams.entries()),
          };
          if (fn.entry === "cloudflare" && mod?.default && typeof (mod.default as { fetch?: unknown }).fetch === "function") {
            const request = new Request(`http://127.0.0.1${req.url}`, {
              method: req.method,
              headers: req.headers as Record<string, string>,
              body: req.method === "GET" || req.method === "HEAD" ? undefined : text,
            });
            const response = await (mod.default as { fetch: (request: Request, env: NodeJS.ProcessEnv) => Promise<Response> }).fetch(request, process.env);
            res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
            res.end(Buffer.from(await response.arrayBuffer()));
            return;
          }
          const handler = mod?.handler || mod?.main;
          if (typeof handler !== "function") continue;
          const result = await handler(raw, { awsRequestId: "dev", functionName: fn.physicalName, getRemainingTimeInMillis: () => fn.timeout * 1000 });
          writeLambdaResult(res, result);
          return;
        }
      }
      send(res, 404, { error: "No HTTP route matched.", path: url.pathname, method: req.method });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(res, 500, { error: message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const chosen = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${chosen}`,
        close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });
}

function writeLambdaResult(res: http.ServerResponse, result: unknown): void {
  if (!result || typeof result !== "object") {
    send(res, 200, result);
    return;
  }
  const record = result as { statusCode?: number; headers?: Record<string, string>; body?: unknown };
  if (typeof record.statusCode === "number") {
    const headers = record.headers ?? { "content-type": "application/json; charset=utf-8" };
    const body = typeof record.body === "string" ? record.body : JSON.stringify(record.body ?? null);
    res.writeHead(record.statusCode, headers);
    res.end(body);
    return;
  }
  send(res, 200, result);
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function assertDevConfig(config: KitConfig): void {
  if (Object.keys(config.functions).length === 0) throw new KitError("No functions to serve.");
}
