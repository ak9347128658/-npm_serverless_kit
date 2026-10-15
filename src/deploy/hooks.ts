import path from "node:path";
import { pathToFileURL } from "node:url";
import { KitError } from "../errors.js";
import type { HookConfig, KitConfig } from "../types.js";

export type HookName = keyof HookConfig;

export async function runHook(dir: string, config: KitConfig, name: HookName, context: unknown): Promise<void> {
  const rel = config.hooks[name];
  if (!rel) return;
  const file = path.resolve(dir, rel);
  let loaded: Record<string, unknown>;
  try {
    loaded = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new KitError(`Hook ${name} failed to load ${file}: ${message}`);
  }
  const fn = loaded[name] ?? loaded.default;
  if (typeof fn !== "function") {
    throw new KitError(`Hook ${name} in ${file} needs a function export named "${name}" or a default export.`);
  }
  await fn(context);
}
