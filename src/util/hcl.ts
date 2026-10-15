/** Quote a string as an HCL literal. JSON strings are valid HCL strings. */
export function q(value: string): string {
  return JSON.stringify(value);
}

export function hclNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot encode ${value} as an HCL number`);
  }
  return String(value);
}

/** HCL object whose values are already HCL expressions or quoted strings. */
export function hclObject(entries: Record<string, string>, indent = 2): string {
  const pad = " ".repeat(indent);
  const keys = Object.keys(entries);
  if (keys.length === 0) return "{}";
  const lines = keys.map((key) => `${pad}${quoteKey(key)} = ${entries[key]}`);
  return `{\n${lines.join("\n")}\n${" ".repeat(Math.max(0, indent - 2))}}`;
}

export function quoteKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key);
}

export function banner(lines: string[]): string {
  return lines.map((line) => `# ${line}`).join("\n") + "\n";
}

/**
 * Heredoc that lets Terraform interpolate ${...} and leaves $${...} for the guest language.
 * The marker must not appear in the body.
 */
export function heredoc(marker: string, body: string): string {
  if (body.includes(marker)) {
    throw new Error(`Heredoc body contains the marker ${marker}`);
  }
  const trimmed = body.replace(/\s+$/u, "");
  return `<<-${marker}\n${trimmed}\n${marker}`;
}

/** An HCL expression for any JSON value. Objects come back as HCL maps. */
export function hclJson(value: unknown): string {
  return `jsondecode(${q(JSON.stringify(value) ?? "null")})`;
}

export function fileHashExpr(relPosix: string): string {
  return `filebase64sha256("\${path.module}/${relPosix}")`;
}

export function fileFn(relPosix: string): string {
  return `file("\${path.module}/${relPosix}")`;
}
