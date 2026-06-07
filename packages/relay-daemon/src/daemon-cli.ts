#!/usr/bin/env node
import { run } from "./index.js";

run(["daemon", ...process.argv.slice(2)]);
