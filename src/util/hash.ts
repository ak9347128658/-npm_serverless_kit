import { createHash } from "node:crypto";

export function shortHash(value: string, length = 6): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function cloudName(parts: string[], max = 63): string {
  const raw = parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const base = raw.length > 0 ? raw : "fn";
  if (base.length <= max) return base;
  const hash = shortHash(base);
  const keep = Math.max(1, max - hash.length - 1);
  return `${base.slice(0, keep).replace(/-$/g, "")}-${hash}`;
}

export function tfIdent(prefix: string, name: string): string {
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  let id = `${prefix}_${clean || "fn"}`;
  if (/^[0-9]/.test(id)) id = `r_${id}`;
  return id;
}

export function storageAccountName(service: string, stage: string): string {
  const hash = shortHash(`${service}:${stage}`, 8);
  const base = `${service}${stage}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${base.slice(0, 16)}${hash}`.slice(0, 24);
}

export function bucketName(service: string, stage: string, purpose: string): string {
  return cloudName(["sk", service, stage, purpose, shortHash(`${service}:${stage}:${purpose}`)], 63);
}

/** Azure Storage queue and blob container names: 3-63 lowercase letters, numbers, and hyphens. */
export function azureResourceName(name: string, fallback: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const base = cleaned.length >= 3 ? cleaned : `${fallback}-${cleaned || "item"}`;
  return base.slice(0, 63).replace(/-$/g, "");
}
