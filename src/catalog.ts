import type { EventType, ProviderName, RuntimeName } from "./types.js";

export interface ProviderInfo {
  name: ProviderName;
  title: string;
  product: string;
  terraformProvider: string;
  terraformSource: string;
  defaultRegion: string;
  credentialEnv: string[];
  docs: string;
}

export const PROVIDERS: Record<ProviderName, ProviderInfo> = {
  aws: {
    name: "aws",
    title: "Amazon Web Services",
    product: "Lambda, API Gateway, EventBridge, SQS, SNS, S3, Step Functions",
    terraformProvider: "hashicorp/aws",
    terraformSource: "hashicorp/aws",
    defaultRegion: "us-east-1",
    credentialEnv: ["AWS_PROFILE", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
    docs: "https://registry.terraform.io/providers/hashicorp/aws/latest/docs",
  },
  gcp: {
    name: "gcp",
    title: "Google Cloud",
    product: "Cloud Functions (2nd gen), Cloud Scheduler, Pub/Sub, Eventarc, Workflows",
    terraformProvider: "hashicorp/google",
    terraformSource: "hashicorp/google",
    defaultRegion: "us-central1",
    credentialEnv: ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_PROJECT"],
    docs: "https://registry.terraform.io/providers/hashicorp/google/latest/docs",
  },
  azure: {
    name: "azure",
    title: "Microsoft Azure",
    product: "Linux Function App (consumption), Storage queues, Service Bus, Blob",
    terraformProvider: "hashicorp/azurerm",
    terraformSource: "hashicorp/azurerm",
    defaultRegion: "eastus",
    credentialEnv: ["ARM_SUBSCRIPTION_ID", "ARM_TENANT_ID", "ARM_CLIENT_ID", "ARM_CLIENT_SECRET"],
    docs: "https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs",
  },
  cloudflare: {
    name: "cloudflare",
    title: "Cloudflare",
    product: "Workers, Cron Triggers, Queues",
    terraformProvider: "cloudflare/cloudflare",
    terraformSource: "cloudflare/cloudflare",
    defaultRegion: "global",
    credentialEnv: ["CLOUDFLARE_API_TOKEN"],
    docs: "https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs",
  },
  alibaba: {
    name: "alibaba",
    title: "Alibaba Cloud",
    product: "Function Compute 3.0, OSS, timer and HTTP triggers",
    terraformProvider: "aliyun/alicloud",
    terraformSource: "aliyun/alicloud",
    defaultRegion: "cn-hangzhou",
    credentialEnv: ["ALICLOUD_ACCESS_KEY", "ALICLOUD_SECRET_KEY", "ALICLOUD_REGION"],
    docs: "https://registry.terraform.io/providers/aliyun/alicloud/latest/docs",
  },
  ibm: {
    name: "ibm",
    title: "IBM Cloud",
    product: "Cloud Functions actions, web actions, alarm triggers",
    terraformProvider: "IBM-Cloud/ibm",
    terraformSource: "IBM-Cloud/ibm",
    defaultRegion: "us-south",
    credentialEnv: ["IC_API_KEY", "IBMCLOUD_API_KEY"],
    docs: "https://registry.terraform.io/providers/IBM-Cloud/ibm/latest/docs",
  },
  oracle: {
    name: "oracle",
    title: "Oracle Cloud",
    product: "OCI Functions (container image) and API Gateway when configured",
    terraformProvider: "oracle/oci",
    terraformSource: "oracle/oci",
    defaultRegion: "us-ashburn-1",
    credentialEnv: ["TF_VAR_tenancy_ocid", "TF_VAR_user_ocid", "TF_VAR_fingerprint", "TF_VAR_private_key_path"],
    docs: "https://registry.terraform.io/providers/oracle/oci/latest/docs",
  },
  tencent: {
    name: "tencent",
    title: "Tencent Cloud",
    product: "Serverless Cloud Function (SCF)",
    terraformProvider: "tencentcloudstack/tencentcloud",
    terraformSource: "tencentcloudstack/tencentcloud",
    defaultRegion: "ap-guangzhou",
    credentialEnv: ["TENCENTCLOUD_SECRET_ID", "TENCENTCLOUD_SECRET_KEY", "TENCENTCLOUD_REGION"],
    docs: "https://registry.terraform.io/providers/tencentcloudstack/tencentcloud/latest/docs",
  },
  huawei: {
    name: "huawei",
    title: "Huawei Cloud",
    product: "FunctionGraph",
    terraformProvider: "huaweicloud/huaweicloud",
    terraformSource: "huaweicloud/huaweicloud",
    defaultRegion: "cn-north-4",
    credentialEnv: ["HW_ACCESS_KEY", "HW_SECRET_KEY", "HW_REGION_NAME"],
    docs: "https://registry.terraform.io/providers/huaweicloud/huaweicloud/latest/docs",
  },
  digitalocean: {
    name: "digitalocean",
    title: "DigitalOcean",
    product: "Functions (doctl project.yml applied by Terraform local-exec)",
    terraformProvider: "digitalocean/digitalocean",
    terraformSource: "digitalocean/digitalocean",
    defaultRegion: "nyc1",
    credentialEnv: ["DIGITALOCEAN_TOKEN"],
    docs: "https://docs.digitalocean.com/products/functions/",
  },
};

export type EventSupport = "yes" | "no";

/**
 * What `sk deploy` can generate today.
 * "no" fails validation with a provider-specific hint instead of emitting Terraform that cannot apply.
 */
export const EVENT_SUPPORT: Record<ProviderName, Record<EventType, EventSupport>> = {
  aws: { http: "yes", schedule: "yes", queue: "yes", topic: "yes", storage: "yes", event: "yes", stream: "yes" },
  gcp: { http: "yes", schedule: "yes", queue: "yes", topic: "yes", storage: "yes", event: "yes", stream: "no" },
  azure: { http: "yes", schedule: "yes", queue: "yes", topic: "yes", storage: "yes", event: "no", stream: "no" },
  cloudflare: { http: "yes", schedule: "yes", queue: "yes", topic: "no", storage: "no", event: "no", stream: "no" },
  alibaba: { http: "yes", schedule: "yes", queue: "yes", topic: "yes", storage: "yes", event: "no", stream: "no" },
  ibm: { http: "yes", schedule: "yes", queue: "no", topic: "no", storage: "no", event: "no", stream: "no" },
  oracle: { http: "yes", schedule: "no", queue: "no", topic: "no", storage: "no", event: "no", stream: "no" },
  tencent: { http: "yes", schedule: "yes", queue: "yes", topic: "yes", storage: "yes", event: "no", stream: "no" },
  huawei: { http: "yes", schedule: "yes", queue: "no", topic: "yes", storage: "yes", event: "no", stream: "no" },
  digitalocean: { http: "yes", schedule: "yes", queue: "no", topic: "no", storage: "no", event: "no", stream: "no" },
};

export const NATIVE_WORKFLOW: Record<ProviderName, boolean> = {
  aws: true,
  gcp: true,
  azure: false,
  cloudflare: false,
  alibaba: false,
  ibm: false,
  oracle: false,
  tencent: false,
  huawei: false,
  digitalocean: false,
};

const HINTS: Record<string, string> = {
  stream:
    "Stream triggers map to AWS Kinesis or DynamoDB streams. Put the stream behind a queue or topic, then switch the YAML event.",
  event:
    "Custom event-bus triggers are generated for AWS EventBridge and Google Pub/Sub. On other clouds, publish to a queue or topic.",
  topic: "This cloud has no topic resource in the kit. Use a queue, or an HTTP endpoint that receives the message.",
  storage: "Object triggers are not generated for this cloud. Send the object event to a queue or call the function over HTTP.",
  queue:
    "This cloud has no queue binding in the kit. Huawei FunctionGraph has no standalone queue resource here; use a topic (SMN) or an HTTP route. On other clouds, expose an HTTP route and have the producer call it.",
  schedule:
    "This cloud has no timer resource in the kit. Call the HTTP route from an external scheduler.",
};

export function unsupportedHint(eventType: EventType): string {
  return HINTS[eventType] ?? "Remove the trigger or pick a provider that lists it as supported in docs/provider-matrix.md.";
}

export interface RuntimeMapping {
  value: string;
  esbuildTarget: string;
  warning?: string;
}

export function mapRuntime(provider: ProviderName, runtime: RuntimeName): RuntimeMapping {
  const target = runtime === "nodejs18" ? "node18" : runtime === "nodejs20" ? "node20" : "node22";
  switch (provider) {
    case "aws":
      return { value: `${runtime}.x`, esbuildTarget: target };
    case "gcp":
      return { value: runtime, esbuildTarget: target };
    case "azure":
      return {
        value: runtime === "nodejs18" ? "18" : runtime === "nodejs20" ? "20" : "22",
        esbuildTarget: target,
      };
    case "cloudflare":
      return {
        value: "workers-nodejs-compat",
        esbuildTarget: "es2022",
        warning:
          runtime === "nodejs22"
            ? "Cloudflare Workers run the bundled JavaScript with nodejs_compat. There is no Node 22 process. Avoid Node-only built-ins such as fs and net."
            : "Cloudflare Workers run the bundled JavaScript with nodejs_compat. Avoid Node-only built-ins such as fs and net.",
      };
    case "alibaba":
      return {
        value: runtime === "nodejs22" ? "nodejs20" : runtime,
        esbuildTarget: runtime === "nodejs22" ? "node20" : target,
        warning: runtime === "nodejs22" ? "Function Compute is deployed with the nodejs20 runtime because nodejs22 is not a stable FC runtime id." : undefined,
      };
    case "ibm":
      return {
        value: runtime === "nodejs22" ? "nodejs:20" : `nodejs:${runtime.slice("nodejs".length)}`,
        esbuildTarget: runtime === "nodejs22" ? "node20" : target,
        warning: runtime === "nodejs22" ? "IBM Cloud Functions is deployed as nodejs:20." : undefined,
      };
    case "oracle":
      return {
        value: runtime === "nodejs18" ? "node:18" : runtime === "nodejs20" ? "node:20" : "node:22",
        esbuildTarget: target,
      };
    case "tencent": {
      const value = runtime === "nodejs18" ? "Nodejs18.15" : "Nodejs20.15";
      return {
        value,
        esbuildTarget: runtime === "nodejs18" ? "node18" : "node20",
        warning:
          runtime === "nodejs22"
            ? "Tencent SCF is deployed as Nodejs20.15. If the account rejects that runtime, set runtime: nodejs18."
            : runtime === "nodejs20"
              ? "Tencent SCF runtime id is Nodejs20.15. If apply rejects it, set runtime: nodejs18."
              : undefined,
      };
    }
    case "huawei": {
      const value = runtime === "nodejs18" ? "Node.js18.15" : "Node.js20.15";
      return {
        value,
        esbuildTarget: runtime === "nodejs18" ? "node18" : "node20",
        warning: runtime === "nodejs22" ? "FunctionGraph is deployed as Node.js20.15." : undefined,
      };
    }
    case "digitalocean":
      return {
        value: "nodejs:18",
        esbuildTarget: "node18",
        warning:
          runtime === "nodejs18"
            ? undefined
            : "DigitalOcean Functions project.yml is generated with runtime nodejs:18. The kit bundles JavaScript down to that target.",
      };
    default: {
      const _never: never = provider;
      return _never;
    }
  }
}
