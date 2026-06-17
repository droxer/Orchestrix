# Agent Turn Summaries for Shared Multi-Agent Context

## Status

Draft — awaiting implementation plan.

## Context

Relay already lets an employee run multiple agents in a single TUI window/session (e.g. `@claude @pi fix auth`). Today those agents run sequentially, but each agent receives only the original `task_goal` plus any review feedback from a prior review step. Implement-mode agents do **not** see what previous implement-mode agents produced. The transcript is shared in the UI, but the agent prompts are not.

## Goal

When multiple agents run in one employee session, each agent after the first should receive a concise, bounded summary of prior agents’ runs in its prompt. The context is summarized, not the full transcript.

## Out of scope

- Concurrent multi-agent collaboration.
- LLM-generated summaries (a future option, but not this change).
- Changing the TUI window/session model.

## Approach

Add a structured `agent_turn_summaries` array to `AgentState`. After each agent run, append a deterministic summary of that run. All task prompt builders append the summaries as a “Previous agent context” section when non-empty.

## Data model

### TypeScript

In `packages/relay-core/src/state.ts`:

```ts
export interface AgentTurnSummary {
  agent: AgentName;
  mode: AgentTaskMode;
  status: "completed" | "failed" | "cancelled";
  exitCode: number;
  summary: string;
}

export interface AgentState {
  task_goal: string;
  agent_logs: string[];
  agent_turn_summaries: AgentTurnSummary[];
  last_exit_code: number;
  agent_failures: Partial<Record<AgentName, number>>;
  review_verdict: ReviewVerdict | "";
  review_feedback: string;
}
```

`initialAgentState` returns `agent_turn_summaries: []`. `mergeAgentState` concatenates incoming summaries onto the existing array.

### Python

Mirror the same fields in `backend/relay/controller.py`:

- `initial_agent_state` returns `agent_turn_summaries: []`.
- `merge_agent_state` concatenates `agent_turn_summaries`.

## Summary generation

Add `summarizeAgentRun(agent, mode, status, exitCode, stdout, stderr, maxLength = 500)` in `packages/relay-core/src/nodes.ts`.

Responsibilities:

1. Receive `status` already resolved by `runAgentNode` (`completed`, `failed`, or `cancelled`).
2. Build a one-line status sentence: `<Agent> <mode> <status> (exit <exitCode>).`
3. Append the tail of non-empty `stdout`/`stderr`, capped at `maxLength`.
4. Skip empty streams to keep the summary compact.

Example output:

```
Claude Code completed (exit 0).
stdout (last 500 chars):
…implemented the auth token expiry check.
```

`runAgentNode` resolves `status` from the run result and signal, then returns:

```ts
agent_turn_summaries: [{ agent, mode, status, exitCode, summary }],
```

## Daemon protocol

`packages/relay-core/src/daemon-node-protocol.ts` `run.completed` payload gains an optional field:

```ts
agentTurnSummaries?: AgentTurnSummary[];
```

`packages/relay-daemon/src/index.ts` `executeCommand` sends the new turn summary (from the `runAgentNode` patch) in `agentTurnSummaries` so the backend can append it to session state.

## Backend integration

`backend/relay/controller.py`:

- `record_agent_completed` accepts `agent_turn_summaries` from the input dict and merges it into state.

`backend/relay/daemon.py`:

- `_advance_run_request` passes `event.get("agentTurnSummaries", [])` into `record_agent_completed`.
- `_enqueue_current_assignment` passes `run_request["state"]` (which now includes summaries) into each `run.start` command.

## Prompt changes

Add `formatAgentTurnSummaries(summaries)` in `packages/relay-core/src/prompts.ts`. It returns a prompt section like:

```
Previous agent context:

Claude Code completed (exit 0).
stdout (last 500 chars):
…implemented the auth token expiry check.

Codex Implement failed (exit 1).
stderr (last 500 chars):
…tests failed with 3 errors.
```

Each summary is separated by a blank line. Update all task prompt builders to append this section when `agent_turn_summaries` is non-empty:

- `claudeTaskPrompt`
- `piTaskPrompt`
- `codexImplementPrompt`
- `kimiTaskPrompt`
- `reviewPrompt`

## Error handling and edge cases

| Case | Behavior |
|------|----------|
| Empty summaries | Prompt section omitted. |
| Long output tail | Capped at `maxLength` (default 500 chars). |
| Failed/cancelled prior run | Included so next agent can recover. |
| Daemon omits `agentTurnSummaries` | Backend treats as empty (backward compatible). |
| Review mode | Summary appended like any other run; review prompt also sees prior context. |

## Backwards compatibility

- New `AgentState` field is optional/missing in older sessions; treat missing as `[]`.
- Daemon `run.completed` event field is optional; backend and TUI handle absence.
- No changes to existing session event schema or snapshots.

## Testing plan

1. `packages/relay-core/tests/handoff.test.ts`:
   - `mergeAgentState` concatenates `agent_turn_summaries`.
   - `summarizeAgentRun` produces bounded output, skips empty streams, and handles failure/cancellation.
   - Each prompt builder includes prior summaries.
   - Sequential `runStep` calls accumulate summaries.

2. `backend/tests/`:
   - `record_agent_completed` merges `agent_turn_summaries`.
   - `_advance_run_request` forwards summaries from daemon events.
   - `_enqueue_current_assignment` passes updated state to next command.

3. Build/typecheck:
   - `npm run build` passes.
   - Python backend tests pass.

## Affected files

- `packages/relay-core/src/state.ts`
- `packages/relay-core/src/nodes.ts`
- `packages/relay-core/src/prompts.ts`
- `packages/relay-core/src/daemon-node-protocol.ts`
- `packages/relay-daemon/src/index.ts`
- `backend/relay/controller.py`
- `backend/relay/daemon.py`
- `packages/relay-core/tests/handoff.test.ts`
- `backend/tests/` (add/update controller/daemon tests)

## Future work

- Replace deterministic tail summarization with a cheap LLM summarizer if prompt context quality becomes a bottleneck.
- Allow per-agent summary length limits via config or env.
