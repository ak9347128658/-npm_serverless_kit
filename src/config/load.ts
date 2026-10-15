import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { ConfigError } from "../errors.js";
import type { KitConfig } from "../types.js";
import { parseConfig, type CliOverlay } from "./schema.js";

const FILE_NAMES = ["serverless-kit.yml", "serverless-kit.yaml", "sk.yml", "sk.yaml"];

export interface LoadedConfig {
  config: KitConfig;
  file: string;
  dir: string;
}

export function findConfigFile(cwd: string, explicit?: string): string {
  if (explicit) {
    const file = path.resolve(cwd, explicit);
    if (!fs.existsSync(file)) {
      throw new ConfigError(`Config file not found: ${file}`);
    }
    return file;
  }
  for (const name of FILE_NAMES) {
    const file = path.join(cwd, name);
    if (fs.existsSync(file)) return file;
  }
  throw new ConfigError(
    `No serverless-kit config in ${cwd}. Looked for ${FILE_NAMES.join(", ")}. Create one with \`sk init\`.`,
  );
}

export function loadConfig(cwd: string, overlay: CliOverlay = {}, explicit?: string): LoadedConfig {
  const file = findConfigFile(cwd, explicit);
  return loadConfigFile(file, overlay);
}

export function loadConfigFile(file: string, overlay: CliOverlay = {}): LoadedConfig {
  const text = fs.readFileSync(file, "utf8");
  let raw: unknown;
  try {
    raw = yaml.load(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Could not parse YAML in ${file}: ${message}`);
  }
  if (!raw || typeof raw !== "object") {
    throw new ConfigError(`${file} must be a YAML object.`);
  }
  const config = parseConfig(raw, overlay);
  return { config, file, dir: path.dirname(file) };
}
