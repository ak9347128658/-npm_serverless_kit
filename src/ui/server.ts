import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { DeploymentModel } from "../types.js";
import { renderDashboard } from "./render.js";

export function writeDashboard(file: string, model: DeploymentModel): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderDashboard(model), "utf8");
  return file;
}

export function startDashboard(file: string, port: number): Promise<{ url: string; close: () => Promise<void> }> {
  const html = fs.readFileSync(file);
  const server = http.createServer((req, res) => {
    const url = req.url?.split("?")[0] ?? "/";
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const chosen = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${chosen}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
