import type { AgentName } from "./state.js";
import type { RelaySession } from "./session-store.js";

const NO_OUTPUT = "<no output>";

interface OutputBlock {
  kind: string;
  text?: string;
}

interface RunWithOutput {
  agent: AgentName | string;
  output?: OutputBlock[];
}

function lastTextBlock(run: RunWithOutput): string {
  const blocks = run.output ?? [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === "text" && typeof b.text === "string" && b.text.length > 0) {
      return b.text;
    }
  }
  return NO_OUTPUT;
}

/**
 * Build a deterministic prompt string for `agent` that includes:
 *   1. The agent's own prior text output (chronological, joined).
 *   2. A bridge of intervening other-agent runs since the agent's last run,
 *      each rendered as `[Previous from @<agent>]\n<last text block or <no output>>`.
 *   3. The new user turn as `[User]\n<userTurn>`.
 *
 * Pure helper: it does not mutate `session`.
 */
export function buildBridgedPrompt(
  session: RelaySession,
  agent: AgentName,
  userTurn: string,
): string {
  const runs = ((session.agentRuns ?? []) as unknown) as RunWithOutput[];

  let lastOwnIndex = -1;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].agent === agent) {
      lastOwnIndex = i;
      break;
    }
  }

  const ownHistory = runs
    .filter((r, i) => r.agent === agent && i <= lastOwnIndex)
    .map(
      (r) =>
        (r.output ?? [])
          .filter((b) => b.kind === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("\n"),
    )
    .filter((s) => s.length > 0)
    .join("\n\n");

  const intervening = runs.slice(lastOwnIndex + 1).filter((r) => r.agent !== agent);
  const bridge = intervening
    .map((r) => `[Previous from @${r.agent}]\n${lastTextBlock(r)}`)
    .join("\n\n");

  const parts: string[] = [];
  if (ownHistory) parts.push(ownHistory);
  if (bridge) parts.push(bridge);
  parts.push(`[User]\n${userTurn}`);
  return parts.join("\n\n");
}
