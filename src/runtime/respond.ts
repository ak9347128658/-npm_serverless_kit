import type { KitEvent, KitResult } from "../types.js";

export function normalizeResult(value: unknown): KitResult {
  if (value == null) return { statusCode: 200, body: null };
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const looksLikeResult =
      "statusCode" in record || "headers" in record || "batchItemFailures" in record || "body" in record;
    if (looksLikeResult && ("statusCode" in record || "batchItemFailures" in record || "headers" in record)) {
      return {
        statusCode: typeof record.statusCode === "number" ? record.statusCode : 200,
        headers: isStringRecord(record.headers) ? record.headers : undefined,
        body: "body" in record ? record.body : null,
        batchItemFailures: Array.isArray(record.batchItemFailures)
          ? record.batchItemFailures.flatMap((item) => {
              const id = item && typeof item === "object" ? (item as { itemIdentifier?: unknown }).itemIdentifier : undefined;
              return typeof id === "string" ? [{ itemIdentifier: id }] : [];
            })
          : undefined,
      };
    }
  }
  return { statusCode: 200, body: value };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === "string");
}

export function bodyText(result: KitResult): string {
  if (result.body == null) return "";
  if (typeof result.body === "string") return result.body;
  return JSON.stringify(result.body);
}

export function resultHeaders(result: KitResult): Record<string, string> {
  const headers: Record<string, string> = { ...(result.headers ?? {}) };
  const hasType = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
  if (!hasType && result.body != null && typeof result.body !== "string") {
    headers["content-type"] = "application/json; charset=utf-8";
  }
  return headers;
}

/** Response object returned to a Lambda-compatible runtime. */
export function toLambdaResponse(transport: KitEvent["type"], event: KitEvent, result: KitResult): unknown {
  if (result.batchItemFailures && (event.type === "queue" || event.type === "stream")) {
    return { batchItemFailures: result.batchItemFailures };
  }
  if (transport === "http" || event.type === "http") {
    return {
      statusCode: result.statusCode ?? 200,
      headers: resultHeaders(result),
      body: bodyText(result),
      isBase64Encoded: false,
    };
  }
  if (event.type === "workflow") {
    return { statusCode: result.statusCode ?? 200, body: result.body ?? null };
  }
  if (event.type === "invoke" || event.type === "queue" || event.type === "topic" || event.type === "event" || event.type === "schedule" || event.type === "storage" || event.type === "stream") {
    return result.body ?? { statusCode: result.statusCode ?? 200 };
  }
  return {
    statusCode: result.statusCode ?? 200,
    headers: resultHeaders(result),
    body: bodyText(result),
    isBase64Encoded: false,
  };
}

export function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}
