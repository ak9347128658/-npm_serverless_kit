# Examples

Each folder is a service you can validate from that directory. The handler is the same shape in every scenario: `(event, context) => { statusCode, body }`.

```bash
cd examples/http-javascript
npx serverless-kit validate
```

From a checkout, build first (`npm run build`) or run the CLI with `npx tsx src/cli.ts validate`.

Switching clouds without editing the handler is [switch-provider](switch-provider). The other folders are the event and workflow scenarios. The provider matrix says which clouds accept each one: [docs/provider-matrix.md](../docs/provider-matrix.md).

## http-javascript

`GET /hello` on AWS, CommonJS `exports.handler`. CORS is on, so the generated API Gateway gets a CORS block.

```bash
sk invoke hello --type http --path /hello
```

## http-typescript

The same route. `src/handler.ts` exports `handler`. esbuild strips the types. After you install the library, you can import `KitEvent` and `KitResult` from `serverless-kit` instead of declaring them inline. See [docs/handlers.md](../docs/handlers.md).

## schedule

`rate(5 minutes)`. The kit turns that into EventBridge `rate(5 minutes)`. The same expression on Azure becomes an NCRONTAB, and on Alibaba, Tencent, and Huawei a 6-field cron (Tencent adds a year field).

Oracle rejects this event.

## queue

Creates an SQS queue named from the service, stage, and `jobs`, then an event source mapping. The handler returns `batchItemFailures` for records whose body is `{ "ok": false }`.

The same YAML key works on Azure (Storage queue `jobs`), Cloudflare, Google Cloud (Pub/Sub), Alibaba (add `provider.alibaba.roleArn`), and Tencent (TCMQ). Huawei rejects it. Use a topic there.

```yaml
- queue:
    name: jobs
    batchSize: 10
    create: true
```

## topic

Creates an SNS topic `orders` and subscribes the function. The handler reads `event.records`.

Azure creates a Service Bus topic and a subscription named `kit`. Huawei creates an SMN topic. Alibaba and Tencent create their message-service topics. Set `create: false` and `arn` when the topic already exists. Huawei's existing-topic form needs the SMN topic URN in `topic.arn`.

## storage

Creates an S3 bucket and notifies the function when a key ending in `.json` is created.

```yaml
- storage:
    bucket: uploads
    events: [created]
    suffix: .json
    create: true
```

Google Cloud, Azure, Alibaba, Tencent, and Huawei have the same YAML. Tencent needs `provider.tencent.appId` when `create` is true, and only one of `created` or `deleted`. Huawei rejects `prefix`. Azure will not create a container named `packages`.

## event-bus

An EventBridge rule for `shop.orders` / `OrderPlaced`. Google Cloud maps `event` to a Pub/Sub topic. Other providers fail validation. Use a queue or topic there.

## stream

AWS only. The ARN is yours. The kit does not create Kinesis or DynamoDB streams.

```yaml
- stream:
    arn: arn:aws:kinesis:us-east-1:123456789012:stream/orders
    batchSize: 100
    startingPosition: LATEST
```

## direct-invoke

`events: []`. No public URL. On AWS this is a Lambda you call by ARN. On Azure the kit adds `POST /invoke/ping` with function auth. Locally:

```bash
sk invoke ping --data '{"hello":"world"}'
```

## multi-trigger

One AWS function with HTTP `POST /work`, a noon cron, and a queue. AWS, Alibaba, Tencent, and Huawei keep those on one function (Huawei cannot take the queue). Google Cloud would split the queue onto a second function. Azure would deploy three functions that share the handler.

## cors-auth

`GET /items` is public. `POST /items` uses IAM. Both set `cors: true`, so API Gateway allows browser calls. `auth: iam` is an API Gateway authorizer. On other clouds `iam` falls back to the platform default. Return CORS headers yourself if the platform does not.

## workflow-native

`checkout` reserves, then charges, then a choice on `$.paid`. `engine: native` on AWS is Step Functions. `serverless-kit.gcp.yml` is the same handlers on Google Cloud Workflows. Retries and the choice stay in YAML.

```bash
sk workflow checkout --data '{"sku":"sku-1"}'
```

That command runs the portable interpreter locally. It does not start a state machine in your account.

A task handler sees `event.type === "workflow"` and the previous state's body on `event.body`. Return `{ statusCode, body }`.

## workflow-portable

The Azure version. `engine: portable` adds internal HTTP routes and a runner. The wait is 2 seconds, under the 10 second portable limit. A 30 second wait fails validation. Use native AWS or Google Cloud for long waits.

DigitalOcean cannot host this workflow.

## switch-provider

Ten YAML files, one `src/handler.js`.

| File | Extra fields |
| --- | --- |
| `aws.yml` | region `us-east-1` |
| `gcp.yml` | `provider.gcp.project` |
| `azure.yml` | region `eastus` |
| `cloudflare.yml` | `accountId`, `workersDevSubdomain` |
| `alibaba.yml` | region `cn-hangzhou` |
| `ibm.yml` | `provider.ibm.namespace` |
| `oracle.yml` | compartment and subnet. Set `image` before deploy |
| `tencent.yml` | region `ap-guangzhou` |
| `huawei.yml` | `provider.huawei.agency` |
| `digitalocean.yml` | runtime `nodejs18` |

```bash
sk package --config aws.yml
sk package --config azure.yml
```

Do not apply two providers in the same directory unless you intend the second apply to replace the first stack. See [docs/switching-providers.md](../docs/switching-providers.md).
