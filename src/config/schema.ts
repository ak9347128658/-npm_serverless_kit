import { z } from "zod";
import { PROVIDERS } from "../catalog.js";
import { ConfigError } from "../errors.js";
import {
  HTTP_METHODS,
  PROVIDER_NAMES,
  RUNTIMES,
  type BackendConfig,
  type EventConfig,
  type FunctionConfig,
  type HttpMethod,
  type KitConfig,
  type ProviderName,
  type ProviderOptionMap,
  type RuntimeName,
  type WorkflowConfig,
  type WorkflowState,
} from "../types.js";

const providerOptionsSchema = z
  .object({
    aws: z.record(z.unknown()).optional(),
    gcp: z.record(z.unknown()).optional(),
    azure: z.record(z.unknown()).optional(),
    cloudflare: z.record(z.unknown()).optional(),
    alibaba: z.record(z.unknown()).optional(),
    ibm: z.record(z.unknown()).optional(),
    oracle: z.record(z.unknown()).optional(),
    tencent: z.record(z.unknown()).optional(),
    huawei: z.record(z.unknown()).optional(),
    digitalocean: z.record(z.unknown()).optional(),
  })
  .strict();

const envSchema = z
  .record(z.union([z.string(), z.number(), z.boolean()]))
  .default({})
  .transform((record) =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [key, String(value)])),
  );

function methodOf(value: unknown): HttpMethod {
  const text = String(value ?? "GET").toUpperCase();
  if (!(HTTP_METHODS as readonly string[]).includes(text)) {
    throw new ConfigError(`HTTP method "${String(value)}" is not one of ${HTTP_METHODS.join(", ")}.`);
  }
  return text as HttpMethod;
}

function cleanOptions(
  options: z.infer<typeof providerOptionsSchema> | undefined,
): ProviderOptionMap | undefined {
  if (!options) return undefined;
  const entries = Object.entries(options).filter((entry): entry is [string, Record<string, unknown>] => entry[1] !== undefined);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as ProviderOptionMap;
}

function positiveInt(value: unknown, where: string, fallback: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new ConfigError(`${where} must be a positive integer.`);
  }
  return number;
}

const EVENT_KEYS = ["http", "schedule", "queue", "topic", "storage", "event", "stream"] as const;

export function parseEvent(input: unknown, where: string): EventConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ConfigError(`${where} must be an object with one event key.`);
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || !(EVENT_KEYS as readonly string[]).includes(keys[0])) {
    throw new ConfigError(
      `${where} must contain exactly one of: ${EVENT_KEYS.join(", ")}. Found: ${keys.join(", ") || "(empty)"}.`,
    );
  }
  const key = keys[0] as (typeof EVENT_KEYS)[number];
  const body = record[key];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ConfigError(`${where}.${key} must be an object.`);
  }
  const source = body as Record<string, unknown>;
  const hasProviderBlock = PROVIDER_NAMES.some((name) => source[name] !== undefined);
  const providerOptions = hasProviderBlock
    ? cleanOptions(
        providerOptionsSchema.parse({
          aws: source.aws,
          gcp: source.gcp,
          azure: source.azure,
          cloudflare: source.cloudflare,
          alibaba: source.alibaba,
          ibm: source.ibm,
          oracle: source.oracle,
          tencent: source.tencent,
          huawei: source.huawei,
          digitalocean: source.digitalocean,
        }),
      )
    : undefined;

  switch (key) {
    case "http": {
      if (typeof source.path !== "string" || source.path.length === 0) {
        throw new ConfigError(`${where}.http.path is required.`);
      }
      const path = source.path.startsWith("/") ? source.path : `/${source.path}`;
      const auth = source.auth ?? "public";
      if (auth !== "public" && auth !== "iam" && auth !== "provider") {
        throw new ConfigError(`${where}.http.auth must be public, iam, or provider.`);
      }
      return {
        type: "http",
        http: {
          path,
          method: methodOf(source.method),
          auth,
          cors: source.cors === undefined ? false : Boolean(source.cors),
          providerOptions,
        },
      };
    }
    case "schedule": {
      const expression = source.expression ?? source.cron ?? source.rate;
      if (typeof expression !== "string" || expression.trim().length === 0) {
        throw new ConfigError(`${where}.schedule needs expression, cron, or rate.`);
      }
      return {
        type: "schedule",
        schedule: {
          expression: expression.trim(),
          timezone: typeof source.timezone === "string" ? source.timezone : "UTC",
          description: typeof source.description === "string" ? source.description : undefined,
          providerOptions,
        },
      };
    }
    case "queue": {
      const name = typeof source.name === "string" ? source.name : undefined;
      const arn = typeof source.arn === "string" ? source.arn : undefined;
      if (!name && !arn) throw new ConfigError(`${where}.queue needs name or arn.`);
      return {
        type: "queue",
        queue: {
          name,
          arn,
          batchSize: positiveInt(source.batchSize, `${where}.queue.batchSize`, 10),
          create: source.create === undefined ? !arn : Boolean(source.create),
          providerOptions,
        },
      };
    }
    case "topic": {
      const name = typeof source.name === "string" ? source.name : undefined;
      const arn = typeof source.arn === "string" ? source.arn : undefined;
      if (!name && !arn) throw new ConfigError(`${where}.topic needs name or arn.`);
      return {
        type: "topic",
        topic: {
          name,
          arn,
          create: source.create === undefined ? !arn : Boolean(source.create),
          filter: typeof source.filter === "string" ? source.filter : undefined,
          providerOptions,
        },
      };
    }
    case "storage": {
      if (typeof source.bucket !== "string" || source.bucket.length === 0) {
        throw new ConfigError(`${where}.storage.bucket is required.`);
      }
      const events = Array.isArray(source.events) ? source.events : ["created"];
      for (const item of events) {
        if (item !== "created" && item !== "deleted") {
          throw new ConfigError(`${where}.storage.events only supports created and deleted.`);
        }
      }
      return {
        type: "storage",
        storage: {
          bucket: source.bucket,
          events: events as Array<"created" | "deleted">,
          prefix: typeof source.prefix === "string" ? source.prefix : undefined,
          suffix: typeof source.suffix === "string" ? source.suffix : undefined,
          create: source.create === undefined ? false : Boolean(source.create),
          providerOptions,
        },
      };
    }
    case "event": {
      return {
        type: "event",
        event: {
          bus: typeof source.bus === "string" ? source.bus : undefined,
          source: typeof source.source === "string" ? source.source : undefined,
          detailType: typeof source.detailType === "string" ? source.detailType : undefined,
          pattern:
            source.pattern && typeof source.pattern === "object" && !Array.isArray(source.pattern)
              ? (source.pattern as Record<string, unknown>)
              : undefined,
          providerOptions,
        },
      };
    }
    case "stream": {
      if (typeof source.arn !== "string" || source.arn.length === 0) {
        throw new ConfigError(`${where}.stream.arn is required. The kit does not create streams.`);
      }
      const starting = source.startingPosition ?? "LATEST";
      if (starting !== "LATEST" && starting !== "TRIM_HORIZON") {
        throw new ConfigError(`${where}.stream.startingPosition must be LATEST or TRIM_HORIZON.`);
      }
      return {
        type: "stream",
        stream: {
          arn: source.arn,
          batchSize: positiveInt(source.batchSize, `${where}.stream.batchSize`, 100),
          startingPosition: starting,
          providerOptions,
        },
      };
    }
    default: {
      const _never: never = key;
      throw new ConfigError(`Unknown event ${_never}`);
    }
  }
}

const choiceRuleSchema = z
  .object({
    variable: z.string().min(1),
    stringEquals: z.string().optional(),
    numericEquals: z.number().optional(),
    numericGreaterThan: z.number().optional(),
    booleanEquals: z.boolean().optional(),
    next: z.string().min(1),
  })
  .strict()
  .superRefine((rule, ctx) => {
    const checks = [rule.stringEquals, rule.numericEquals, rule.numericGreaterThan, rule.booleanEquals].filter(
      (item) => item !== undefined,
    );
    if (checks.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A choice rule needs exactly one comparison: stringEquals, numericEquals, numericGreaterThan, or booleanEquals.",
      });
    }
  });

const retrySchema = z
  .object({
    errors: z.array(z.string()).min(1).default(["States.ALL"]),
    intervalSeconds: z.number().positive().default(2),
    maxAttempts: z.number().int().positive().default(3),
    backoffRate: z.number().positive().default(2),
  })
  .strict();

const catchSchema = z
  .object({
    errors: z.array(z.string()).min(1).default(["States.ALL"]),
    next: z.string().min(1),
  })
  .strict();

const stateSchema = z.union([
  z.object({
    type: z.literal("task"),
    function: z.string().min(1),
    next: z.string().optional(),
    end: z.boolean().optional(),
    retry: z.array(retrySchema).optional(),
    catch: z.array(catchSchema).optional(),
    comment: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal("choice"),
    choices: z.array(choiceRuleSchema).min(1),
    default: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal("wait"),
    seconds: z.number().positive(),
    next: z.string().optional(),
    end: z.boolean().optional(),
  }).strict(),
  z.object({
    type: z.literal("pass"),
    result: z.unknown().optional(),
    next: z.string().optional(),
    end: z.boolean().optional(),
  }).strict(),
  z.object({ type: z.literal("succeed") }).strict(),
  z.object({
    type: z.literal("fail"),
    error: z.string().optional(),
    cause: z.string().optional(),
  }).strict(),
]);

const workflowSchema = z
  .object({
    engine: z.enum(["native", "portable"]).optional(),
    type: z.enum(["STANDARD", "EXPRESS"]).default("STANDARD"),
    comment: z.string().optional(),
    startAt: z.string().min(1),
    states: z.record(stateSchema),
  })
  .strict();

const functionSchema = z
  .object({
    handler: z.string().min(3),
    description: z.string().optional(),
    runtime: z.enum(RUNTIMES).optional(),
    memory: z.number().int().positive().optional(),
    timeout: z.number().int().positive().optional(),
    environment: envSchema.optional(),
    architecture: z.enum(["x86_64", "arm64"]).optional(),
    events: z.array(z.unknown()).optional(),
  })
  .strict();

const backendSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("local") }).strict(),
  z.object({
    type: z.literal("s3"),
    bucket: z.string().min(1),
    key: z.string().min(1),
    region: z.string().min(1),
    dynamodbTable: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal("gcs"),
    bucket: z.string().min(1),
    prefix: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal("azurerm"),
    resourceGroup: z.string().min(1),
    storageAccount: z.string().min(1),
    container: z.string().min(1),
    key: z.string().min(1),
  }).strict(),
]);

const rawConfigSchema = z
  .object({
    service: z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,39}$/, "service must start with a letter and use letters, numbers, and hyphens (max 40)."),
    framework: z.literal("serverless-kit").optional(),
    provider: z
      .object({
        name: z.enum(PROVIDER_NAMES),
        runtime: z.enum(RUNTIMES).optional(),
        region: z.string().min(1).optional(),
        stage: z.string().regex(/^[A-Za-z0-9-]+$/).optional(),
        memory: z.number().int().positive().optional(),
        timeout: z.number().int().positive().optional(),
        environment: envSchema.optional(),
        architecture: z.enum(["x86_64", "arm64"]).optional(),
        backend: backendSchema.optional(),
        aws: z.object({ logRetentionDays: z.number().int().positive().optional(), tracing: z.boolean().optional() }).strict().optional(),
        gcp: z.object({ project: z.string().min(1), manageApis: z.boolean().optional() }).strict().optional(),
        azure: z.object({
          resourceGroup: z.string().optional(),
          location: z.string().optional(),
          functionAppName: z.string().optional(),
        }).strict().optional(),
        cloudflare: z.object({
          accountId: z.string().min(1),
          zoneId: z.string().optional(),
          routePattern: z.string().optional(),
          workersDevSubdomain: z.string().optional(),
        }).strict().optional(),
        alibaba: z.object({ roleArn: z.string().optional() }).strict().optional(),
        ibm: z.object({ namespace: z.string().min(1), resourceGroupId: z.string().optional() }).strict().optional(),
        oracle: z.object({
          compartmentId: z.string().min(1),
          subnetIds: z.array(z.string().min(1)).min(1),
          image: z.string().optional(),
          applicationId: z.string().optional(),
        }).strict().optional(),
        tencent: z.object({ namespace: z.string().optional(), appId: z.string().optional() }).strict().optional(),
        huawei: z.object({ agency: z.string().min(1), enterpriseProjectId: z.string().optional() }).strict().optional(),
        digitalocean: z.object({ namespace: z.string().optional() }).strict().optional(),
      })
      .strict(),
    functions: z.record(functionSchema),
    workflows: z.record(workflowSchema).optional(),
    package: z.object({
      external: z.array(z.string()).optional(),
      minify: z.boolean().optional(),
      sourcemap: z.boolean().optional(),
    }).strict().optional(),
    hooks: z.object({
      beforePackage: z.string().optional(),
      afterPackage: z.string().optional(),
      beforeDeploy: z.string().optional(),
      afterDeploy: z.string().optional(),
    }).strict().optional(),
    ui: z.object({
      title: z.string().optional(),
      out: z.string().optional(),
    }).strict().optional(),
  })
  .strict();

export interface CliOverlay {
  stage?: string;
  region?: string;
  provider?: ProviderName;
}

export function parseConfig(input: unknown, overlay: CliOverlay = {}): KitConfig {
  const parsed = rawConfigSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`serverless-kit.yml is invalid.\n${message}`);
  }
  const raw = parsed.data;
  if (Object.keys(raw.functions).length === 0) {
    throw new ConfigError("Add at least one function under functions.");
  }

  const providerName = overlay.provider ?? raw.provider.name;
  const runtime = (raw.provider.runtime ?? "nodejs20") as RuntimeName;
  const region = overlay.region ?? raw.provider.region ?? PROVIDERS[providerName].defaultRegion;
  const stage = overlay.stage ?? raw.provider.stage ?? "dev";

  const functions: Record<string, FunctionConfig> = {};
  for (const [name, fn] of Object.entries(raw.functions)) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(name)) {
      throw new ConfigError(
        `Function name "${name}" must start with a letter or underscore and use letters, numbers, underscores, or hyphens.`,
      );
    }
    const handlerParts = fn.handler.split(".");
    if (handlerParts.length < 2 || handlerParts.some((part) => part.length === 0)) {
      throw new ConfigError(
        `Function "${name}" handler "${fn.handler}" must look like src/file.exportName.`,
      );
    }
    const events = (fn.events ?? []).map((event, index) => parseEvent(event, `functions.${name}.events[${index}]`));
    functions[name] = {
      handler: fn.handler,
      description: fn.description,
      runtime: fn.runtime,
      memory: fn.memory,
      timeout: fn.timeout,
      environment: fn.environment ?? {},
      architecture: fn.architecture,
      events,
    };
  }

  const workflows: Record<string, WorkflowConfig> = {};
  for (const [name, workflow] of Object.entries(raw.workflows ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(name)) {
      throw new ConfigError(`Workflow name "${name}" has unsupported characters.`);
    }
    const states = workflow.states as Record<string, WorkflowState>;
    if (Object.keys(states).length === 0) {
      throw new ConfigError(`Workflow "${name}" needs at least one state.`);
    }
    if (!states[workflow.startAt]) {
      throw new ConfigError(`Workflow "${name}" startAt "${workflow.startAt}" does not match a state.`);
    }
    for (const [stateName, state] of Object.entries(states)) {
      assertStateLinks(name, stateName, state, states, functions);
    }
    const defaultEngine = providerName === "aws" || providerName === "gcp" ? "native" : "portable";
    let engine = workflow.engine ?? defaultEngine;
    if (engine === "native" && providerName !== "aws" && providerName !== "gcp") {
      engine = "portable";
    }
    workflows[name] = {
      engine,
      type: workflow.type,
      comment: workflow.comment,
      startAt: workflow.startAt,
      states,
    };
  }

  return {
    service: raw.service,
    provider: {
      name: providerName,
      runtime,
      region,
      stage,
      memory: raw.provider.memory ?? 256,
      timeout: raw.provider.timeout ?? 30,
      environment: raw.provider.environment ?? {},
      architecture: raw.provider.architecture ?? "x86_64",
      backend: raw.provider.backend as BackendConfig | undefined,
      aws: raw.provider.aws,
      gcp: raw.provider.gcp,
      azure: raw.provider.azure,
      cloudflare: raw.provider.cloudflare,
      alibaba: raw.provider.alibaba,
      ibm: raw.provider.ibm,
      oracle: raw.provider.oracle,
      tencent: raw.provider.tencent,
      huawei: raw.provider.huawei,
      digitalocean: raw.provider.digitalocean,
    },
    functions,
    workflows,
    package: raw.package ?? {},
    hooks: raw.hooks ?? {},
    ui: raw.ui ?? {},
  };
}

function assertStateLinks(
  workflowName: string,
  stateName: string,
  state: WorkflowState,
  states: Record<string, WorkflowState>,
  functions: Record<string, FunctionConfig>,
): void {
  const checkNext = (next: string | undefined, label: string) => {
    if (next && !states[next]) {
      throw new ConfigError(`Workflow "${workflowName}" state "${stateName}" ${label} "${next}" does not exist.`);
    }
  };
  if (state.type === "task") {
    if (!functions[state.function]) {
      throw new ConfigError(
        `Workflow "${workflowName}" state "${stateName}" calls function "${state.function}", which is not in this file.`,
      );
    }
    if (!state.next && !state.end) {
      throw new ConfigError(`Workflow "${workflowName}" task "${stateName}" needs next or end: true.`);
    }
    checkNext(state.next, "next");
    for (const item of state.catch ?? []) checkNext(item.next, "catch next");
  } else if (state.type === "choice") {
    for (const choice of state.choices) checkNext(choice.next, "choice next");
    checkNext(state.default, "default");
  } else if (state.type === "wait" || state.type === "pass") {
    if (!state.next && !state.end) {
      throw new ConfigError(`Workflow "${workflowName}" state "${stateName}" needs next or end: true.`);
    }
    checkNext(state.next, "next");
  }
}
