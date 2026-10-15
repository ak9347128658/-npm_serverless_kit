# Events

Every event becomes one object in `functions.<name>.events`. The handler then sees a `KitEvent` whose `type` matches the trigger. Examples live under [examples/](../examples/README.md).

## http

```yaml
- http:
    path: /orders/{id}
    method: post          # GET POST PUT PATCH DELETE HEAD OPTIONS ANY
    auth: public          # public | iam | provider
    cors: true
```

`path` gains a leading `/` if you omit it.

| auth | Meaning |
| --- | --- |
| `public` | Anonymous where the platform allows it (API Gateway `NONE`, Azure `anonymous`, Alibaba `anonymous`) |
| `iam` | AWS IAM on API Gateway. Other clouds keep the platform default |
| `provider` | Platform default: function keys, OIDC, or the shared invoke token for internal routes |

`cors: true` on AWS adds an API Gateway CORS block that allows any origin, method, and header. Other providers leave CORS to the platform or to headers you return.

Internal workflow routes are added by the planner. They are marked `internal` and omitted from the public URL when the output can tell them apart. Do not copy those paths into your YAML.

## schedule

```yaml
- schedule:
    expression: rate(5 minutes)
    timezone: UTC
    description: poll partner API
```

Also valid: `"15 1 * * *"`, `cron(0 12 * * ? *)`, and `"0 15 1 * * *"` (seconds must be 0).

Oracle has no timer in this kit. Call the HTTP route from an external scheduler.

## queue

```yaml
- queue:
    name: jobs
    batchSize: 10
    create: true
```

`create: true` (the default when `arn` is omitted) creates the queue:

| Provider | Resource |
| --- | --- |
| AWS | `aws_sqs_queue` and an event source mapping |
| Azure | `azurerm_storage_queue`. The name is lowercased to meet Storage rules |
| Cloudflare | `cloudflare_queue` and a consumer |
| Google Cloud | a Pub/Sub topic the function subscribes to |
| Alibaba | `alicloud_message_service_queue` and an EventBridge Function Compute trigger. `queue.name` is required |
| Tencent | `tencentcloud_tcmq_queue` and a CMQ trigger. `queue.name` is required |
| Huawei | not generated. Use a topic (SMN) or HTTP |

Set `create: false` and `name` or `arn` to bind a queue that already exists. AWS can bind by `arn` alone.

The handler reads `event.records`. Each record has `id`, `body` (JSON parsed when possible), and `raw`. Return `batchItemFailures` to retry individual AWS SQS records.

## topic

```yaml
- topic:
    name: orders
    create: true
    filter: important     # optional. Honored where the provider has a filter field
```

| Provider | Resource |
| --- | --- |
| AWS | `aws_sns_topic` and a subscription |
| Azure | Service Bus Standard topic and a subscription named `kit`. The app setting `SK_SERVICEBUS` is the namespace connection string |
| Google Cloud | Pub/Sub topic |
| Alibaba | `alicloud_message_service_topic` and an `mns_topic` trigger. `topic.name` is required |
| Tencent | `tencentcloud_tcmq_topic` |
| Huawei | `huaweicloud_smn_topic` and an SMN trigger. An existing topic needs `topic.arn` (the SMN URN) |

Cloudflare, IBM, Oracle, and DigitalOcean have no topic resource here.

## storage

```yaml
- storage:
    bucket: uploads
    events: [created]     # created, deleted, or both
    prefix: inbound/
    suffix: .json
    create: false         # default. true creates the bucket or container
```

| Provider | Behavior |
| --- | --- |
| AWS | S3 bucket notification. `create: true` creates the bucket |
| Google Cloud | a storage event trigger. `create: true` creates the bucket |
| Azure | blob trigger path `<container>/{name}`. `create: true` creates the container. The name `packages` is reserved for the function zip |
| Alibaba | OSS trigger. Needs `provider.alibaba.roleArn` |
| Tencent | one COS trigger. `events` must be a single value, `created` or `deleted`. `create: true` needs `provider.tencent.appId` because the bucket id is `name-appid` |
| Huawei | OBS trigger. Suffix filters are generated. A prefix is rejected so it is not silently dropped |

## event

```yaml
- event:
    bus: default
    source: shop.orders
    detailType: OrderPlaced
    pattern:
      source: [shop.orders]
```

AWS becomes an EventBridge rule. Google Cloud becomes a Pub/Sub topic named from `bus`, then `source`, then the function name. Other providers fail validation. Publish to a queue or topic there instead.

## stream

```yaml
- stream:
    arn: arn:aws:kinesis:us-east-1:123456789012:stream/orders
    batchSize: 100
    startingPosition: LATEST    # or TRIM_HORIZON
```

AWS only. The kit does not create streams. Point the ARN at Kinesis or DynamoDB Streams. On other clouds, put the stream behind a queue and use a queue trigger.

## direct invoke

```yaml
functions:
  ping:
    handler: src/ping.handler
    events: []
```

Nothing on the public internet calls this unless you add an HTTP event. Invoke it with the cloud API, or locally:

```bash
sk invoke ping --data '{"hello":"world"}'
```

`event.type` is `invoke`.

## One function, many triggers

AWS, Alibaba, Tencent, and Huawei accept several events on one function. See [examples/multi-trigger](../examples/multi-trigger).

Google Cloud allows HTTP plus schedules on one function, and one background trigger. A second background trigger is a validation error. Split it into another function. The handler code can be the same file. Point both functions at it.

Azure creates one deployed function per event. Your YAML still lists them under one logical name. The handler is bundled once per physical function.
