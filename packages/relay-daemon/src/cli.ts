#!/usr/bin/env node
import { homedir } from "node:os";
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
  --workspace <path>    Host workspace to expose to local agent CLIs
                        (also RELAY_WORKSPACE or WORKSPACE).
  --sandbox <mode>      Sandbox mode: "boxlite" boots a BoxLite VM and runs
                        agents inside it; "none" runs agents as local
                        processes (default; also RELAY_SANDBOX_MODE).
  --use-local-agent-home
                        In local mode, use this user's HOME for Claude/Codex/
                        Kimi auth and config instead of Relay's isolated home.
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
  workspace?: string;
  sandbox?: string;
  useLocalAgentHome: boolean;
  doctor: boolean;
  help: boolean;
  version: boolean;
}

export function parseArgs(argv: string[]): DaemonCliArgs {
  let backendUrl: string | undefined;
  let sandboxId: string | undefined;
  let employeeId: string | undefined;
  let token: string | undefined;
  let workspace: string | undefined;
  let sandbox: string | undefined;
  let useLocalAgentHome = false;
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
    } else if (arg === "--use-local-agent-home") {
      useLocalAgentHome = true;
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
    } else if (arg === "--workspace") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--workspace requires a value.");
      }
      workspace = value;
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
  return { backendUrl, sandboxId, employeeId, token, workspace, sandbox, useLocalAgentHome, doctor, help, version };
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
      workspacePath: args.workspace ?? process.env.RELAY_WORKSPACE ?? process.env.WORKSPACE,
      sandbox: resolveSandboxMode(args.sandbox ?? process.env.RELAY_SANDBOX_MODE),
      agentHome: args.useLocalAgentHome ? homedir() : undefined,
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
    workspacePath: args.workspace ?? process.env.RELAY_WORKSPACE ?? process.env.WORKSPACE,
    sandbox: resolveSandboxMode(args.sandbox ?? process.env.RELAY_SANDBOX_MODE),
    agentHome: args.useLocalAgentHome ? homedir() : undefined,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
