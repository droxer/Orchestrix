import { accessSync, constants, lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { posix, resolve, sep } from "node:path";

import { GUEST_WORKSPACE, type DaemonNodeSandboxMode } from "relay-core";

export interface ThreadWorkspace {
  sessionId: string;
  /** Directory on the computer that owns the daemon. */
  hostPath: string;
  /** Directory passed to the agent CLI (host path locally, guest path in BoxLite). */
  executionPath: string;
}

const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/**
 * Owns the mapping from a Relay thread identity to an isolated directory below
 * the workspace root configured for this computer. The backend and agents only
 * need the returned workspace; path validation and host/guest translation stay
 * local to the execution plane.
 */
export class ThreadWorkspaceManager {
  readonly rootPath: string;

  constructor(
    rootPath: string,
    private readonly sandboxMode: DaemonNodeSandboxMode,
  ) {
    this.rootPath = resolve(rootPath);
    assertWorkspaceRoot(this.rootPath);
  }

  resolve(sessionId: string): ThreadWorkspace {
    validateThreadId(sessionId);
    const hostPath = resolve(this.rootPath, sessionId);
    if (!hostPath.startsWith(this.rootPath + sep)) {
      throw new Error(`Invalid thread id ${JSON.stringify(sessionId)}.`);
    }

    rejectSymbolicLink(hostPath);
    const realRoot = realpathSync(this.rootPath);
    try {
      const realThread = realpathSync(hostPath);
      if (realThread !== realRoot && !realThread.startsWith(realRoot + sep)) {
        throw new Error(`Thread workspace escapes the configured root: ${sessionId}.`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    return {
      sessionId,
      hostPath,
      executionPath: this.sandboxMode === "boxlite"
        ? posix.join(GUEST_WORKSPACE, sessionId)
        : hostPath,
    };
  }

  ensure(sessionId: string): ThreadWorkspace {
    const workspace = this.resolve(sessionId);
    mkdirSync(workspace.hostPath, { recursive: true });
    // Re-resolve after creation so an existing file, symbolic link, or path
    // replaced during creation is rejected before it reaches an agent run.
    return this.resolve(sessionId);
  }
}

function validateThreadId(sessionId: string): void {
  if (
    !THREAD_ID_PATTERN.test(sessionId)
    || sessionId === "."
    || sessionId === ".."
    || sessionId.endsWith(".")
    || WINDOWS_RESERVED_NAME.test(sessionId)
  ) {
    throw new Error(`Invalid thread id ${JSON.stringify(sessionId)}.`);
  }
}

function assertWorkspaceRoot(rootPath: string): void {
  const info = statSync(rootPath);
  if (!info.isDirectory()) {
    throw new Error(`Configured workspace root is not a directory: ${rootPath}.`);
  }
  accessSync(rootPath, constants.R_OK | constants.W_OK);
}

function rejectSymbolicLink(path: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`Thread workspace must not be a symbolic link: ${path}.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
