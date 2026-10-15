# Switching providers

The handler stays. The YAML changes. Terraform is regenerated.

Start from [examples/switch-provider](../examples/switch-provider). `src/handler.js` is one file. `aws.yml`, `gcp.yml`, `azure.yml`, `cloudflare.yml`, `alibaba.yml`, `ibm.yml`, `oracle.yml`, `tencent.yml`, `huawei.yml`, and `digitalocean.yml` deploy that file.

```bash
cd examples/switch-provider
sk deploy --config aws.yml
sk deploy --config gcp.yml
```

Use a different `stage`, and a different Terraform directory, when both stacks must exist at once. By default every config in one directory shares `.serverless-kit/terraform`. Deploying a second provider in the same directory will want to destroy the first provider's resources. Copy the service to a second directory, or change the backend key, before you keep two clouds live.

## A practical move off Lambda

1. `sk validate` the AWS file until it is clean.
2. Copy `provider.name` to the new cloud and add the required block from [providers.md](providers.md).
3. Run `sk validate` again. Unsupported events fail here, with a hint, before apply.
4. Split Google Cloud functions that have more than one background trigger.
5. For a workflow, keep `engine: native` on Google Cloud. On Azure and the others, the kit selects `portable` unless you are on DigitalOcean, which rejects workflows.
6. Shorten portable waits to 10 seconds or move the long wait to a queue plus a schedule.
7. `sk package` and read the preview dashboard.
8. `sk deploy`, then `sk ui`.

## Event substitutions

| You had | On a cloud without that event |
| --- | --- |
| Step Functions | Native Google Cloud Workflows, or the portable runner |
| SQS | Azure Storage queue, Cloudflare Queue, Pub/Sub, MNS, TCMQ. Huawei: use a topic or HTTP |
| SNS | Service Bus, Pub/Sub, MNS topic, TCMQ topic, SMN |
| S3 | GCS, Azure blob, OSS, COS, OBS |
| EventBridge | Pub/Sub on Google Cloud. Elsewhere, a queue or topic |
| Kinesis | Keep it on AWS, or publish from a consumer into a queue the other cloud already supports |
| EventBridge Scheduler | `schedule` on every provider except Oracle |

## Same handler, different YAML

AWS:

```yaml
provider:
  name: aws
  region: us-east-1
functions:
  worker:
    handler: src/handler.handler
    events:
      - queue:
          name: jobs
```

Azure, same handler path:

```yaml
provider:
  name: azure
  region: eastus
functions:
  worker:
    handler: src/handler.handler
    events:
      - queue:
          name: jobs
```

Alibaba, same handler, plus the role:

```yaml
provider:
  name: alibaba
  region: cn-hangzhou
  alibaba:
    roleArn: acs:ram::123456:role/fc-role
functions:
  worker:
    handler: src/handler.handler
    events:
      - queue:
          name: jobs
```

The function export does not change. `event.type` is still `queue` and `event.records` is still the batch.
