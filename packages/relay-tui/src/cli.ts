#!/usr/bin/env node
import { loadPackageEnv } from "relay-core";
import { runInteractiveTui } from "./tui.js";

loadPackageEnv("relay-tui");

runInteractiveTui().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
