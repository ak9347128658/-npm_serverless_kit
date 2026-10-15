import type { KitEvent, KitRecord, ProviderName } from "../types.js";
import {
  asRecord,
  decodeBase64,
  header,
  lowerHeaders,
  parseMaybeJson,
  queryMap,
  stringField,
} from "./json.js";

export interface NormalizeHints {
  provider: ProviderName;
  /** Set by the Azure entry so a queue item is not mistaken for a plain invoke. */
  azureBinding?: "http" | "timer" | "queue" | "serviceBus" | "blob";
}

/**
 * Turn a cloud payload into the event your handler always sees.
 * Provider entry files extract HTTP requests into plain objects before calling this.
 */
export function normalizeEvent(raw: unknown, hints: NormalizeHints): KitEvent {
  const envelope = readEnvelope(raw, hints.provider);
  if (envelope) return envelope;

  switch (hints.provider) {
    case "aws":
      return normalizeAws(raw);
    case "gcp":
      return normalizeGcp(raw);
    case "azure":
      return normalizeAzure(raw, hints.azureBinding);
    case "cloudflare":
      return normalizeCloudflare(raw);
    case "ibm":
    case "digitalocean":
      return normalizeOpenWhisk(raw, hints.provider);
    case "alibaba":
    case "tencent":
    case "huawei":
      return normalizeLambdaCompatible(raw, hints.provider);
    case "oracle":
      return normalizeHttpShape(raw, "oracle");
    default: {
      const _never: never = hints.provider;
      return invoke(_never, raw);
    }
  }
}

function readEnvelope(raw: unknown, provider: ProviderName): KitEvent | undefined {
  const record = asRecord(raw);
  const marker = asRecord(record?.__sk);
  const type = stringField(marker, "type");
  if (!marker || (type !== "workflow" && type !== "invoke")) return undefined;
  return {
    type: type === "workflow" ? "workflow" : "invoke",
    provider,
    body: record?.input ?? record?.body,
    raw,
    workflow:
      type === "workflow"
        ? {
            name: stringField(marker, "workflow"),
            step: stringField(marker, "step"),
            executionId: stringField(marker, "executionId"),
          }
        : undefined,
  };
}

function normalizeAws(raw: unknown): KitEvent {
  const record = asRecord(raw);
  if (!record) return invoke("aws", raw);

  const version = stringField(record, "version");
  const requestContext = asRecord(record.requestContext);
  const http = asRecord(requestContext?.http);
  if (version === "2.0" || http) {
    const method = stringField(http, "method") ?? stringField(record, "httpMethod") ?? "GET";
    const path = stringField(record, "rawPath") ?? stringField(record, "path") ?? "/";
    const headers = lowerHeaders(record.headers);
    return {
      type: "http",
      provider: "aws",
      raw,
      headers,
      body: parseMaybeJson(record.body, header(headers, "content-type")),
      http: {
        method: method.toUpperCase(),
        path,
        pathParameters: stringMap(record.pathParameters),
        query: queryMap(record.queryStringParameters),
        sourceIp: stringField(http, "sourceIp"),
        protocol: stringField(http, "protocol"),
      },
    };
  }

  if (typeof record.httpMethod === "string") {
    const headers = lowerHeaders(record.headers);
    return {
      type: "http",
      provider: "aws",
      raw,
      headers,
      body: parseMaybeJson(record.body, header(headers, "content-type")),
      http: {
        method: record.httpMethod.toUpperCase(),
        path: stringField(record, "path") ?? "/",
        pathParameters: stringMap(record.pathParameters),
        query: queryMap(record.queryStringParameters),
        sourceIp: stringField(asRecord(requestContext?.identity), "sourceIp"),
        protocol: stringField(record, "protocol") ?? "http",
      },
    };
  }

  if (Array.isArray(record.Records) && record.Records.length > 0) {
    const first = asRecord(record.Records[0]);
    const source = (stringField(first, "eventSource") ?? stringField(first, "EventSource") ?? "").toLowerCase();
    if (source === "aws:sqs") return queueFromRecords("aws", raw, record.Records, "body", "messageId");
    if (source === "aws:sns") return snsEvent(raw, record.Records);
    if (source === "aws:s3") return s3Event(raw, record.Records);
    if (source === "aws:kinesis" || source === "aws:dynamodb") return streamEvent(raw, record.Records, source);
  }

  if (record.source === "aws.events" || record["detail-type"] === "Scheduled Event") {
    return {
      type: "schedule",
      provider: "aws",
      raw,
      body: record.detail ?? record,
      schedule: {
        time: stringField(record, "time"),
        expression: stringField(asRecord(record.detail), "expression"),
      },
    };
  }

  if (typeof record.source === "string" && (record["detail-type"] || record.detail)) {
    return {
      type: "event",
      provider: "aws",
      raw,
      body: record.detail,
      event: {
        source: stringField(record, "source"),
        detailType: stringField(record, "detail-type"),
        id: stringField(record, "id"),
      },
    };
  }

  return invoke("aws", raw);
}

function normalizeGcp(raw: unknown): KitEvent {
  const record = asRecord(raw);
  if (!record) return invoke("gcp", raw);
  if (record.__skShape === "http") return normalizeHttpShape(raw, "gcp");

  if (record.specversion && (record.type || record.data || record.source)) {
    const typeName = stringField(record, "type") ?? "";
    const data = unwrapPubSub(record.data);
    if (typeName.includes("pubsub") || typeName.includes("messagePublished")) {
      return {
        type: "queue",
        provider: "gcp",
        raw,
        body: data.body,
        records: [
          {
            id: data.messageId,
            body: data.body,
            raw: record.data,
            attributes: data.attributes,
          },
        ],
      };
    }
    if (typeName.includes("storage")) {
      const storage = asRecord(data.body) ?? asRecord(record.data);
      return {
        type: "storage",
        provider: "gcp",
        raw,
        body: storage,
        storage: {
          bucket: stringField(storage, "bucket") ?? "",
          key: stringField(storage, "name") ?? stringField(storage, "key") ?? "",
          eventName: typeName,
          size: typeof storage?.size === "number" ? storage.size : undefined,
        },
      };
    }
    if (typeName.includes("scheduler") || typeName.includes("schedule")) {
      return {
        type: "schedule",
        provider: "gcp",
        raw,
        body: data.body,
        schedule: { time: stringField(record, "time") },
      };
    }
    return {
      type: "event",
      provider: "gcp",
      raw,
      body: data.body,
      event: {
        source: stringField(record, "source"),
        detailType: typeName,
        id: stringField(record, "id"),
      },
    };
  }

  return normalizeHttpShape(raw, "gcp");
}

function normalizeAzure(raw: unknown, binding: NormalizeHints["azureBinding"]): KitEvent {
  const record = asRecord(raw) ?? {};
  if (binding === "timer" || record.__skShape === "timer") {
    const timer = asRecord(record.input) ?? record;
    return {
      type: "schedule",
      provider: "azure",
      raw,
      body: timer,
      schedule: { time: stringField(asRecord(timer.scheduleStatus) ?? timer, "last") },
    };
  }
  if (binding === "queue" || record.__skShape === "queue") {
    const body = parseMaybeJson(record.input ?? record.body ?? raw);
    return {
      type: "queue",
      provider: "azure",
      raw,
      body,
      records: [{ body, raw: record.input ?? raw }],
    };
  }
  if (binding === "serviceBus" || record.__skShape === "serviceBus") {
    const body = parseMaybeJson(record.input ?? record.body ?? raw);
    return {
      type: "topic",
      provider: "azure",
      raw,
      body,
      records: [{ body, raw: record.input ?? raw }],
      topic: { subject: stringField(record, "subject") },
    };
  }
  if (binding === "blob" || record.__skShape === "blob") {
    const blob = asRecord(record.input) ?? record;
    return {
      type: "storage",
      provider: "azure",
      raw,
      body: blob,
      storage: {
        bucket: stringField(record, "container") ?? stringField(blob, "container") ?? "",
        key: stringField(record, "name") ?? stringField(blob, "name") ?? "",
        eventName: "created",
      },
    };
  }
  return normalizeHttpShape(raw, "azure");
}

function normalizeOpenWhisk(raw: unknown, provider: ProviderName): KitEvent {
  const record = asRecord(raw);
  if (!record) return invoke(provider, raw);
  if (typeof record.__ow_method === "string") {
    const headers = lowerHeaders(record.__ow_headers);
    const query = queryMap(record.__ow_query);
    return {
      type: "http",
      provider,
      raw,
      headers,
      body: parseMaybeJson(record.__ow_body, header(headers, "content-type")),
      http: {
        method: record.__ow_method.toUpperCase(),
        path: stringField(record, "__ow_path") ?? "/",
        pathParameters: {},
        query,
      },
    };
  }
  if (record.__skShape === "schedule" || record.sourceType === "scheduler") {
    return {
      type: "schedule",
      provider,
      raw,
      body: record,
      schedule: { expression: stringField(record, "cron"), time: stringField(record, "time") },
    };
  }
  return invoke(provider, raw, record);
}

function normalizeCloudflare(raw: unknown): KitEvent {
  const record = asRecord(raw);
  if (record?.__skShape === "schedule") {
    return {
      type: "schedule",
      provider: "cloudflare",
      raw,
      body: record.body ?? record,
      schedule: { expression: stringField(record, "cron"), time: stringField(record, "time") },
    };
  }
  if (record?.__skShape === "queue") {
    const messages = Array.isArray(record.records) ? record.records : [];
    const kitRecords = messages.map((item) => {
      const message = asRecord(item) ?? {};
      return {
        id: stringField(message, "id"),
        body: parseMaybeJson(message.body),
        raw: item,
      };
    });
    return {
      type: "queue",
      provider: "cloudflare",
      raw,
      body: kitRecords.length === 1 ? kitRecords[0]?.body : kitRecords.map((item) => item.body),
      records: kitRecords,
    };
  }
  return normalizeHttpShape(raw, "cloudflare");
}

function normalizeLambdaCompatible(raw: unknown, provider: ProviderName): KitEvent {
  const record = asRecord(raw);
  if (!record) return invoke(provider, raw);
  if (record.__skShape === "http") return normalizeHttpShape(raw, provider);
  if (typeof record.httpMethod === "string" || asRecord(record.requestContext)?.http) {
    const normalized = normalizeAws(record);
    return { ...normalized, provider };
  }
  if (record.triggerName || record.triggerTime || record.payload === "schedule") {
    return {
      type: "schedule",
      provider,
      raw,
      body: record.payload ?? record,
      schedule: { time: stringField(record, "triggerTime") ?? stringField(record, "time") },
    };
  }
  if (Array.isArray(record.Records)) {
    const awsLike = normalizeAws(raw);
    return { ...awsLike, provider };
  }
  return normalizeHttpShape(raw, provider);
}

function normalizeHttpShape(raw: unknown, provider: ProviderName): KitEvent {
  const record = asRecord(raw);
  if (!record) return invoke(provider, raw);
  const method = stringField(record, "method") ?? stringField(record, "httpMethod");
  if (!method && record.__skShape !== "http") return invoke(provider, raw, record);
  const headers = lowerHeaders(record.headers);
  const path = stringField(record, "path") ?? stringField(record, "rawPath") ?? "/";
  return {
    type: "http",
    provider,
    raw,
    headers,
    body: parseMaybeJson(record.body, header(headers, "content-type")),
    http: {
      method: (method ?? "GET").toUpperCase(),
      path: path.split("?")[0] || "/",
      pathParameters: stringMap(record.pathParameters ?? record.params),
      query: queryMap(record.query ?? record.queryStringParameters),
      sourceIp: stringField(record, "sourceIp"),
      protocol: stringField(record, "protocol") ?? "http",
    },
  };
}

function queueFromRecords(provider: ProviderName, raw: unknown, records: unknown[], bodyKey: string, idKey: string): KitEvent {
  const kitRecords: KitRecord[] = records.map((item) => {
    const record = asRecord(item) ?? {};
    return {
      id: stringField(record, idKey),
      body: parseMaybeJson(record[bodyKey]),
      raw: item,
      attributes: stringMap(record.attributes ?? record.messageAttributes),
    };
  });
  return {
    type: "queue",
    provider,
    raw,
    body: kitRecords.length === 1 ? kitRecords[0].body : kitRecords.map((item) => item.body),
    records: kitRecords,
  };
}

function snsEvent(raw: unknown, records: unknown[]): KitEvent {
  const kitRecords: KitRecord[] = records.map((item) => {
    const record = asRecord(item) ?? {};
    const sns = asRecord(record.Sns) ?? {};
    return {
      id: stringField(sns, "MessageId"),
      body: parseMaybeJson(sns.Message),
      raw: item,
      attributes: stringMap(sns.MessageAttributes),
    };
  });
  const first = asRecord(asRecord(records[0])?.Sns);
  return {
    type: "topic",
    provider: "aws",
    raw,
    body: kitRecords.length === 1 ? kitRecords[0].body : kitRecords.map((item) => item.body),
    records: kitRecords,
    topic: {
      name: stringField(first, "TopicArn"),
      subject: stringField(first, "Subject"),
      messageId: stringField(first, "MessageId"),
    },
  };
}

function s3Event(raw: unknown, records: unknown[]): KitEvent {
  const first = asRecord(records[0]) ?? {};
  const s3 = asRecord(first.s3) ?? {};
  const bucket = asRecord(s3.bucket);
  const object = asRecord(s3.object);
  const key = decodeURIComponent((stringField(object, "key") ?? "").replace(/\+/g, " "));
  return {
    type: "storage",
    provider: "aws",
    raw,
    body: { bucket: stringField(bucket, "name"), key },
    records: records.map((item) => ({ body: item, raw: item })),
    storage: {
      bucket: stringField(bucket, "name") ?? "",
      key,
      eventName: stringField(first, "eventName"),
      size: typeof object?.size === "number" ? object.size : undefined,
    },
  };
}

function streamEvent(raw: unknown, records: unknown[], source: string): KitEvent {
  const kitRecords: KitRecord[] = records.map((item) => {
    const record = asRecord(item) ?? {};
    if (source === "aws:kinesis") {
      const kinesis = asRecord(record.kinesis) ?? {};
      const encoded = stringField(kinesis, "data");
      const body = encoded ? parseMaybeJson(decodeBase64(encoded)) : kinesis;
      return { id: stringField(kinesis, "sequenceNumber"), body, raw: item };
    }
    return { id: stringField(record, "eventID"), body: record.dynamodb ?? record, raw: item };
  });
  return {
    type: "stream",
    provider: "aws",
    raw,
    body: kitRecords.map((item) => item.body),
    records: kitRecords,
  };
}

function unwrapPubSub(data: unknown): { body: unknown; messageId?: string; attributes?: Record<string, string> } {
  const record = asRecord(data);
  const message = asRecord(record?.message) ?? record;
  const encoded = message ? stringField(message, "data") : undefined;
  const body = encoded ? parseMaybeJson(decodeBase64(encoded)) : data;
  return {
    body,
    messageId: message ? stringField(message, "messageId") : undefined,
    attributes: message ? stringMap(message.attributes) : undefined,
  };
}

function stringMap(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") out[key] = item;
    else if (isPlain(item)) {
      const inner = stringField(item, "stringValue") ?? stringField(item, "Value");
      if (inner) out[key] = inner;
    }
  }
  return out;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function invoke(provider: ProviderName, raw: unknown, body?: unknown): KitEvent {
  return {
    type: "invoke",
    provider,
    raw,
    body: body ?? raw,
  };
}
