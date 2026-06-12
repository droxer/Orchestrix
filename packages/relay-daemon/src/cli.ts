#!/usr/bin/env node
import { resolveSandboxMode, runRelayDaemon } from "./index.js";

function showHelp(): void {
  console.log(`relay-daemon [options]

Options:
  --sandbox-id <id>     Sandbox identifier (required; also RELAY_SANDBOX_ID).
  --sandbox <mode>      Sandbox mode: "boxlite" boots a BoxLite VM and runs
                        agents inside it; "none" runs agents as local
                        processes (default; also RELAY_SANDBOX_MODE).
  --help                Show this help message.
  --version             Show version information.
`);
}

function showVersion(): void {
  console.log("relay-daemon 0.1.0");
}

function parseArgs(argv: string[]): { sandboxId?: string; sandbox?: string; help: boolean; version: boolean } {
  let sandboxId: string | undefined;
  let sandbox: string | undefined;
  let help = false;
  let version = false;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      help = true;
    } else if (arg === "--version") {
      version = true;
    } else if (arg === "--sandbox-id") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--sandbox-id requires a value.");
      }
      sandboxId = value;
      i += 1;
    } else if (arg === "--sandbox") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--sandbox requires a value (boxlite or none).");
      }
      sandbox = value;
      i += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { sandboxId, sandbox, help, version };
}

const args = parseArgs(process.argv);

if (args.help) {
  showHelp();
  process.exit(0);
}

if (args.version) {
  showVersion();
  process.exit(0);
}

const sandboxId = args.sandboxId ?? process.env.RELAY_SANDBOX_ID;
if (!sandboxId) {
  console.error("Error: --sandbox-id or RELAY_SANDBOX_ID is required.");
  showHelp();
  process.exitCode = 1;
} else {
  runRelayDaemon({
    sandboxId,
    sandbox: resolveSandboxMode(args.sandbox ?? process.env.RELAY_SANDBOX_MODE),
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
