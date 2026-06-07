#!/usr/bin/env node
import { runRelayDaemonNode } from "./index.js";

const sandboxIndex = process.argv.indexOf("--sandbox-id");
const sandboxId = sandboxIndex >= 0 ? process.argv[sandboxIndex + 1] : undefined;

runRelayDaemonNode({ sandboxId }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
