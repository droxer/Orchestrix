import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type DaemonNodeTokenSource = "explicit" | "file" | "generated";

export interface DaemonNodeTokenResolution {
  token: string;
  source: DaemonNodeTokenSource;
  path?: string;
}

export interface EnsureDaemonNodeTokenInput {
  workspacePath: string;
  employeeId: string;
  token?: string;
}

export function daemonNodeTokenPath(workspacePath: string, employeeId: string): string {
  return join(workspacePath, ".relay", "daemon-nodes", `${safeTokenFileName(employeeId)}.token`);
}

export function readDaemonNodeToken(workspacePath: string, employeeId: string): string | undefined {
  const path = daemonNodeTokenPath(workspacePath, employeeId);
  try {
    const token = readFileSync(path, "utf8").trim();
    return token || undefined;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function writeDaemonNodeToken(workspacePath: string, employeeId: string, token: string): string {
  const path = daemonNodeTokenPath(workspacePath, employeeId);
  mkdirSync(join(workspacePath, ".relay", "daemon-nodes"), { recursive: true });
  writeFileSync(path, `${token.trim()}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function newDaemonNodeToken(): string {
  return `tok_${randomBytes(24).toString("base64url")}`;
}

export function ensureDaemonNodeToken(input: EnsureDaemonNodeTokenInput): DaemonNodeTokenResolution {
  const explicit = input.token?.trim();
  if (explicit) {
    writeDaemonNodeToken(input.workspacePath, input.employeeId, explicit);
    return { token: explicit, source: "explicit" };
  }

  const path = daemonNodeTokenPath(input.workspacePath, input.employeeId);
  const existing = readDaemonNodeToken(input.workspacePath, input.employeeId);
  if (existing) {
    return { token: existing, source: "file", path };
  }

  const generated = newDaemonNodeToken();
  writeDaemonNodeToken(input.workspacePath, input.employeeId, generated);
  return { token: generated, source: "generated", path };
}

function safeTokenFileName(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  return safe || "local";
}
