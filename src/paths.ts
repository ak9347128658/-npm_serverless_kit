import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KitError } from "./errors.js";

export function packageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

export function inSourceTree(): boolean {
  const urlPath = fileURLToPath(import.meta.url);
  const srcRoot = path.join(packageRoot(), "src") + path.sep;
  return urlPath.startsWith(srcRoot);
}

/** Absolute path of a runtime module, TypeScript while developing and JavaScript from dist. */
export function runtimeModule(base: string): string {
  const root = packageRoot();
  const file = inSourceTree()
    ? path.join(root, "src", "runtime", `${base}.ts`)
    : path.join(root, "dist", "runtime", `${base}.js`);
  if (!fs.existsSync(file)) {
    throw new KitError(
      `Cannot find the serverless-kit runtime module "${base}" at ${file}. Build the package with npm run build, or run the CLI from a checkout.`,
    );
  }
  return file;
}

export function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export const ARTIFACTS = {
  zip(physicalName: string): string {
    return `../build/zips/${physicalName}.zip`;
  },
  worker(physicalName: string): string {
    return `../build/workers/${physicalName}.mjs`;
  },
  azureZip: "../build/azure-site.zip",
  oracleDir(physicalName: string): string {
    return `../build/oracle/${physicalName}`;
  },
  digitaloceanDir: "../build/digitalocean",
  ibmZip(physicalName: string): string {
    return `../build/zips/${physicalName}.zip`;
  },
} as const;
