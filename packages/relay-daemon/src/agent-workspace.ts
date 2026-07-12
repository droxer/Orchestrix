import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Per-agent runs share one node workspace mount; this namespaces each
 * agent's files under agents/<agentId>/ so concurrent agents on the same
 * node don't collide, without changing the BoxLite mount/VM lifecycle.
 */
export function agentWorkspaceSubpath(agentId: string): string {
  return join("agents", `agent-${Buffer.from(agentId).toString("base64url")}`);
}

export function ensureAgentWorkspaceDir(workspaceRoot: string, agentId: string): string {
  const dir = join(workspaceRoot, agentWorkspaceSubpath(agentId));
  mkdirSync(dir, { recursive: true });
  return dir;
}
