import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Agents participating in one Thread share its workspace. This namespaces
 * each Agent's private state under that Thread's agents/<agentId>/ directory;
 * it is not an Agent-owned workspace and never spans Threads.
 */
export function agentWorkspaceSubpath(agentId: string): string {
  return join("agents", `agent-${Buffer.from(agentId).toString("base64url")}`);
}

export function ensureAgentWorkspaceDir(workspaceRoot: string, agentId: string): string {
  const dir = join(workspaceRoot, agentWorkspaceSubpath(agentId));
  mkdirSync(dir, { recursive: true });
  return dir;
}
