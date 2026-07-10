import type { ControlPanelDaemonNodeRecord, SandboxRecord } from "../types";
import { fetchControlPanelNodes } from "./controlPanelQueries";

export function canUseLocalControlPanel(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "::1";
}

export function newBrowserSandboxToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return `tok_${btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

export function preferLocalControlPanelNode(
  employeeId: string,
  nodes: ControlPanelDaemonNodeRecord[],
): ControlPanelDaemonNodeRecord | undefined {
  return nodes
    .filter((node) => node.employeeId === employeeId && node.nodeToken)
    .sort((a, b) => {
      const score = (node: ControlPanelDaemonNodeRecord) =>
        (node.online && !node.stale ? 2 : 0) + (node.status === "ready" ? 1 : 0);
      const delta = score(b) - score(a);
      return delta || (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "");
    })[0];
}

export async function localControlPanelNodes(): Promise<ControlPanelDaemonNodeRecord[]> {
  if (!canUseLocalControlPanel()) return [];
  try {
    return await fetchControlPanelNodes();
  } catch {
    return [];
  }
}

export function sessionBelongsToEmployee(
  session: { workspacePath: string },
  employeeId: string,
  sandbox?: SandboxRecord,
  node?: { workspacePath?: string },
): boolean {
  if (sandbox && session.workspacePath === sandbox.workspacePath) return true;
  if (node?.workspacePath && session.workspacePath === node.workspacePath) return true;
  return session.workspacePath === `/workspace/${employeeId}` || session.workspacePath.endsWith(`/${employeeId}`);
}
