import assert from "node:assert/strict";
import { test } from "node:test";
import { zipStore } from "../src/util/zip.js";

test("zip archives start with the PK header and round-trip a file name", () => {
  const archive = zipStore([{ name: "index.js", data: Buffer.from("exports.handler = () => 1;\n") }]);
  assert.equal(archive.subarray(0, 2).toString("latin1"), "PK");
  assert.ok(archive.includes(Buffer.from("index.js")));
});
