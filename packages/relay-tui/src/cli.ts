#!/usr/bin/env node
import { runInteractiveTui } from "./tui.js";

runInteractiveTui().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
