#!/usr/bin/env node
import { KitError } from "./errors.js";
import { createProgram } from "./cli/program.js";

const program = createProgram();
program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof KitError) {
    console.error(error.message);
    if (process.env.SK_DEBUG && error.stack) console.error(error.stack);
    process.exitCode = 1;
    return;
  }
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
