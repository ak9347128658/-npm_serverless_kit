export const PROVIDER_NAMES = [
  "aws",
  "gcp",
  "azure",
  "cloudflare",
  "alibaba",
  "ibm",
  "oracle",
  "tencent",
  "huawei",
  "digitalocean",
] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

export const RUNTIMES = ["nodejs18", "nodejs20", "nodejs22"] as const;
export type RuntimeName = (typeof RUNTIMES)[number];

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ANY"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const EVENT_TYPES = ["http", "schedule", "queue", "topic", "storage", "event", "stream"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type ProviderOptionMap = Partial<Record<ProviderName, Record<string, unknown>>>;

export interface HttpEvent {
  path: string;
  method: HttpMethod;
  /** public opens the route. iam uses cloud IAM. provider keeps the platform default (keys, OIDC, or a shared invoke token). */
  auth: "public" | "iam" | "provider";
  cors: boolean;
  /** Injected by the planner for workflow calls. Hidden from the public URL list. */
  internal?: boolean;
  providerOptions?: ProviderOptionMap;
}

export interface ScheduleEvent {
  /** Five-field cron, AWS rate(...), or AWS cron(...). The kit converts it per provider. */
  expression: string;
  timezone: string;
  description?: string;
  providerOptions?: ProviderOptionMap;
}

export interface QueueEvent {
  name?: string;
  arn?: string;
  batchSize: number;
  /** Create the queue when the provider can. Ignored when arn is set. */
  create: boolean;
  providerOptions?: ProviderOptionMap;
}

export interface TopicEvent {
  name?: string;
  arn?: string;
  create: boolean;
  filter?: string;
  providerOptions?: ProviderOptionMap;
}

export interface StorageEvent {
  bucket: string;
  events: Array<"created" | "deleted">;
  prefix?: string;
  suffix?: string;
  create: boolean;
  providerOptions?: ProviderOptionMap;
}

export interface EventBusEvent {
  bus?: string;
  source?: string;
  detailType?: string;
  pattern?: Record<string, unknown>;
  providerOptions?: ProviderOptionMap;
}

export interface StreamEvent {
  arn: string;
  batchSize: number;
  startingPosition: "LATEST" | "TRIM_HORIZON";
  providerOptions?: ProviderOptionMap;
}

export type EventConfig =
  | { type: "http"; http: HttpEvent }
  | { type: "schedule"; schedule: ScheduleEvent }
  | { type: "queue"; queue: QueueEvent }
  | { type: "topic"; topic: TopicEvent }
  | { type: "storage"; storage: StorageEvent }
  | { type: "event"; event: EventBusEvent }
  | { type: "stream"; stream: StreamEvent };

export interface RetryPolicy {
  errors: string[];
  intervalSeconds: number;
  maxAttempts: number;
  backoffRate: number;
}

export interface CatchPolicy {
  errors: string[];
  next: string;
}

export interface ChoiceRule {
  variable: string;
  stringEquals?: string;
  numericEquals?: number;
  numericGreaterThan?: number;
  booleanEquals?: boolean;
  next: string;
}

export interface TaskState {
  type: "task";
  function: string;
  next?: string;
  end?: boolean;
  retry?: RetryPolicy[];
  catch?: CatchPolicy[];
  comment?: string;
}

export interface ChoiceState {
  type: "choice";
  choices: ChoiceRule[];
  default?: string;
}

export interface WaitState {
  type: "wait";
  seconds: number;
  next?: string;
  end?: boolean;
}

export interface PassState {
  type: "pass";
  result?: unknown;
  next?: string;
  end?: boolean;
}

export interface SucceedState {
  type: "succeed";
}

export interface FailState {
  type: "fail";
  error?: string;
  cause?: string;
}

export type WorkflowState = TaskState | ChoiceState | WaitState | PassState | SucceedState | FailState;

export interface WorkflowConfig {
  engine: "native" | "portable";
  type: "STANDARD" | "EXPRESS";
  comment?: string;
  startAt: string;
  states: Record<string, WorkflowState>;
}

export interface FunctionConfig {
  handler: string;
  description?: string;
  runtime?: RuntimeName;
  memory?: number;
  timeout?: number;
  environment: Record<string, string>;
  architecture?: "x86_64" | "arm64";
  events: EventConfig[];
}

export interface BackendS3 {
  type: "s3";
  bucket: string;
  key: string;
  region: string;
  dynamodbTable?: string;
}

export interface BackendGcs {
  type: "gcs";
  bucket: string;
  prefix?: string;
}

export interface BackendAzure {
  type: "azurerm";
  resourceGroup: string;
  storageAccount: string;
  container: string;
  key: string;
}

export type BackendConfig = { type: "local" } | BackendS3 | BackendGcs | BackendAzure;

export interface AwsProviderConfig {
  logRetentionDays?: number;
  tracing?: boolean;
}

export interface GcpProviderConfig {
  project: string;
  manageApis?: boolean;
}

export interface AzureProviderConfig {
  resourceGroup?: string;
  location?: string;
  functionAppName?: string;
}

export interface CloudflareProviderConfig {
  accountId: string;
  zoneId?: string;
  routePattern?: string;
  /** Account workers.dev subdomain, required when a portable workflow calls Workers over HTTP. */
  workersDevSubdomain?: string;
}

export interface AlibabaProviderConfig {
  /** RAM role ARN used by OSS, MNS, and event triggers. HTTP and timer do not need it. */
  roleArn?: string;
}

export interface IbmProviderConfig {
  namespace: string;
  resourceGroupId?: string;
}

export interface OracleProviderConfig {
  compartmentId: string;
  subnetIds: string[];
  /** OCIR image tag. Required for deploy. `sk package` still writes a Dockerfile. */
  image?: string;
  applicationId?: string;
}

export interface TencentProviderConfig {
  namespace?: string;
  /** Required only when a zip is too large for inline upload. */
  appId?: string;
}

export interface HuaweiProviderConfig {
  agency: string;
  enterpriseProjectId?: string;
}

export interface DigitalOceanProviderConfig {
  namespace?: string;
}

export interface PackageConfig {
  external?: string[];
  minify?: boolean;
  sourcemap?: boolean;
}

export interface HookConfig {
  beforePackage?: string;
  afterPackage?: string;
  beforeDeploy?: string;
  afterDeploy?: string;
}

export interface UiConfig {
  title?: string;
  out?: string;
}

export interface ProviderConfig {
  name: ProviderName;
  runtime: RuntimeName;
  region: string;
  stage: string;
  memory: number;
  timeout: number;
  environment: Record<string, string>;
  architecture: "x86_64" | "arm64";
  backend?: BackendConfig;
  aws?: AwsProviderConfig;
  gcp?: GcpProviderConfig;
  azure?: AzureProviderConfig;
  cloudflare?: CloudflareProviderConfig;
  alibaba?: AlibabaProviderConfig;
  ibm?: IbmProviderConfig;
  oracle?: OracleProviderConfig;
  tencent?: TencentProviderConfig;
  huawei?: HuaweiProviderConfig;
  digitalocean?: DigitalOceanProviderConfig;
}

export interface KitConfig {
  service: string;
  provider: ProviderConfig;
  functions: Record<string, FunctionConfig>;
  workflows: Record<string, WorkflowConfig>;
  package: PackageConfig;
  hooks: HookConfig;
  ui: UiConfig;
}

export type EntryKind =
  | "lambda"
  | "gcp-http"
  | "gcp-event"
  | "azure"
  | "cloudflare"
  | "openwhisk"
  | "oracle"
  | "workflow-runner";

export interface PhysicalFunction {
  logicalName: string;
  physicalName: string;
  tfId: string;
  handler: string;
  description?: string;
  runtime: RuntimeName;
  providerRuntime: string;
  esbuildTarget: string;
  memory: number;
  timeout: number;
  environment: Record<string, string>;
  architecture: "x86_64" | "arm64";
  events: EventConfig[];
  entry: EntryKind;
  /** Azure binding name for the single trigger on this physical function. */
  azureBinding?: "http" | "timer" | "queue" | "serviceBus" | "blob";
}

export interface PlannedWorkflow {
  name: string;
  tfId: string;
  config: WorkflowConfig;
  /** Engine after provider defaults. */
  engine: "native" | "portable";
}

export interface PlanResult {
  functions: PhysicalFunction[];
  workflows: PlannedWorkflow[];
  warnings: string[];
  /** True when any function exposes the internal workflow invoke route. */
  needsInvokeToken: boolean;
}

export type KitEventType = EventType | "workflow" | "invoke";

export interface KitHttpInfo {
  method: string;
  path: string;
  pathParameters: Record<string, string>;
  query: Record<string, string | string[]>;
  sourceIp?: string;
  protocol?: string;
}

export interface KitRecord {
  id?: string;
  body: unknown;
  raw: unknown;
  attributes?: Record<string, string>;
}

export interface KitEvent<T = unknown> {
  type: KitEventType;
  provider: ProviderName;
  /** Parsed JSON when the body is JSON. Otherwise a string, or the cloud payload. */
  body?: T;
  raw: unknown;
  headers?: Record<string, string>;
  http?: KitHttpInfo;
  records?: KitRecord[];
  storage?: {
    bucket: string;
    key: string;
    eventName?: string;
    size?: number;
  };
  schedule?: {
    time?: string;
    expression?: string;
  };
  topic?: {
    name?: string;
    subject?: string;
    messageId?: string;
  };
  event?: {
    source?: string;
    detailType?: string;
    id?: string;
  };
  workflow?: {
    name?: string;
    step?: string;
    executionId?: string;
  };
}

export interface KitResult {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: unknown;
  batchItemFailures?: Array<{ itemIdentifier: string }>;
}

export interface KitContext {
  functionName: string;
  logicalName: string;
  provider: ProviderName;
  requestId: string;
  memoryMb?: number;
  timeoutMs?: number;
  remainingTimeMs?: () => number;
  raw: unknown;
}

export interface AdapterMeta {
  provider: ProviderName;
  functionName: string;
  logicalName: string;
  memory?: number;
  timeout?: number;
  azureBinding?: PhysicalFunction["azureBinding"];
}

export interface TriggerView {
  type: string;
  method?: string;
  path?: string;
  expression?: string;
  name?: string;
  url?: string;
  internal?: boolean;
  detail?: string;
}

export interface FunctionView {
  logicalName: string;
  physicalName: string;
  handler: string;
  runtime: string;
  providerRuntime: string;
  memory: number;
  timeout: number;
  description?: string;
  entry: EntryKind;
  arn?: string;
  url?: string;
  id?: string;
  environmentKeys: string[];
  triggers: TriggerView[];
}

export interface WorkflowView {
  name: string;
  engine: "native" | "portable";
  type: "STANDARD" | "EXPRESS";
  startAt: string;
  arn?: string;
  url?: string;
  comment?: string;
}

export interface DeploymentModel {
  service: string;
  provider: ProviderName;
  providerTitle: string;
  region: string;
  stage: string;
  runtime: RuntimeName;
  status: "planned" | "deployed";
  deployedAt?: string;
  title: string;
  warnings: string[];
  functions: FunctionView[];
  workflows: WorkflowView[];
}
