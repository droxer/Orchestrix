#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadPackageEnv } from "relay-core";
import { resolveSandboxMode, runRelayDaemon, runRelayDaemonDoctor } from "./index.js";

loadPackageEnv("relay-daemon");

function showHelp(): void {
  console.log(`relay-daemon [options]

Options:
  --backend-url <url>   Relay backend URL (also RELAY_BACKEND_URL).
  --sandbox-id <id>     Sandbox identifier (required; also RELAY_SANDBOX_ID).
  --employee-id <id>    Employee identifier (also RELAY_EMPLOYEE_ID).
  --token <token>       Daemon node token (also RELAY_DAEMON_NODE_TOKEN).
  --sandbox <mode>      Sandbox mode: "boxlite" boots a BoxLite VM and runs
                        agents inside it; "none" runs agents as local
                        processes (default; also RELAY_SANDBOX_MODE).
  --doctor              Check backend, token, workspace, auth, and agent CLIs,
                        then exit without running the daemon loop.
  --help                Show this help message.
  --version             Show version information.
`);
}

function showVersion(): void {
  console.log("relay-daemon 0.1.0");
}

export interface DaemonCliArgs {
  backendUrl?: string;
  sandboxId?: string;
  employeeId?: string;
  token?: string;
  sandbox?: string;
  doctor: boolean;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): DaemonCliArgs {
  let backendUrl: string | undefined;
  let sandboxId: string | undefined;
  let employeeId: string | undefined;
  let token: string | undefined;
  let sandbox: string | undefined;
  let doctor = false;
  let help = false;
  let version = false;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help") {
      help = true;
    } else if (arg === "--version") {
      version = true;
    } else if (arg === "--doctor") {
      doctor = true;
    } else if (arg === "--backend-url") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--backend-url requires a value.");
      }
      backendUrl = value;
      i += 1;
    } else if (arg === "--sandbox-id") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--sandbox-id requires a value.");
      }
      sandboxId = value;
      i += 1;
    } else if (arg === "--employee-id") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--employee-id requires a value.");
      }
      employeeId = value;
      i += 1;
    } else if (arg === "--token") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--token requires a value.");
      }
      token = value;
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
  return { backendUrl, sandboxId, employeeId, token, sandbox, doctor, help, version };
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const args = parseArgs(argv);

  if (args.help) {
    showHelp();
    return;
  }

  if (args.version) {
    showVersion();
    return;
  }

  const sandboxId = args.sandboxId ?? process.env.RELAY_SANDBOX_ID;
  if (!sandboxId) {
    console.error("Error: --sandbox-id or RELAY_SANDBOX_ID is required.");
    showHelp();
    process.exitCode = 1;
    return;
  }
  if (args.doctor) {
    const report = await runRelayDaemonDoctor({
      backendUrl: args.backendUrl ?? process.env.RELAY_BACKEND_URL,
      sandboxId,
      employeeId: args.employeeId ?? process.env.RELAY_EMPLOYEE_ID,
      token: args.token ?? process.env.RELAY_DAEMON_NODE_TOKEN ?? process.env.RELAY_DAEMON_TOKEN,
      sandbox: resolveSandboxMode(args.sandbox ?? process.env.RELAY_SANDBOX_MODE),
    });
    for (const check of report.checks) {
      console.log(`${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.detail}`);
    }
    if (!report.ok) process.exitCode = 1;
    return;
  }
  await runRelayDaemon({
    backendUrl: args.backendUrl ?? process.env.RELAY_BACKEND_URL,
    sandboxId,
    employeeId: args.employeeId ?? process.env.RELAY_EMPLOYEE_ID,
    token: args.token ?? process.env.RELAY_DAEMON_NODE_TOKEN ?? process.env.RELAY_DAEMON_TOKEN,
    sandbox: resolveSandboxMode(args.sandbox ?? process.env.RELAY_SANDBOX_MODE),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
