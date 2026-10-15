export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

export function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

export function bytesToString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return undefined;
}

export function decodeBase64(value: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(value, "base64").toString("utf8");
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function parseMaybeJson(value: unknown, contentType?: string): unknown {
  if (value == null) return undefined;
  if (typeof value === "object" && !(typeof Buffer !== "undefined" && Buffer.isBuffer(value)) && !(value instanceof Uint8Array)) {
    return value;
  }
  const text = bytesToString(value);
  if (text == null) return value;
  const type = contentType?.toLowerCase() ?? "";
  if (type.includes("json") || looksLikeJson(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

export function lowerHeaders(headers: unknown): Record<string, string> | undefined {
  if (!isRecord(headers)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") out[key.toLowerCase()] = value;
    else if (Array.isArray(value) && typeof value[0] === "string") out[key.toLowerCase()] = value.join(",");
    else if (typeof value === "number" || typeof value === "boolean") out[key.toLowerCase()] = String(value);
  }
  return out;
}

export function queryMap(input: unknown): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!isRecord(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.map((item) => String(item));
    else if (value != null) out[key] = String(value);
  }
  return out;
}

export function header(headers: Record<string, string> | undefined, name: string): string | undefined {
  return headers?.[name.toLowerCase()];
}
