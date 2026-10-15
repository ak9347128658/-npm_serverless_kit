import { spawn } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCommand(command: string, args: string[], cwd: string, echo = true): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (echo) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (echo) process.stderr.write(chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error(`Could not run "${command}". Install it and make sure it is on PATH.`));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    const result = await runCommand(command, ["version"], process.cwd(), false);
    return result.code === 0 || result.stdout.length > 0 || result.stderr.length > 0;
  } catch {
    return false;
  }
}
