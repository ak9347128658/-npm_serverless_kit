import assert from "node:assert/strict";
import { test } from "node:test";
import { KitError } from "../src/errors.js";
import { compile } from "./helpers.js";

test("AWS HTTP, queue, and Step Functions are real resources", () => {
  const { tf } = compile(`
service: shop
provider: { name: aws, region: us-east-1 }
functions:
  charge:
    handler: src/charge.handler
    environment: { LOG_LEVEL: info }
    events:
      - http: { path: /charge, method: POST }
      - queue: { name: jobs }
workflows:
  order:
    engine: native
    startAt: charge
    states:
      charge: { type: task, function: charge, end: true }
`);
  assert.match(tf, /resource "aws_lambda_function"/);
  assert.match(tf, /resource "aws_apigatewayv2_api" "http"/);
  assert.match(tf, /resource "aws_sqs_queue"/);
  assert.match(tf, /resource "aws_sfn_state_machine"/);
  assert.match(tf, /arn:aws:states:::lambda:invoke/);
  assert.match(tf, /LOG_LEVEL\s+= "info"/);
});

test("Google Cloud schedules call the function and native workflows are Workflows", () => {
  const { tf } = compile(`
service: shop
provider:
  name: gcp
  region: us-central1
  gcp: { project: demo-project }
functions:
  charge:
    handler: src/charge.handler
    events:
      - http: { path: /charge, method: POST }
workflows:
  order:
    engine: native
    startAt: charge
    states:
      charge: { type: task, function: charge, end: true }
`);
  assert.match(tf, /resource "google_cloudfunctions2_function"/);
  assert.match(tf, /resource "google_workflows_workflow"/);
  assert.match(tf, /google_cloud_run_service_iam_member/);
});

test("Azure merges env, creates a queue, and dedupes a shared topic", () => {
  const { tf } = compile(`
service: shop
provider: { name: azure, region: eastus }
functions:
  one:
    handler: src/one.handler
    environment: { LOG_LEVEL: info }
    events:
      - queue: { name: Jobs }
      - topic: { name: orders }
  two:
    handler: src/two.handler
    environment: { LOG_LEVEL: info }
    events:
      - topic: { name: orders }
`);
  assert.match(tf, /resource "azurerm_linux_function_app"/);
  assert.match(tf, /resource "azurerm_storage_queue"/);
  assert.match(tf, /name\s+= "jobs"/);
  assert.equal(tf.split('resource "azurerm_servicebus_topic"').length - 1, 1);
  assert.match(tf, /LOG_LEVEL\s+= "info"/);
});

test("Azure rejects conflicting app settings", () => {
  assert.throws(
    () =>
      compile(`
service: shop
provider: { name: azure }
functions:
  one:
    handler: src/one.handler
    environment: { LOG_LEVEL: info }
    events: []
  two:
    handler: src/two.handler
    environment: { LOG_LEVEL: debug }
    events: []
`),
    KitError,
  );
});

test("Cloudflare workers, crons, and queues", () => {
  const { tf } = compile(`
service: shop
provider:
  name: cloudflare
  cloudflare: { accountId: abc, workersDevSubdomain: demo }
functions:
  worker:
    handler: src/worker.handler
    events:
      - http: { path: /work }
      - schedule: { expression: "*/5 * * * *" }
      - queue: { name: jobs }
`);
  assert.match(tf, /resource "cloudflare_workers_script"/);
  assert.match(tf, /resource "cloudflare_workers_cron_trigger"/);
  assert.match(tf, /resource "cloudflare_queue"/);
  assert.match(tf, /nodejs_compat/);
});

test("Alibaba creates MNS and OSS resources instead of comments", () => {
  const { tf } = compile(`
service: shop
provider:
  name: alibaba
  region: cn-hangzhou
  alibaba: { roleArn: acs:ram::1:role/fc }
functions:
  worker:
    handler: src/worker.handler
    events:
      - http: { path: /work, method: ANY }
      - schedule: { expression: rate(5 minutes) }
      - queue: { name: jobs }
      - topic: { name: news }
      - storage: { bucket: uploads, create: true, events: [created] }
`);
  assert.match(tf, /resource "alicloud_fcv3_function"/);
  assert.match(tf, /resource "alicloud_message_service_queue"/);
  assert.match(tf, /resource "alicloud_message_service_topic"/);
  assert.match(tf, /resource "alicloud_oss_bucket"/);
  assert.match(tf, /trigger_type\s+= "eventbridge"/);
  assert.match(tf, /trigger_type\s+= "mns_topic"/);
  assert.match(tf, /trigger_type\s+= "oss"/);
  assert.match(tf, /qualifier\s+= "LATEST"/);
  assert.doesNotMatch(tf, /Bind the existing MNS/);
});

test("IBM alarms and Oracle containers", () => {
  const ibm = compile(`
service: shop
provider:
  name: ibm
  ibm: { namespace: demo }
functions:
  worker:
    handler: src/worker.handler
    events:
      - http: { path: /work }
      - schedule: { expression: rate(5 minutes) }
`);
  assert.match(ibm.tf, /resource "ibm_function_action"/);
  assert.match(ibm.tf, /resource "ibm_function_trigger"/);

  const oracle = compile(`
service: shop
provider:
  name: oracle
  oracle:
    compartmentId: ocid1.compartment.oc1..example
    subnetIds: [ocid1.subnet.oc1..example]
functions:
  worker:
    handler: src/worker.handler
    events:
      - http: { path: /work }
`);
  assert.match(oracle.tf, /resource "oci_functions_function"/);
  assert.match(oracle.tf, /image\s+= ""/);
});

test("Tencent timer, TCMQ, and COS, and Huawei env plus SMN and OBS", () => {
  const tencent = compile(`
service: shop
provider:
  name: tencent
  region: ap-guangzhou
  tencent: { appId: "1250000000" }
functions:
  worker:
    handler: src/worker.handler
    events:
      - schedule: { expression: rate(5 minutes) }
      - queue: { name: jobs }
      - topic: { name: news }
      - storage: { bucket: uploads, create: true, events: [created] }
`);
  assert.match(tencent.tf, /type\s+= "timer"/);
  assert.match(tencent.tf, /0 \*\/5 \* \* \* \* \*/);
  assert.match(tencent.tf, /resource "tencentcloud_tcmq_queue"/);
  assert.match(tencent.tf, /resource "tencentcloud_tcmq_topic"/);
  assert.match(tencent.tf, /resource "tencentcloud_cos_bucket"/);
  assert.match(tencent.tf, /type\s+= "cos"/);

  const huawei = compile(`
service: shop
provider:
  name: huawei
  region: cn-north-4
  huawei: { agency: kit-agency }
functions:
  worker:
    handler: src/worker.handler
    environment: { LOG_LEVEL: info }
    events:
      - schedule: { expression: rate(5 minutes) }
      - topic: { name: news }
      - storage: { bucket: uploads, create: true, events: [created], suffix: ".json" }
`);
  assert.match(huawei.tf, /user_data\s+= jsonencode/);
  assert.match(huawei.tf, /LOG_LEVEL\s+= "info"/);
  assert.doesNotMatch(huawei.tf, /see-terraform-env/);
  assert.match(huawei.tf, /resource "huaweicloud_fgs_function_trigger"/);
  assert.match(huawei.tf, /resource "huaweicloud_smn_topic"/);
  assert.match(huawei.tf, /resource "huaweicloud_obs_bucket"/);
  assert.match(huawei.tf, /type\s+= "SMN"/);
  assert.match(huawei.tf, /type\s+= "OBS"/);
});

test("DigitalOcean redeploys when function code changes", () => {
  const { tf } = compile(`
service: shop
provider: { name: digitalocean }
functions:
  worker:
    handler: src/worker.handler
    events:
      - http: { path: /work }
      - schedule: { expression: "*/15 * * * *" }
`, "win32");
  assert.match(tf, /doctl serverless deploy/);
  assert.match(tf, /filesha256\("\$\{path\.module\}\/\.\.\/build\/digitalocean\/\.sk-code-stamp"\)/);
  assert.match(tf, /powershell/);
});

test("generated Terraform does not embed an invoke token", () => {
  const { tf } = compile(`
service: shop
provider: { name: aws }
functions:
  charge:
    handler: src/charge.handler
    events:
      - http: { path: /charge }
workflows:
  order:
    engine: portable
    startAt: charge
    states:
      charge: { type: task, function: charge, end: true }
`);
  assert.match(tf, /resource "random_password" "sk_invoke_token"/);
  assert.match(tf, /SK_INVOKE_TOKEN\s+= random_password\.sk_invoke_token\.result/);
  assert.doesNotMatch(tf, /SK_INVOKE_TOKEN\s+= "[A-Za-z0-9]{8,}"/);
});
