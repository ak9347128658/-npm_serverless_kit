import fs from "node:fs";
import path from "node:path";
import type { KitConfig, PlanResult } from "../types.js";
import { renderAws } from "./providers/aws.js";
import { renderAzure } from "./providers/azure.js";
import { renderGcp } from "./providers/gcp.js";
import {
  renderAlibaba,
  renderCloudflare,
  renderDigitalOcean,
  renderHuawei,
  renderIbm,
  renderOracle,
  renderTencent,
} from "./providers/others.js";
import { backendFile, type RenderContext } from "./support.js";

export function renderTerraform(config: KitConfig, plan: PlanResult, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const ctx: RenderContext = { config, plan, platform };
  const files = renderProvider(ctx);
  const backend = backendFile(config);
  if (backend) files["backend.tf"] = backend;
  return files;
}

export function writeTerraform(dir: string, files: Record<string, string>): void {
  fs.mkdirSync(dir, { recursive: true });
  const keep = new Set(["terraform.tfstate", "terraform.tfstate.backup", ".terraform", ".terraform.lock.hcl"]);
  for (const entry of fs.readdirSync(dir)) {
    if (keep.has(entry) || entry.endsWith(".tfstate") || entry.endsWith(".tfstate.backup")) continue;
    if (entry.endsWith(".tf")) fs.rmSync(path.join(dir, entry));
  }
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), contents, "utf8");
  }
}

function renderProvider(ctx: RenderContext): Record<string, string> {
  switch (ctx.config.provider.name) {
    case "aws":
      return renderAws(ctx);
    case "gcp":
      return renderGcp(ctx);
    case "azure":
      return renderAzure(ctx);
    case "cloudflare":
      return renderCloudflare(ctx);
    case "alibaba":
      return renderAlibaba(ctx);
    case "ibm":
      return renderIbm(ctx);
    case "oracle":
      return renderOracle(ctx);
    case "tencent":
      return renderTencent(ctx);
    case "huawei":
      return renderHuawei(ctx);
    case "digitalocean":
      return renderDigitalOcean(ctx);
    default: {
      const _never: never = ctx.config.provider.name;
      return _never;
    }
  }
}
