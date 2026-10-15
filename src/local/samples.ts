import type { KitEventType, ProviderName } from "../types.js";

export function sampleEvent(provider: ProviderName, type: KitEventType, payload: unknown, request?: { method?: string; path?: string; headers?: Record<string, string> }): unknown {
  const method = request?.method ?? "POST";
  const path = request?.path ?? "/";
  const headers = { "content-type": "application/json", ...(request?.headers ?? {}) };
  const body = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  if (type === "http") {
    if (provider === "aws") {
      return {
        version: "2.0",
        rawPath: path,
        headers,
        body,
        requestContext: { http: { method, path, sourceIp: "127.0.0.1" } },
        pathParameters: pathParams(path),
        queryStringParameters: {},
      };
    }
    return { __skShape: "http", method, path, headers, body, pathParameters: pathParams(path), query: {} };
  }
  if (type === "schedule") {
    if (provider === "cloudflare") return { __skShape: "schedule", cron: "* * * * *", time: new Date().toISOString(), body: payload };
    return { source: "aws.events", "detail-type": "Scheduled Event", time: new Date().toISOString(), detail: payload ?? {} };
  }
  if (type === "queue") {
    if (provider === "cloudflare") return { __skShape: "queue", records: [{ id: "local-1", body: payload }] };
    return { Records: [{ eventSource: "aws:sqs", messageId: "local-1", body: typeof payload === "string" ? payload : JSON.stringify(payload ?? {}) }] };
  }
  if (type === "topic") {
    return {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: { Message: typeof payload === "string" ? payload : JSON.stringify(payload ?? {}), MessageId: "local-1", Subject: "local", TopicArn: "local" },
        },
      ],
    };
  }
  if (type === "storage") {
    const record = payload && typeof payload === "object" ? (payload as { bucket?: string; key?: string }) : {};
    return {
      Records: [
        {
          eventSource: "aws:s3",
          eventName: "ObjectCreated:Put",
          s3: { bucket: { name: record.bucket ?? "bucket" }, object: { key: record.key ?? "file.json" } },
        },
      ],
    };
  }
  if (type === "event") {
    return { source: "app.local", "detail-type": "Event", id: "local-1", detail: payload ?? {} };
  }
  if (type === "stream") {
    return { Records: [{ eventSource: "aws:kinesis", kinesis: { data: Buffer.from(JSON.stringify(payload ?? {})).toString("base64"), sequenceNumber: "1" } }] };
  }
  if (type === "workflow") {
    const record = payload && typeof payload === "object" ? (payload as { workflow?: string; step?: string; input?: unknown }) : {};
    return { __sk: { type: "workflow", workflow: record.workflow ?? "workflow", step: record.step ?? "task" }, input: record.input ?? payload };
  }
  return payload ?? {};
}

function pathParams(path: string): Record<string, string> {
  const params: Record<string, string> = {};
  const bits = path.split("/").filter(Boolean);
  if (bits.length > 0) params.id = bits[bits.length - 1];
  return params;
}
