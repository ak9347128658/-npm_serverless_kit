import fs from "node:fs";
import path from "node:path";
import { KitError } from "../errors.js";

export function initProject(dir: string, service = "hello"): void {
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const yml = path.join(dir, "serverless-kit.yml");
  if (fs.existsSync(yml)) throw new KitError(`${yml} already exists.`);
  fs.writeFileSync(
    yml,
    `service: ${service}
framework: serverless-kit

provider:
  name: aws
  runtime: nodejs20
  region: us-east-1
  stage: dev
  memory: 256
  timeout: 10

functions:
  hello:
    handler: src/handler.handler
    description: HTTP hello
    events:
      - http:
          path: /hello
          method: get
          cors: true
`,
  );
  fs.writeFileSync(
    path.join(dir, "src", "handler.js"),
    `exports.handler = async function handler(event) {
  return {
    statusCode: 200,
    body: {
      message: "hello from serverless-kit",
      provider: event.provider,
      type: event.type,
      path: event.http && event.http.path,
    },
  };
};
`,
  );
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) {
    fs.writeFileSync(ignore, "node_modules/\n.serverless-kit/\n");
  }
}
