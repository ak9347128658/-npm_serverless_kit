# serverless-kit

One Node.js or TypeScript handler. A YAML file that says which cloud and which events call it. Terraform underneath.

Move from AWS Lambda and Step Functions to another cloud by editing the YAML. The handler stays the same. `sk deploy` bundles the code, writes Terraform, applies it, and writes a dashboard of every deployed function.

```bash
npm install -g node_serverless_kit
sk init my-service
cd my-service
sk deploy
sk ui
```

You need Node.js 18 or newer and Terraform 1.5 or newer. Cloud credentials stay in your environment. The kit does not write them into generated files.

## What you write

`serverless-kit.yml` (also accepted: `serverless-kit.yaml`, `sk.yml`, `sk.yaml`):

```yaml
service: hello
framework: serverless-kit

provider:
  name: aws
  runtime: nodejs20
  region: us-east-1
  stage: dev

functions:
  hello:
    handler: src/handler.handler
    events:
      - http:
          path: /hello
          method: get
```

```js
exports.handler = async function handler(event, context) {
  return {
    statusCode: 200,
    body: { message: "hello", provider: event.provider, path: event.http && event.http.path },
  };
};
```

The same function works in TypeScript. Export `handler` from `src/handler.ts`. See [examples/http-typescript](examples/http-typescript).

## Clouds

| YAML name | Product |
| --- | --- |
| `aws` | Lambda, API Gateway, EventBridge, SQS, SNS, S3, Step Functions |
| `gcp` | Cloud Functions (2nd gen), Scheduler, Pub/Sub, Workflows |
| `azure` | Linux Consumption Functions, Storage queues, Service Bus, blobs |
| `cloudflare` | Workers, cron triggers, Queues |
| `alibaba` | Function Compute 3, MNS, OSS |
| `ibm` | Cloud Functions (HTTP and alarm triggers) |
| `oracle` | OCI Functions (container image) |
| `tencent` | SCF, TCMQ, COS |
| `huawei` | FunctionGraph, SMN, OBS |
| `digitalocean` | Functions via `doctl` |

The full event matrix is in [docs/provider-matrix.md](docs/provider-matrix.md). A trigger the provider cannot represent fails `sk validate` with a specific hint. The kit does not emit Terraform that pretends the trigger exists.

## Commands

| Command | What it does |
| --- | --- |
| `sk init [dir]` | Write `serverless-kit.yml` and `src/handler.js` |
| `sk validate` | Parse YAML, check handlers, check the support matrix |
| `sk package` | Bundle JS and TS, write Terraform, write a preview dashboard |
| `sk plan` | Package, then `terraform plan` |
| `sk deploy` | Package, `terraform apply`, write `deployment.json` and the dashboard |
| `sk destroy --yes` | `terraform destroy` for the last generated stack |
| `sk info` | Print functions, triggers, ARNs, and URLs |
| `sk ui` | Serve the dashboard on `127.0.0.1:7070` |
| `sk dev` | Local HTTP server for routes in the YAML |
| `sk invoke <function>` | Call one function locally |
| `sk workflow <name>` | Run a workflow locally with the portable engine |
| `sk doctor` | Check Node and optional cloud CLIs |

`sk deploy` applies because you named the command. `sk destroy` does nothing until you pass `--yes`.

`validate`, `package`, `plan`, and `deploy` accept `--stage`, `--region`, and `--config`. To change clouds, edit `provider.name` in the YAML.

## After deploy

`sk deploy` writes:

- `.serverless-kit/terraform/` generated Terraform. State files in that directory are kept.
- `.serverless-kit/deployment.json` functions, triggers, ARNs, URLs, workflow engines.
- `.serverless-kit/ui/index.html` a self-contained dashboard.

Open the file, or run `sk ui`. The page lists each function, its runtime, memory, timeout, trigger types, paths, schedules, and identifiers. Environment **values** and the invoke token are not embedded. Only environment key names are shown.

`.serverless-kit/` is gitignored. Do not commit state.

## Workflows

AWS Step Functions and Google Cloud Workflows are native. Every other provider uses a portable runner: a function the kit adds that calls your functions over HTTP with a shared invoke token. Waits in a portable workflow must be 10 seconds or less. Longer waits stay on native AWS or Google Cloud. DigitalOcean workflows are rejected because function URLs are not known at plan time.

```bash
sk workflow checkout --data '{"sku":"sku-1"}'
```

## Handler contract

```ts
import type { KitEvent, KitResult, KitContext } from "node_serverless_kit";

export async function handler(event: KitEvent, context: KitContext): Promise<KitResult> {
  return { statusCode: 200, body: { ok: true, type: event.type } };
}
```

`event.type` is `http`, `schedule`, `queue`, `topic`, `storage`, `event`, `stream`, `workflow`, or `invoke`. The cloud payload is on `event.raw`. Parsed JSON is on `event.body`. Queue and topic batches are on `event.records`.

Return `{ statusCode, headers, body }`. `body` may be an object. The adapter stringifies it for HTTP. Partial queue failures use `batchItemFailures`.

## Docs

- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [Events](docs/events.md)
- [Handlers, JavaScript and TypeScript](docs/handlers.md)
- [Providers](docs/providers.md)
- [Provider matrix](docs/provider-matrix.md)
- [Workflows](docs/workflows.md)
- [Local dev and invoke](docs/local-development.md)
- [Dashboard](docs/ui.md)
- [Switching providers](docs/switching-providers.md)
- [FAQ](docs/faq.md)
- [Examples](examples/README.md)

## Publish and contribute

- [Publish this library to npm](deploy_docs/npm-publish.md)
- [Contribute](deploy_docs/contributing.md)

Author: Asif Khan @ Kavion.ai. License: Apache-2.0.
