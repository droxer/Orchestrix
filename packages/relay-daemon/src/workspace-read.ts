import { closeSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import type {
  DaemonNodeEvent,
  DaemonWorkspaceEntry,
  DaemonWorkspaceErrorCode,
  DaemonWorkspaceListCommand,
  DaemonWorkspaceReadCommand,
  DaemonWorkspaceScope,
} from "relay-core";

import { agentWorkspaceSubpath } from "./agent-workspace.js";

const DEFAULT_READ_LIMIT_BYTES = 256 * 1024;

export class WorkspaceReadError extends Error {
  constructor(readonly code: DaemonWorkspaceErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceReadError";
  }
}

function scopeBase(workspaceRoot: string, agentId: string | undefined, scope: DaemonWorkspaceScope): string {
  if (scope === "shared") return resolve(workspaceRoot);
  if (!agentId) {
    throw new WorkspaceReadError("invalid-path", "agentId is required for agent-home workspace reads.");
  }
  return resolve(workspaceRoot, agentWorkspaceSubpath(agentId));
}

function resolveInsideBase(home: string, relativePath: string): { path: string; target: string } {
  const requested = relativePath.trim();
  if (requested.startsWith("/")) {
    throw new WorkspaceReadError("invalid-path", "Path must be relative to the agent workspace.");
  }
  const lexicalTarget = resolve(home, requested);
  if (lexicalTarget !== home && !lexicalTarget.startsWith(home + sep)) {
    throw new WorkspaceReadError("invalid-path", "Path escapes the agent workspace.");
  }
  const path = relativeHomePath(home, lexicalTarget);
  try {
    lstatSync(lexicalTarget);
  } catch {
    return { path, target: lexicalTarget };
  }
  try {
    const realHome = realpathSync(home);
    const realTarget = realpathSync(lexicalTarget);
    if (realTarget !== realHome && !realTarget.startsWith(realHome + sep)) {
      throw new WorkspaceReadError("invalid-path", "Path escapes the agent workspace through a symbolic link.");
    }
    return { path, target: realTarget };
  } catch (error) {
    if (error instanceof WorkspaceReadError) throw error;
    throw new WorkspaceReadError("io-error", error instanceof Error ? error.message : String(error));
  }
}

function relativeHomePath(home: string, target: string): string {
  return target === home ? "" : target.slice(home.length + 1).split(sep).join("/");
}

export function listAgentWorkspace(
  workspaceRoot: string,
  agentId: string | undefined,
  relativePath: string,
  scope: DaemonWorkspaceScope = "agent-home",
): { path: string; exists: boolean; entries: DaemonWorkspaceEntry[] } {
  const { path, target } = resolveInsideBase(scopeBase(workspaceRoot, agentId, scope), relativePath);
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(target);
  } catch {
    return { path, exists: false, entries: [] };
  }
  if (!stats.isDirectory()) throw new WorkspaceReadError("invalid-path", "Listing target is not a directory.");
  const entries: DaemonWorkspaceEntry[] = [];
  for (const name of readdirSync(target)) {
    let info: ReturnType<typeof lstatSync>;
    try {
      info = lstatSync(join(target, name));
    } catch {
      continue;
    }
    if (!info.isDirectory() && !info.isFile()) continue;
    entries.push({
      name,
      path: path ? `${path}/${name}` : name,
      kind: info.isDirectory() ? "directory" : "file",
      bytes: info.isDirectory() ? null : info.size,
      updatedAt: new Date(info.mtimeMs).toISOString(),
    });
  }
  entries.sort((left, right) => left.kind === right.kind
    ? left.name.toLowerCase().localeCompare(right.name.toLowerCase())
    : left.kind === "directory" ? -1 : 1);
  return { path, exists: true, entries };
}

export function readAgentWorkspaceFile(
  workspaceRoot: string,
  agentId: string | undefined,
  relativePath: string,
  limitBytes = DEFAULT_READ_LIMIT_BYTES,
  scope: DaemonWorkspaceScope = "agent-home",
): { path: string; bytes: number; isBinary: boolean; truncated: boolean; contentBase64?: string } {
  const { path, target } = resolveInsideBase(scopeBase(workspaceRoot, agentId, scope), relativePath);
  let info: ReturnType<typeof lstatSync>;
  try {
    info = lstatSync(target);
  } catch {
    throw new WorkspaceReadError("not-found", "Workspace file was not found.");
  }
  if (info.isDirectory()) throw new WorkspaceReadError("is-directory", "Workspace path is a directory.");
  if (!info.isFile()) throw new WorkspaceReadError("not-found", "Workspace path is not a regular file.");
  let raw: Buffer;
  let bytes: number;
  try {
    bytes = statSync(target).size;
    const handle = openSync(target, "r");
    try {
      raw = Buffer.alloc(Math.min(bytes, limitBytes));
      raw = raw.subarray(0, readSync(handle, raw, 0, raw.length, 0));
    } finally {
      closeSync(handle);
    }
  } catch (error) {
    throw new WorkspaceReadError("io-error", error instanceof Error ? error.message : String(error));
  }
  const isBinary = raw.includes(0) || raw.toString("utf-8").includes("�");
  return {
    path,
    bytes,
    isBinary,
    truncated: bytes > limitBytes,
    ...(isBinary ? {} : { contentBase64: raw.toString("base64") }),
  };
}

type WorkspaceCommand = DaemonWorkspaceListCommand | DaemonWorkspaceReadCommand;
type WorkspaceCommandEvent = Extract<DaemonNodeEvent, {
  type: "workspace.listing" | "workspace.file" | "workspace.error";
}>;

export function workspaceCommandEvent(
  workspaceRoot: string,
  command: WorkspaceCommand,
): WorkspaceCommandEvent {
  const scope = command.scope ?? "agent-home";
  const identity = command.agentId ? { agentId: command.agentId } : {};
  try {
    if (command.type === "workspace.list") {
      const listing = listAgentWorkspace(workspaceRoot, command.agentId, command.path, scope);
      return {
        type: "workspace.listing",
        commandId: command.id,
        ...(command.leaseId ? { leaseId: command.leaseId } : {}),
        ...identity,
        path: listing.path,
        exists: listing.exists,
        entries: listing.entries,
      };
    }
    const file = readAgentWorkspaceFile(workspaceRoot, command.agentId, command.path, undefined, scope);
    return {
      type: "workspace.file",
      commandId: command.id,
      ...(command.leaseId ? { leaseId: command.leaseId } : {}),
      ...identity,
      path: file.path,
      bytes: file.bytes,
      isBinary: file.isBinary,
      truncated: file.truncated,
      ...(file.contentBase64 === undefined ? {} : { contentBase64: file.contentBase64 }),
    };
  } catch (error) {
    return {
      type: "workspace.error",
      commandId: command.id,
      ...(command.leaseId ? { leaseId: command.leaseId } : {}),
      ...identity,
      path: command.path,
      code: error instanceof WorkspaceReadError ? error.code : "io-error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
