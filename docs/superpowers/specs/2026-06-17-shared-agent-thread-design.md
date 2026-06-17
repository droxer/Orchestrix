# Shared Agent Thread per Employee — Design

**Date:** 2026-06-17
**Status:** Draft (approved in brainstorming)
**Scope:** Web UI + minimal backend + `relay-core` prompt assembly. No daemon changes.

## Problem

Today the web UI presents agents (`claude`, `pi`, `codex`, `kimi`) as tabs, and the active tab both selects the default routing target AND filters the transcript. Combined with `sendMessage` calling `createSession` on every send, the practical effect is one thread per agent per employee. Cross-agent context for the user (and for the agents themselves on handoff) is fragmented.

We want one shared chat window per employee where multiple agents appear inline as a single conversation, while keeping each agent's prompt focused on its own role.

## Decisions

1. **One persistent session per employee** is the active thread. Sends append to it; a "New thread" action archives it so the next send creates a fresh session.
2. **Agent tabs remain** as the default routing target for the next send. They no longer filter the transcript. `@mention` in the composer overrides the tab for one send only (unchanged from today).
3. **Per-agent prompt isolation with a deterministic bridge.** When the daemon builds the prompt for agent X, it sees only X's prior runs in this session plus a short prepended block per intervening other-agent run, extracted deterministically from that run's last text output.
4. **No schema changes.** `RelaySession.assignments[]` and `agentRuns[]` already support multiple agents; `recordHandoff` already appends to the same session.

## Non-goals (v1)

- Named threads per employee (multiple parallel topics).
- LLM-based summarization of intervening agent runs.
- Cross-agent shared transcript at the *prompt* level (every agent reads every other agent's full output).
- Thread search / archive UI beyond the existing sessions list.

## Architecture

### Web (`web/src/App.tsx` and components)

- New per-employee state `activeSessionId` (persisted in localStorage keyed by employee). Hydrated from the newest non-archived session for that employee on first load.
- `threadSessions` filter by `activeAgent` is removed. `activeSession` resolves to `sessions.find(s => s.id === activeSessionId)`.
- `sendMessage`:
  - If `activeSessionId` exists and the session is not archived, call new `POST /sessions/:id/assignments` with `{ agent: routedAgent, mode, taskGoal: goal }` and then `runSandbox({ sandboxId, sessionId: activeSessionId, assignments: [newAssignment] })`.
  - Otherwise, create a session (current path) and set `activeSessionId` for this employee.
- Composer agent tabs: `onClick` only updates `activeAgent`. No transcript filtering.
- Transcript: iterate `activeSession.agentRuns` in chronological order. `MessageBlock` already carries the agent tag; each `●` shows the agent badge so turns are distinguishable inline.
- "New thread" button in the thread header: calls `POST /sessions/:id/archive` for the current `activeSessionId`, then clears it for this employee. Next send creates a new session.

### Backend (Python)

- New endpoint `POST /sessions/:id/assignments`:
  - Auth: same employee-scoped auth as today (`assertSessionOwnedByEmployee`).
  - Body: `{ agent: AgentName, mode: AssignmentMode, taskGoal: string }`.
  - Behavior: appends a `session.assignment.added` event with the assignment. Returns the updated session snapshot.
  - 409 if a run on this session is currently `running` (no concurrent run start), or if the session is archived.
- New endpoint `POST /sessions/:id/archive`:
  - Marks the session archived via a `session.archived` event. Web calls this on "New thread" so the session is no longer eligible as `activeSessionId`. `archived` is a snapshot flag derived from the event; existing run / completion states are untouched.
- No other backend changes. `runSandbox` already accepts `sessionId` and queues a daemon command; the daemon's command poll path is unchanged.

### `relay-core`

- New pure helper `buildBridgedPrompt(session, agent, userTurn): string`:
  - Walk `session.agentRuns` chronologically.
  - Partition into (a) runs whose `agent === agent`, kept as-is (the agent's own history), and (b) intervening other-agent runs since this agent's last run.
  - For each intervening other-agent run, extract the last `output` block whose kind is `text` (skip `thinking`, `tool`, `command`, `status`, `narration`, `raw`). If none exists, use the literal string `<no output>`.
  - Compose: `<own-history>\n\n[Previous from @<other>]\n<extracted-text>\n\n…\n\n[User]\n<userTurn>`.
  - Returns a plain string. The existing per-agent command builders in `commands.ts` consume this string unchanged.
- The daemon calls `buildBridgedPrompt` when assembling the agent CLI invocation for a run on a multi-agent session. Single-agent sessions produce the same prompt as today (no bridge blocks).

## Data flow on a send

1. User types `goal` (optionally `@mention`) and hits send.
2. Web computes `{ agent, goal } = routeComposerMessage(...)`.
3. If `activeSessionId` exists and session is not archived: `POST /sessions/:id/assignments` then `runSandbox`. Else: `createSession` then `runSandbox`. Either way the resulting session id becomes/stays `activeSessionId`.
4. Backend appends `session.assignment.added` (or `session.created` + initial assignment) and queues a daemon command tagged with `sessionId`.
5. Daemon polls, picks up the command, assembles the prompt via `buildBridgedPrompt`, runs the agent CLI, posts `run.output` / `run.completed` events back.
6. Web tails the session over SSE; transcript appends the new run inline.

## Edge cases

- **Run in flight on the active session**: the assignment endpoint returns 409. Web surfaces as a toast and keeps the composer text intact. Send button remains disabled while `activeRun?.status === "running"` (already true today).
- **Prior run failed or was cancelled**: session stays active. Next agent's bridge sees `<no output>` for failed runs with no text block, or the partial text if any was produced.
- **Decision bar (`/approve`, `/reject`, `/handoff`)**: behavior unchanged. `recordHandoff` continues to append to the same session, which is now the same model as a normal send.
- **First load with multiple historical sessions for an employee**: pick the newest non-archived session as `activeSessionId`. Older sessions remain visible via the existing sessions list (read-only entry point for v1).
- **`activeSessionId` points to a deleted/missing session**: clear and fall through to the create path.
- **`session.completed`/`session.failed`**: not treated as a thread boundary. The next send still appends. Only an explicit "New thread" archives.

## Testing

- `packages/relay-core/tests/handoff.test.ts`:
  - `buildBridgedPrompt`: single-agent (no bridge), one intervening agent (one bridge block, last text only), failed intervening run (`<no output>`), multiple intervening runs in order, runs containing only tool/thinking blocks (no text → `<no output>`).
- `backend/tests/`:
  - `POST /sessions/:id/assignments`: success appends event and updates snapshot; auth rejects cross-employee; 409 when a run is in flight; rejects unknown agent.
- `web/tests/`:
  - Active-session continuation: second send on the same employee reuses `activeSessionId` and does not call `createSession`.
  - Transcript no longer filters by `activeAgent`: a session with claude + codex runs renders both regardless of which tab is active.
  - "New thread" clears `activeSessionId` and the next send creates a new session.

## Open questions

None blocking v1. Follow-ups to consider after shipping:

- Named threads per employee (option C from brainstorming).
- LLM-summarized bridge (option B from brainstorming) for richer cross-agent handoff.
- Surface intervening-agent context to the user inline (e.g., subtle "↳ continued by @codex" markers) instead of relying on the agent badge alone.
