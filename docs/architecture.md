# Architecture

serverless-kit is a compiler from a service YAML file to a cloud-specific Terraform stack, plus a small runtime that makes every cloud call your function with the same event shape.

```
serverless-kit.yml
        │
        ▼
  parse and defaults
        │
        ▼
  validate (support matrix, schedules, workflows, provider fields)
        │
        ▼
  plan physical functions
        │
        ▼
  esbuild bundle (one entry per physical function)
        │
        ▼
  Terraform files in .serverless-kit/terraform
        │
        ▼
  terraform init / plan / apply
        │
        ▼
  deployment.json and ui/index.html
```

## The handler does not change

Each cloud delivers a different payload. API Gateway v2, an Azure Functions HTTP request, a Cloudflare Worker `Request`, an OpenWhisk action argument, and an OCI HTTP body are not the same object.

The kit writes an entry file that imports your handler and wraps it with an adapter from `src/runtime`. The adapter classifies the payload and calls:

```ts
handler(event: KitEvent, context: KitContext): Promise<KitResult>
```

Your source file is copied into the bundle by esbuild. Switching `provider.name` regenerates the entry and the Terraform. It does not ask you to edit the handler.

## Physical functions

Some platforms can attach many triggers to one function. Some cannot.

| Provider | Shape |
| --- | --- |
| AWS, Alibaba, Tencent, Huawei | One function, many triggers |
| Cloudflare | One Worker. HTTP is `fetch`, schedules are `scheduled`, queues are `queue` |
| IBM, DigitalOcean | One action. HTTP is a web action. Schedules are alarm or `project.yml` triggers |
| Oracle | One container. HTTP is a server on port 8080 |
| Google Cloud | HTTP and schedules stay together. One background trigger (queue, topic, storage, or event bus) becomes a second function |
| Azure | One function per trigger, because `function.json` has one trigger binding |

A logical name such as `worker` can therefore become `worker`, `worker-queue-2`, or `worker-queue` on disk. The dashboard shows both names. Inside the handler, `context.logicalName` is the name you wrote.

## Workflows

Two engines:

- **native** on AWS (`aws_sfn_state_machine`) and Google Cloud (`google_workflows_workflow`).
- **portable** everywhere else that can expose an HTTP URL at plan time. The planner adds an internal route on each target function and a function named `__sk_workflow_runner`. The runner posts `{ __sk: { type: "workflow", workflow, step }, input }` with header `x-sk-token`.

DigitalOcean is the exception. `doctl` assigns URLs during deploy, so a workflow cannot be planned. `sk validate` rejects it.

The portable runner refuses `wait` states longer than 10 seconds. Native AWS and Google Cloud workflows can wait longer.

## What is generated

`sk package` and `sk deploy` write `.serverless-kit/`:

| Path | Contents |
| --- | --- |
| `build/` | Bundles, zips, the Azure site zip, OCI Dockerfiles, the DigitalOcean project |
| `terraform/*.tf` | Providers, functions, triggers, outputs |
| `deployment.json` | The model the CLI and the dashboard read |
| `ui/index.html` | The dashboard |

`writeTerraform` deletes `*.tf` in that directory and leaves `terraform.tfstate`, `terraform.tfstate.backup`, `.terraform`, and `.terraform.lock.hcl` in place.

Outputs the CLI reads:

- `sk_functions` map keyed by physical name, with `logical_name`, `arn`, `id`, and `url`.
- `sk_workflows` map keyed by workflow name, with `arn`, `id`, and `engine`.

## Credentials

Generated files contain resource names, regions, and references such as `random_password.sk_invoke_token.result`. They do not contain cloud access keys, the invoke token value, or your environment values. Set credentials the way that cloud's Terraform provider expects (`AWS_PROFILE`, `GOOGLE_APPLICATION_CREDENTIALS`, `ARM_*`, `CLOUDFLARE_API_TOKEN`, and so on). `sk doctor` only checks that a few CLIs are on `PATH`.

## Hooks

Optional files named in YAML:

```yaml
hooks:
  beforePackage: scripts/before-package.js
  afterPackage: scripts/after-package.js
  beforeDeploy: scripts/before-deploy.js
  afterDeploy: scripts/after-deploy.js
```

Each file exports a function (named export matching the hook, or `default`). The kit loads it with a dynamic `import()`.
