import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type DaemonNodeTokenSource = "explicit" | "file" | "generated";

export interface DaemonNodeTokenResolution {
  token: string;
  source: DaemonNodeTokenSource;
  path?: string;
}

export interface EnsureDaemonNodeTokenInput {
  credentialDirectory: string;
  /** Previous releases persisted the credential under the mounted workspace. */
  legacyWorkspacePath?: string;
  employeeId: string;
  token?: string;
}

export function daemonNodeTokenPath(credentialDirectory: string, employeeId: string): string {
  return join(credentialDirectory, `${safeTokenFileName(employeeId)}.token`);
}

export function readDaemonNodeToken(credentialDirectory: string, employeeId: string): string | undefined {
  const path = daemonNodeTokenPath(credentialDirectory, employeeId);
  try {
    const token = readFileSync(path, "utf8").trim();
    return token || undefined;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function writeDaemonNodeToken(credentialDirectory: string, employeeId: string, token: string): string {
  const path = daemonNodeTokenPath(credentialDirectory, employeeId);
  mkdirSync(credentialDirectory, { recursive: true, mode: 0o700 });
  chmodSync(credentialDirectory, 0o700);
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
    writeDaemonNodeToken(input.credentialDirectory, input.employeeId, explicit);
    removeLegacyToken(input);
    return { token: explicit, source: "explicit" };
  }

  const path = daemonNodeTokenPath(input.credentialDirectory, input.employeeId);
  const existing = readDaemonNodeToken(input.credentialDirectory, input.employeeId);
  if (existing) {
    return { token: existing, source: "file", path };
  }

  const legacy = readLegacyToken(input);
  if (legacy) {
    writeDaemonNodeToken(input.credentialDirectory, input.employeeId, legacy);
    removeLegacyToken(input);
    return { token: legacy, source: "file", path };
  }

  const generated = newDaemonNodeToken();
  writeDaemonNodeToken(input.credentialDirectory, input.employeeId, generated);
  return { token: generated, source: "generated", path };
}

function legacyTokenPath(input: EnsureDaemonNodeTokenInput): string | undefined {
  return input.legacyWorkspacePath
    ? join(input.legacyWorkspacePath, ".relay", "daemon-nodes", `${safeTokenFileName(input.employeeId)}.token`)
    : undefined;
}

function readLegacyToken(input: EnsureDaemonNodeTokenInput): string | undefined {
  const path = legacyTokenPath(input);
  if (!path) return undefined;
  try {
    return readFileSync(path, "utf8").trim() || undefined;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function removeLegacyToken(input: EnsureDaemonNodeTokenInput): void {
  const path = legacyTokenPath(input);
  if (!path) return;
  try {
    unlinkSync(path);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

function safeTokenFileName(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  return safe || "local";
}
