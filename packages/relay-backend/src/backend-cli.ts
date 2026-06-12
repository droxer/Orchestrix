#!/usr/bin/env node
import { run } from "./index.js";

run(["backend", ...process.argv.slice(2)]);
