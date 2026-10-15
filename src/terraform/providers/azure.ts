import { ARTIFACTS } from "../../paths.js";
import { KitError } from "../../errors.js";
import type { EventConfig } from "../../types.js";
import { q } from "../../util/hcl.js";
import { azureResourceName, cloudName, shortHash, storageAccountName } from "../../util/hash.js";
import {
  envBlock,
  envExpressions,
  fileHeader,
  httpInvokeTargets,
  outputMap,
  randomProvider,
  randomTokenResource,
  runnerFunction,
  tokenExtra,
  type RenderContext,
  urlMapExpression,
  versions,
  workflowOutputs,
} from "../support.js";

export function renderAzure(ctx: RenderContext): Record<string, string> {
  const { config, plan } = ctx;
  const rg = config.provider.azure?.resourceGroup ?? `rg-${config.service}-${config.provider.stage}`;
  const location = config.provider.azure?.location ?? config.provider.region;
  const storage = storageAccountName(config.service, config.provider.stage);
  const app =
    config.provider.azure?.functionAppName ??
    cloudName([config.service, config.provider.stage, "fn", shortHash(config.service + config.provider.stage)], 60);
  const planName = cloudName([config.service, config.provider.stage, "plan"], 60);
  const hasTopic = plan.functions.some((fn) => fn.events.some((event) => event.type === "topic"));
  const extras = [randomProvider(), { name: "time", source: "hashicorp/time", version: "~> 0.12" }];
  if (!plan.needsInvokeToken) extras.shift();
  const runner = runnerFunction(plan);
  const appSettings = azureAppSettings(ctx);
  Object.assign(appSettings, tokenExtra(plan), {
    FUNCTIONS_WORKER_RUNTIME: q("node"),
    WEBSITE_RUN_FROM_PACKAGE:
      "\"https://${azurerm_storage_account.sa.name}.blob.core.windows.net/${azurerm_storage_container.pkg.name}/${azurerm_storage_blob.pkg.name}${data.azurerm_storage_account_blob_container_sas.pkg.sas}\"",
  });
  if (runner) {
    appSettings.SK_FUNCTION_URL_MAP = urlMapExpression(
      httpInvokeTargets(plan).map((fn) => [fn.logicalName, q(`https://${app}.azurewebsites.net/api/sk/invoke/${fn.logicalName}`)]),
    );
  }
  if (hasTopic) appSettings.SK_SERVICEBUS = "azurerm_servicebus_namespace.bus.default_primary_connection_string";

  const node = plan.functions[0]?.providerRuntime ?? "20";
  const topicBlock = hasTopic
    ? `resource "azurerm_servicebus_namespace" "bus" {
  name                = ${q(cloudName([config.service, config.provider.stage, "bus", shortHash(config.service)], 50))}
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "Standard"
}

${uniqueTopics(plan)
  .map(
    (event) => `resource "azurerm_servicebus_topic" "topic_${safe(event.topic.name ?? "topic")}" {
  name         = ${q(event.topic.name ?? "kit-topic")}
  namespace_id = azurerm_servicebus_namespace.bus.id
}

resource "azurerm_servicebus_subscription" "sub_${safe(event.topic.name ?? "topic")}" {
  name               = "kit"
  topic_id           = azurerm_servicebus_topic.topic_${safe(event.topic.name ?? "topic")}.id
  max_delivery_count = 10
}
`,
  )
  .join("\n")}
`
    : "";

  return {
    "main.tf": `${fileHeader(config)}
${versions("hashicorp/azurerm", "~> 4.0", extras)}
${randomTokenResource(plan)}
provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "rg" {
  name     = ${q(rg)}
  location = ${q(location)}
}

resource "azurerm_storage_account" "sa" {
  name                     = ${q(storage)}
  resource_group_name      = azurerm_resource_group.rg.name
  location                 = azurerm_resource_group.rg.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_storage_container" "pkg" {
  name                  = "packages"
  storage_account_id    = azurerm_storage_account.sa.id
  container_access_type = "private"
}

${azureStorageResources(plan)}

resource "azurerm_storage_blob" "pkg" {
  name                   = "site-${shortHash(config.service + config.provider.stage)}.zip"
  storage_account_name   = azurerm_storage_account.sa.name
  storage_container_name = azurerm_storage_container.pkg.name
  type                   = "Block"
  source                 = "\${path.module}/${ARTIFACTS.azureZip}"
}

resource "time_static" "sas" {}

data "azurerm_storage_account_blob_container_sas" "pkg" {
  connection_string = azurerm_storage_account.sa.primary_connection_string
  container_name    = azurerm_storage_container.pkg.name
  https_only        = true
  start             = time_static.sas.rfc3339
  expiry            = timeadd(time_static.sas.rfc3339, "8760h")
  permissions {
    read   = true
    add    = false
    create = false
    write  = false
    delete = false
    list   = false
  }
}

resource "azurerm_service_plan" "plan" {
  name                = ${q(planName)}
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  os_type             = "Linux"
  sku_name            = "Y1"
}

${topicBlock}
resource "azurerm_linux_function_app" "app" {
  name                = ${q(app)}
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  service_plan_id     = azurerm_service_plan.plan.id

  storage_account_name       = azurerm_storage_account.sa.name
  storage_account_access_key = azurerm_storage_account.sa.primary_access_key

  site_config {
    application_stack {
      node_version = ${q(node)}
    }
  }

  app_settings = ${envBlock(appSettings, 4)}
}

${outputMap("sk_functions", Object.fromEntries(plan.functions.map((fn) => {
  const http = fn.events.find((event) => event.type === "http");
  const route = http && http.type === "http" ? http.http.path.replace(/^\//, "") : "";
  return [fn.physicalName, {
    logical_name: q(fn.logicalName),
    arn: "azurerm_linux_function_app.app.id",
    id: q(fn.physicalName),
    url: route ? q(`https://${app}.azurewebsites.net/api/${route}`) : "null",
  }];
})))}

${workflowOutputs(plan.workflows, (workflow) => ({
  arn: q(`https://${app}.azurewebsites.net/api/sk/workflows/${workflow.name}`),
  id: q(workflow.name),
  engine: q(workflow.engine),
}))}
`,
  };
}

function azureAppSettings(ctx: RenderContext): Record<string, string> {
  const merged: Record<string, string> = {};
  const owner = new Map<string, string>();
  for (const fn of ctx.plan.functions) {
    for (const [key, value] of Object.entries(envExpressions(ctx.config, fn))) {
      if (key === "SK_FUNCTION_NAME" || key === "SK_LOGICAL_NAME") continue;
      const previous = owner.get(key);
      if (previous && merged[key] !== value) {
        throw new KitError(
          `Azure Functions share one app settings map. ${key} differs between ${previous} and ${fn.logicalName}. Use the same value on every function. Each bundle already carries its own function name.`,
        );
      }
      if (!previous) owner.set(key, fn.logicalName);
      merged[key] = value;
    }
  }
  return merged;
}

function azureStorageResources(plan: RenderContext["plan"]): string {
  const queues = new Map<string, string>();
  const containers = new Map<string, string>();
  for (const fn of plan.functions) {
    for (const event of fn.events) {
      if (event.type === "queue" && event.queue.create && event.queue.name) {
        const name = azureResourceName(event.queue.name, "queue");
        queues.set(name, name);
      }
      if (event.type === "storage" && event.storage.create) {
        const name = azureResourceName(event.storage.bucket, "data");
        if (name === "packages") {
          throw new KitError(
            `Azure blob container "${event.storage.bucket}" sanitizes to "packages", which serverless-kit uses for the function zip. Pick another storage.bucket.`,
          );
        }
        containers.set(name, name);
      }
    }
  }
  const queueBlocks = [...queues.keys()].map(
    (name) => `resource "azurerm_storage_queue" "${safe(name)}" {
  name                 = ${q(name)}
  storage_account_name = azurerm_storage_account.sa.name
}
`,
  );
  const containerBlocks = [...containers.keys()].map(
    (name) => `resource "azurerm_storage_container" "${safe(name)}" {
  name               = ${q(name)}
  storage_account_id = azurerm_storage_account.sa.id
}
`,
  );
  return [...queueBlocks, ...containerBlocks].join("\n");
}

function uniqueTopics(plan: RenderContext["plan"]): Array<Extract<EventConfig, { type: "topic" }>> {
  const seen = new Set<string>();
  const events: Array<Extract<EventConfig, { type: "topic" }>> = [];
  for (const fn of plan.functions) {
    for (const event of fn.events) {
      if (event.type !== "topic") continue;
      const key = event.topic.name ?? event.topic.arn ?? "topic";
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }
  return events;
}

function safe(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) || "topic";
}
