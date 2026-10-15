# Providers

Each provider block below is the minimum that validates. The handler in [examples/switch-provider](../examples/switch-provider) is the same file for all ten.

Credentials are environment variables or CLI logins. They are not copied into Terraform.

## AWS

```yaml
provider:
  name: aws
  region: us-east-1
  aws:
    logRetentionDays: 14
```

Terraform provider `hashicorp/aws` `~> 5.80`. HTTP is API Gateway v2. Schedules are EventBridge. Queues are SQS. Topics are SNS. Storage is S3. Streams are event source mappings. Workflows are Step Functions.

A created SQS queue's invoke permission uses `Resource: "*"`. Step Functions invoke permission is similarly broad so a queue policy does not cycle on the queue's own ARN. Tighten these in a follow-up resource if your account requires least privilege. Do that in a hook or by editing generated Terraform only if you accept that the next `sk package` overwrites `*.tf`.

## Google Cloud

```yaml
provider:
  name: gcp
  region: us-central1
  gcp:
    project: my-project
    manageApis: true
```

Terraform provider `hashicorp/google` `~> 6.0`. Functions are gen2 (`google_cloudfunctions2_function`). Schedules are Cloud Scheduler jobs that call the function with OIDC. One background trigger per function. Native workflows are Cloud Workflows.

`manageApis: true` enables the APIs the stack needs. Leave it false when the project already has them.

## Azure

```yaml
provider:
  name: azure
  region: eastus
  azure:
    resourceGroup: rg-shop-dev
    location: eastus
    functionAppName: shop-dev-fn
```

Terraform provider `hashicorp/azurerm` `~> 4.0`, plus `hashicorp/time` for a stable blob SAS. The plan is Linux Consumption (Y1). There is no Kudu zip deploy. `WEBSITE_RUN_FROM_PACKAGE` points at a blob in the account the kit creates.

One Function App holds every function. App settings are shared. See [configuration.md](configuration.md).

Queues are Storage queues. Topics are Service Bus Standard. Blobs use the same storage account. The container `packages` holds the zip. Do not name a data container `packages`.

## Cloudflare

```yaml
provider:
  name: cloudflare
  cloudflare:
    accountId: account-id
    workersDevSubdomain: my-subdomain
    zoneId: optional-zone
    routePattern: optional.example.com/*
```

Terraform provider `cloudflare/cloudflare` `~> 5.0`. The Worker is `cloudflare_workers_script` with `nodejs_compat`. Schedules are cron triggers. Queues are `cloudflare_queue`. Set `zoneId` and `routePattern` together when you want a route on a zone. The workers.dev URL is emitted when `workersDevSubdomain` is set.

`CLOUDFLARE_API_TOKEN` supplies credentials.

## Alibaba Cloud

```yaml
provider:
  name: alibaba
  region: cn-hangzhou
  alibaba:
    roleArn: acs:ram::123456:role/fc-role
```

Terraform provider `aliyun/alicloud` `~> 1.240`. Functions are `alicloud_fcv3_function`. Code is an OSS object in a bucket the kit creates. HTTP and timer triggers do not need a role. Queue, topic, and storage triggers do.

Queues are Message Service queues with an EventBridge trigger. Topics are Message Service topics with an `mns_topic` trigger. Storage is OSS. Every trigger sets `qualifier` to `LATEST`.

## IBM Cloud

```yaml
provider:
  name: ibm
  region: us-south
  ibm:
    namespace: my-namespace
```

Terraform provider `IBM-Cloud/ibm` `~> 1.70`. Actions are `ibm_function_action` with a zip and `web-export` when the function has HTTP or no events. Schedules use the alarm feed `/whisk.system/alarms/alarm` and a rule.

## Oracle Cloud

```yaml
provider:
  name: oracle
  region: us-ashburn-1
  oracle:
    compartmentId: ocid1.compartment.oc1..example
    subnetIds:
      - ocid1.subnet.oc1..example
    image: region.ocir.io/tenancy/hello:dev
```

Terraform provider `oracle/oci` `~> 6.0`. Functions are containers. `sk package` writes a Dockerfile under `.serverless-kit/build/oracle/<function>` that runs `node index.js` and listens on 8080. Build it, push it to OCIR, set `image`, then `sk deploy`.

`sk plan` can run before the image exists. The generated `image` is empty until you set it, and `terraform apply` will fail. `sk deploy` refuses to start without `image`.

HTTP and direct invoke only.

## Tencent Cloud

```yaml
provider:
  name: tencent
  region: ap-guangzhou
  tencent:
    appId: "1250000000"   # required only when storage.create is true
```

Terraform provider `tencentcloudstack/tencentcloud` `~> 1.81`. The zip is inlined with `filebase64`. Very large zips need a COS upload path this version does not generate. Keep bundles small, or split the service.

Timers use a 7-field cron. Queues and topics are TCMQ (`tencentcloud_tcmq_queue`, `tencentcloud_tcmq_topic`) with a CMQ trigger. Storage is a COS trigger. One event string per bucket.

## Huawei Cloud

```yaml
provider:
  name: huawei
  region: cn-north-4
  huawei:
    agency: kit-agency
```

Terraform provider `huaweicloud/huaweicloud` `~> 1.70`. Functions are `huaweicloud_fgs_function` with a zip. `user_data` is `jsonencode` of the environment, including Terraform references such as the invoke token.

Schedules are TIMER triggers. Topics are SMN. Storage is OBS with a suffix filter. Queues are not generated.

## DigitalOcean

```yaml
provider:
  name: digitalocean
  region: nyc1
  runtime: nodejs18
  digitalocean:
    namespace: optional-note
```

The DigitalOcean Terraform provider does not upload function source. The kit writes `project.yml` and a `null_resource` that runs `doctl serverless deploy .` in the build directory. Connect a namespace first:

```bash
doctl serverless connect <namespace-id>
```

HTTP and schedules only. No workflows. On Windows the provisioner uses PowerShell. The command is the same.

## State

Local state is the default. Remote state:

```yaml
provider:
  backend:
    type: gcs
    bucket: my-tf-state
    prefix: shop/dev
```

```yaml
provider:
  backend:
    type: azurerm
    resourceGroup: rg-tfstate
    storageAccount: tfstateaccount
    container: tfstate
    key: shop.dev.tfstate
```

Create the backend bucket or account before `sk deploy`. The kit does not create it, because the state backend cannot depend on resources in the same apply.
