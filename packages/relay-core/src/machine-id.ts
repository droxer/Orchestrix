import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

export type MachineIdSource = "explicit" | "file" | "generated" | "fallback";

export interface MachineIdResolution {
  /** Stable identifier for the physical host, used as the daemon's workspaceId. */
  machineId: string;
  source: MachineIdSource;
  path?: string;
}

/**
 * Where the persisted per-host machine id lives. Deliberately keyed to the
 * host home directory — NOT the workspace — so it stays constant when the same
 * computer relaunches the daemon from a different working directory. A daemon
 * that changes directories must still resolve to one computer, otherwise every
 * relaunch mints a fresh compatibility agent and the roster fills with
 * duplicates.
 */
export function machineIdPath(home: string = homedir()): string {
  return join(home, ".relay", "machine-id");
}

export function readMachineId(home: string = homedir()): string | undefined {
  try {
    const value = readFileSync(machineIdPath(home), "utf8").trim();
    return value || undefined;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export function newMachineId(): string {
  return `mch_${randomBytes(16).toString("base64url")}`;
}

/**
 * Resolve a stable identity for this host, preferring an explicit value, then a
 * persisted id, then a freshly generated + persisted one. If the home directory
 * cannot be written, fall back to a deterministic hostname-derived id so two
 * runs on the same host still collapse to one computer within a session.
 */
export function ensureMachineId(explicit?: string, home: string = homedir()): MachineIdResolution {
  const provided = explicit?.trim();
  if (provided) {
    return { machineId: provided, source: "explicit" };
  }

  const path = machineIdPath(home);
  try {
    const existing = readMachineId(home);
    if (existing) {
      return { machineId: existing, source: "file", path };
    }
    const generated = newMachineId();
    mkdirSync(join(home, ".relay"), { recursive: true });
    writeFileSync(path, `${generated}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
    return { machineId: generated, source: "generated", path };
  } catch {
    return { machineId: `host_${sanitizeHostname(hostname())}`, source: "fallback" };
  }
}

function sanitizeHostname(value: string): string {
  const safe = value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  return safe || "local";
}
