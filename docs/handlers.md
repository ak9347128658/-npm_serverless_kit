# Handlers

A handler is a function. JavaScript and TypeScript both bundle. The export name is the part after the last dot in `handler`.

## JavaScript

`src/handler.js` with `handler: src/handler.handler`:

```js
exports.handler = async function handler(event, context) {
  if (event.type === "http") {
    return { statusCode: 200, body: { path: event.http.path, provider: event.provider } };
  }
  return { statusCode: 200, body: { type: event.type } };
};
```

`module.exports = { handler }` and `exports.handler = ...` both work. The bundle is CommonJS except on Cloudflare.

## TypeScript

`src/handler.ts`:

```ts
import type { KitEvent, KitResult, KitContext } from "serverless-kit";

export async function handler(event: KitEvent, context: KitContext): Promise<KitResult> {
  return {
    statusCode: 200,
    body: { provider: event.provider, function: context.logicalName },
  };
}
```

Install `serverless-kit` in the service (or depend on a workspace build) so TypeScript can see those types. esbuild strips the types at package time. You do not ship `typescript` to the cloud.

A default export works when the YAML name matches it or when the named export is missing and `default` is a function:

```ts
export default async function (event: KitEvent): Promise<KitResult> {
  return { statusCode: 200, body: event.body };
}
```

## Event

| Field | When it is set |
| --- | --- |
| `type` | `http`, `schedule`, `queue`, `topic`, `storage`, `event`, `stream`, `workflow`, `invoke` |
| `provider` | the cloud from YAML |
| `body` | parsed JSON when the body is JSON, otherwise a string or the cloud object |
| `raw` | the original payload |
| `headers` | lower-cased HTTP headers |
| `http` | method, path, query, path parameters, source IP |
| `records` | queue, topic, and stream batches. `id`, `body`, `raw`, `attributes` |
| `storage` | bucket, key, event name, size |
| `schedule` | time, expression when the cloud sent one |
| `topic` | name, subject, message id |
| `event` | source, detail type, id |
| `workflow` | workflow name, step, execution id for a workflow call |

Branch on `event.type`. Do not branch on `event.provider` unless you truly need a cloud-specific field from `event.raw`.

## Result

```ts
interface KitResult {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: unknown;
  batchItemFailures?: Array<{ itemIdentifier: string }>;
}
```

HTTP responses become the platform's proxy shape. Objects in `body` are JSON. Returning a plain object without `statusCode` is treated as the body with status 200 by the adapter where a response is required.

For AWS SQS, `batchItemFailures` maps to the partial-batch-failure response.

## Context

```ts
interface KitContext {
  functionName: string;   // physical name
  logicalName: string;    // YAML name
  provider: string;
  requestId: string;
  memoryMb?: number;
  timeoutMs?: number;
  remainingTimeMs?: () => number;
  raw: unknown;
}
```

## What not to import

The runtime modules that ship inside the bundle avoid Node built-ins at the top level so Cloudflare can tree-shake them. Your handler can use Node built-ins on Lambda, Azure, and the other Node runtimes. On Cloudflare, avoid `fs`, `net`, `child_process`, and other server-only modules. `sk validate` does not detect that. The Cloudflare runtime mapping prints a warning when you package.

## Local calls

```bash
sk invoke hello
sk invoke hello --type http --path /hello --method POST --data '{"name":"ada"}'
sk invoke worker --type queue --data '{"ok":true}'
sk dev
```

`sk dev` listens on `127.0.0.1:3000` and matches HTTP routes from the YAML. `POST /__sk/call/<function>` invokes a function with the JSON body as the raw event.

See [local-development.md](local-development.md) and [examples/http-javascript](../examples/http-javascript), [examples/http-typescript](../examples/http-typescript).
