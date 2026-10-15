# Configuration

The CLI looks for `serverless-kit.yml`, `serverless-kit.yaml`, `sk.yml`, then `sk.yaml` in the working directory.

```yaml
service: shop          # letter, then letters, numbers, hyphens. Max 40 characters.
framework: serverless-kit

provider:
  name: aws            # aws | gcp | azure | cloudflare | alibaba | ibm | oracle | tencent | huawei | digitalocean
  runtime: nodejs20    # nodejs18 | nodejs20 | nodejs22. Default nodejs20.
  region: us-east-1    # default comes from the provider catalog
  stage: dev           # default dev
  memory: 256          # MB. Minimum 128.
  timeout: 30          # seconds. 1 to 900.
  architecture: x86_64 # or arm64, where the platform has a choice
  environment:
    LOG_LEVEL: info

functions:
  charge:
    handler: src/charge.handler   # path.export. Also src/charge/index.handler.
    description: Take a payment
    memory: 512                    # optional override
    timeout: 15
    runtime: nodejs20
    environment:
      CURRENCY: USD
    events:
      - http:
          path: /charge
          method: post

workflows: {}          # see docs/workflows.md
package:
  external: []         # esbuild external modules
  minify: false
  sourcemap: false
hooks: {}
ui:
  title: Shop dev
  out: .serverless-kit/ui/index.html
```

## Defaults

If you omit them, the kit fills:

| Field | Default |
| --- | --- |
| `runtime` | `nodejs20` |
| `stage` | `dev` |
| `region` | the provider default (`us-east-1`, `us-central1`, `eastus`, `nyc1`, ...) |
| `memory` | 256 |
| `timeout` | 30 |
| `architecture` | `x86_64` |
| HTTP `method` | `GET` |
| HTTP `auth` | `public` |
| HTTP `cors` | `false` |
| queue `batchSize` | 10 |
| queue `create` | `true` when `arn` is omitted |
| topic `create` | `true` when `arn` is omitted |
| storage `create` | `false` |
| storage `events` | `[created]` |
| workflow `engine` | `native` on AWS and Google Cloud, `portable` elsewhere |
| workflow `type` | `STANDARD` |

`--stage` and `--region` on `validate`, `package`, `plan`, and `deploy` override the file for that command.

## Handlers

`handler` is `path.exportName`. The path is relative to the project root. Extensions tried, in order: `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.mts`, `.cts`, then `path/index.<ext>`.

Function names start with a letter or underscore and then use letters, numbers, underscores, or hyphens.

## Environment

Function environment is `provider.environment` merged with `functions.<name>.environment`. The function wins on a duplicate key.

These names are reserved and ignored if you set them. The kit sets them:

- `SK_PROVIDER`
- `SK_SERVICE`
- `SK_STAGE`
- `SK_REGION`
- `SK_FUNCTION_NAME`
- `SK_LOGICAL_NAME`
- `SK_INVOKE_TOKEN` when a workflow needs internal HTTP
- `SK_FUNCTION_URL_MAP` on the workflow runner

Azure Functions share one app-settings map. If two functions set the same key to different values, generation fails. `SK_FUNCTION_NAME` and `SK_LOGICAL_NAME` are baked into each Azure bundle instead of the shared map.

Values are written into Terraform as strings so the cloud runtime can read them. Do not put secrets you would not put in a Terraform variable in `environment`. Prefer a secret manager and a reference your provider accepts. The dashboard lists key names only.

## Provider blocks

Required when you select that provider:

| Provider | Required keys |
| --- | --- |
| Google Cloud | `provider.gcp.project` |
| Cloudflare | `provider.cloudflare.accountId`. Portable workflows also need `workersDevSubdomain` |
| IBM | `provider.ibm.namespace` |
| Oracle | `provider.oracle.compartmentId` and `subnetIds`. `image` is required only for `sk deploy` |
| Huawei | `provider.huawei.agency` |
| Alibaba | `provider.alibaba.roleArn` when a function uses a queue, topic, or storage trigger |
| Tencent | `provider.tencent.appId` when `storage.create` is true |

Optional blocks:

```yaml
provider:
  name: aws
  aws:
    logRetentionDays: 14
    tracing: false
  backend:
    type: s3
    bucket: my-tf-state
    key: shop/dev/terraform.tfstate
    region: us-east-1
    dynamodbTable: tf-locks   # optional
```

`backend.type` may be `local` (default), `s3`, `gcs`, or `azurerm`. A non-local backend writes `backend.tf`. Changing it later is a Terraform state migration, which this CLI does not perform for you.

## Events

Each item under `events` has exactly one key: `http`, `schedule`, `queue`, `topic`, `storage`, `event`, or `stream`. Two keys in one item is a config error. The shapes are in [events.md](events.md).

An empty `events` list is a direct invoke. On AWS that is a Lambda with no trigger. On Azure the kit adds a function-auth HTTP route at `/invoke/<name>`. On other clouds it is a function you call with the platform invoke API.

## Schedules

`expression` accepts:

- `rate(5 minutes)`, `rate(1 hour)`, `rate(1 day)`. `rate(1 minutes)` is accepted and normalized to `rate(1 minute)`.
- a 5-field cron: `15 1 * * *`
- an AWS cron: `cron(0 12 * * ? *)`
- a 6-field cron whose seconds field is `0`

Rates that do not divide 60 (minutes) or 24 (hours) are rejected. Use a cron expression for those.

The kit converts the expression per cloud: EventBridge `rate` or `cron` (with `?` on one of day-of-month or day-of-week), Azure NCRONTAB, a 6-field cron for Alibaba, Tencent, and Huawei, and a 5-field cron everywhere else. Tencent timers get a seventh year field of `*`.

## Package

```yaml
package:
  minify: true
  sourcemap: true
  external:
    - sharp
```

Bundles are CommonJS (`index.handler`) except Cloudflare, which is an ES module (`export default { fetch, scheduled, queue }`), and OCI, which also listens on port 8080 unless `SK_ORACLE_LISTEN=0`.

DigitalOcean always bundles to the `nodejs:18` target and writes `project.yml`. A code-only change updates `.sk-code-stamp`, which the `null_resource` hashes so `doctl serverless deploy` runs again.
