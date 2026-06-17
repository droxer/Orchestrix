# Shared Agent Thread per Employee — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each employee have one shared chat thread that multiple agents (`claude`, `pi`, `codex`, `kimi`) contribute to inline, while each agent's CLI prompt only sees its own prior runs plus a short deterministic bridge from any intervening agent runs.

**Architecture:** No schema changes. `RelaySession` already supports multiple `assignments[]` and `agentRuns[]`. The web stores `activeSessionId` per employee in localStorage and appends to it via the existing `POST /sessions/:id/assignments` endpoint instead of always creating a new session. A new pure helper `buildBridgedPrompt` in `relay-core` produces the agent-bridged prompt string. A new `POST /sessions/:id/archive` endpoint emits a `session.archived` event so "New thread" has explicit persistence.

**Tech Stack:** TypeScript (`relay-core`, `web/` Next.js + React, `relay-daemon`), Python/FastAPI backend, `node:test` and `pytest`.

**Spec:** `docs/superpowers/specs/2026-06-17-shared-agent-thread-design.md`

---

## File Structure

**Create**
- `packages/relay-core/src/bridged-prompt.ts` — pure helper `buildBridgedPrompt(session, agent, userTurn)`.
- `packages/relay-core/tests/bridged-prompt.test.ts` — unit tests.
- `web/src/hooks/useActiveSession.ts` — per-employee `activeSessionId` state + localStorage persistence.
- `backend/tests/api/test_session_archive.py` — archive endpoint tests.
- `backend/tests/api/test_session_assignments.py` — additional tests for append-on-active-session semantics.

**Modify**
- `packages/relay-core/src/index.ts` — export `buildBridgedPrompt`.
- `packages/relay-daemon/src/execution.ts` (or wherever the daemon assembles agent prompts — engineer must locate via `grep "AGENT_REGISTRY" packages/relay-daemon`) — call `buildBridgedPrompt` for multi-agent sessions.
- `backend/relay/controller.py` — add `archive_session(session_id)` method emitting `session.archived` event; reject `assign_session` when archived or when a run is currently in flight.
- `backend/relay/session_store.py` — derive `archived: bool` snapshot flag from `session.archived` event.
- `backend/relay/api/session_routes.py` — add `POST /sessions/{session_id}/archive`; return 409 from `/assignments` when archived / run in flight.
- `web/src/App.tsx` — drop `activeAgent` filter on `threadSessions`; rewrite `sendMessage` to append-or-create; wire "New thread"; pass shared session to `Transcript`.
- `web/src/components/Transcript.tsx` (or wherever the thread header lives — engineer to confirm) — add "New thread" button.
- `web/src/api.ts` — add `appendAssignment(sessionId, assignment, token)` and `archiveSession(sessionId, token)` helpers.
- `web/tests/status.test.ts` — extend coverage; add a new test file `web/tests/sharedThread.test.ts` for send-flow continuation.

---

## Task 1: `buildBridgedPrompt` pure helper

**Files:**
- Create: `packages/relay-core/src/bridged-prompt.ts`
- Create: `packages/relay-core/tests/bridged-prompt.test.ts`
- Modify: `packages/relay-core/src/index.ts`

- [ ] **Step 1: Read existing AgentRun / event shapes**

Read `packages/relay-core/src/state.ts` and `packages/relay-core/src/session-store.ts` to confirm the exact field names on `AgentRun` and the event/output block shapes (`{ kind: "text" | "thinking" | ... }`). Confirm: `RelaySession.agentRuns: AgentRun[]`, each `AgentRun` has `agent: AgentName` and an ordered output/event sequence.

- [ ] **Step 2: Write failing test**

`packages/relay-core/tests/bridged-prompt.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildBridgedPrompt } from "../src/bridged-prompt.js";
import type { RelaySession } from "../src/session-store.js";

function makeSession(runs: Array<{ agent: string; texts: string[] }>): RelaySession {
  return {
    id: "sess_1",
    agentRuns: runs.map((r, i) => ({
      runId: `run_${i}`,
      agent: r.agent,
      output: r.texts.map((t) => ({ kind: "text" as const, text: t })),
    })),
  } as unknown as RelaySession;
}

describe("buildBridgedPrompt", () => {
  it("single-agent: no bridge blocks, just user turn appended", () => {
    const s = makeSession([{ agent: "claude", texts: ["hello"] }]);
    const out = buildBridgedPrompt(s, "claude", "next turn");
    assert.ok(!out.includes("[Previous from"));
    assert.ok(out.endsWith("[User]\nnext turn"));
  });

  it("one intervening agent: bridge contains only that agent's last text", () => {
    const s = makeSession([
      { agent: "claude", texts: ["draft v1"] },
      { agent: "codex", texts: ["intermediate", "final review note"] },
    ]);
    const out = buildBridgedPrompt(s, "claude", "incorporate review");
    assert.match(out, /\[Previous from @codex\]\nfinal review note/);
  });

  it("intervening run with no text block uses <no output>", () => {
    const s = {
      id: "sess",
      agentRuns: [
        { runId: "r0", agent: "claude", output: [{ kind: "text", text: "x" }] },
        { runId: "r1", agent: "codex", output: [{ kind: "thinking", text: "..." }] },
      ],
    } as unknown as RelaySession;
    const out = buildBridgedPrompt(s, "claude", "go");
    assert.match(out, /\[Previous from @codex\]\n<no output>/);
  });

  it("multiple intervening runs: chronological order, one block each", () => {
    const s = makeSession([
      { agent: "claude", texts: ["a"] },
      { agent: "pi", texts: ["p1"] },
      { agent: "codex", texts: ["c1"] },
    ]);
    const out = buildBridgedPrompt(s, "claude", "go");
    const piIdx = out.indexOf("[Previous from @pi]");
    const cxIdx = out.indexOf("[Previous from @codex]");
    assert.ok(piIdx > -1 && cxIdx > piIdx);
  });

  it("bridge only includes runs since this agent's last run", () => {
    const s = makeSession([
      { agent: "codex", texts: ["old"] },
      { agent: "claude", texts: ["mine"] },
      { agent: "codex", texts: ["recent"] },
    ]);
    const out = buildBridgedPrompt(s, "claude", "go");
    assert.ok(!out.includes("old"));
    assert.match(out, /\[Previous from @codex\]\nrecent/);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

```bash
npm run build -w packages/relay-core
node --test dist/packages/relay-core/tests/bridged-prompt.test.js
```

Expected: build error or test failure (`Cannot find module .../bridged-prompt`).

- [ ] **Step 4: Implement `buildBridgedPrompt`**

`packages/relay-core/src/bridged-prompt.ts`:

```ts
import type { AgentName } from "./state.js";
import type { RelaySession } from "./session-store.js";

const NO_OUTPUT = "<no output>";

function lastTextBlock(run: { output?: Array<{ kind: string; text?: string }> }): string {
  const blocks = run.output ?? [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === "text" && typeof b.text === "string" && b.text.length > 0) return b.text;
  }
  return NO_OUTPUT;
}

export function buildBridgedPrompt(
  session: RelaySession,
  agent: AgentName,
  userTurn: string,
): string {
  const runs = session.agentRuns ?? [];
  let lastOwnIndex = -1;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].agent === agent) { lastOwnIndex = i; break; }
  }

  const ownHistory = runs
    .filter((r, i) => r.agent === agent && i <= lastOwnIndex)
    .map((r) => r.output?.filter((b) => b.kind === "text").map((b) => b.text).join("\n") ?? "")
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
```

- [ ] **Step 5: Export from `relay-core/src/index.ts`**

Add: `export { buildBridgedPrompt } from "./bridged-prompt.js";`

- [ ] **Step 6: Run tests, verify all pass**

```bash
npm run build -w packages/relay-core
node --test dist/packages/relay-core/tests/bridged-prompt.test.js
```

Expected: 5 passing.

- [ ] **Step 7: Commit**

```bash
git add packages/relay-core/src/bridged-prompt.ts packages/relay-core/src/index.ts packages/relay-core/tests/bridged-prompt.test.ts
# (commit step skipped per user's "Do NOT create git commit" rule; stage only)
```

---

## Task 2: Extract prior-run text + daemon prompt integration

**Background (was under-scoped in the original plan):** `AgentRun` carries no inline output. Per-run text exists as `agent.output` events (raw JSONL) and as `agent_output`/`command_log`/`review` artifacts written at run completion (`backend/relay/controller.py:201`, body = `input.agentLog`, agentRunId = run id). Bridge text is sourced from the artifact (the daemon's already-rendered agent transcript that uses `●` markers per assistant turn — see CLAUDE.md key invariant).

**Files:**
- Create: `packages/relay-core/src/last-assistant-text.ts` — pure helper.
- Create: `packages/relay-core/tests/last-assistant-text.test.ts`.
- Modify: `packages/relay-core/src/index.ts` — export the new helper.
- Modify: daemon prompt assembly site (engineer locates by `grep -rn "buildClaudeCommand\\|buildCodexCommand\\|buildPiCommand\\|buildKimiCommand\\|runAgentNode" packages/relay-daemon/src packages/relay-core/src`).

- [ ] **Step 1: Write failing test for `extractLastAssistantText`**

`packages/relay-core/tests/last-assistant-text.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractLastAssistantText } from "../src/last-assistant-text.js";

describe("extractLastAssistantText", () => {
  it("returns null for empty or whitespace-only input", () => {
    assert.equal(extractLastAssistantText(""), null);
    assert.equal(extractLastAssistantText("   \n\n"), null);
  });

  it("returns null when no '●' marker is present", () => {
    assert.equal(extractLastAssistantText("no marker here\njust text"), null);
  });

  it("returns the trimmed text of the last '●' segment", () => {
    const transcript = "● first turn\nsome body\n● second turn\nthe answer\n⏺ tool noise";
    assert.equal(extractLastAssistantText(transcript), "second turn\nthe answer");
  });

  it("ignores '○' (thinking) and '⏺' (tool) markers", () => {
    const transcript = "○ thinking line\n● real text\nbody\n⏺ tool";
    assert.equal(extractLastAssistantText(transcript), "real text\nbody");
  });

  it("returns null when '●' segments exist but are empty after trimming", () => {
    assert.equal(extractLastAssistantText("●   \n   \n"), null);
  });
});
```

- [ ] **Step 2: Build + run, verify it fails**

```bash
npm run build -w packages/relay-core
node --test dist/packages/relay-core/tests/last-assistant-text.test.js
```

- [ ] **Step 3: Implement helper**

`packages/relay-core/src/last-assistant-text.ts`:

```ts
const ASSISTANT_MARKER = "● ";
const NOISE_MARKERS = ["○ ", "⏺ "];

export function extractLastAssistantText(transcript: string): string | null {
  if (!transcript || !transcript.trim()) return null;
  const segments = transcript.split(/\n?● /).slice(1);
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    const cleaned = seg
      .split("\n")
      .filter((line) => !NOISE_MARKERS.some((m) => line.startsWith(m)))
      .join("\n")
      .trim();
    if (cleaned.length > 0) return cleaned;
  }
  return null;
}
```

Export from `packages/relay-core/src/index.ts`: `export { extractLastAssistantText } from "./last-assistant-text.js";`

- [ ] **Step 4: Build + run, verify all 5 pass**

```bash
npm run build -w packages/relay-core
node --test dist/packages/relay-core/tests/last-assistant-text.test.js
```

- [ ] **Step 5: Locate the daemon's prompt assembly**

Run:
```bash
grep -rn "buildClaudeCommand\\|buildCodexCommand\\|buildPiCommand\\|buildKimiCommand\\|runAgentNode" packages/relay-daemon/src packages/relay-core/src
```

The site that assembles the user-turn prompt before passing to the per-agent command builder is the integration point. The function will already have a `session` (or session id from which to fetch one) and an `assignment` with `agent` + `taskGoal`. If the daemon receives only a command payload and not the full session, the session must be fetched from the backend or read from local event store — follow whichever pattern the existing code uses (this is where the implementer must inspect rather than guess; CLAUDE.md notes the daemon does NOT have local session state, it polls the backend for commands).

If session access turns out to require a new backend endpoint to fetch a session by id with full event history, report DONE_WITH_CONCERNS and stop after Step 7 — do not invent a new endpoint without checking back.

- [ ] **Step 6: Wire `buildBridgedPrompt`**

For a multi-agent session, build the bridged prompt:

```ts
import { buildBridgedPrompt, extractLastAssistantText } from "relay-core";

// `session` is the RelaySession this run belongs to.
// For each prior run on the session, derive its text from its agent_output artifact:
const runsWithText = session.agentRuns.map((run) => {
  const artifactId = run.artifactIds.find(/* point at agent_output/command_log/review artifact */);
  const artifactText = artifactId ? readArtifactText(session.id, artifactId) : "";
  const lastText = extractLastAssistantText(artifactText) ?? "";
  return { ...run, output: lastText ? [{ kind: "text" as const, text: lastText }] : [] };
});

const enrichedSession = { ...session, agentRuns: runsWithText };
const prompt = buildBridgedPrompt(enrichedSession, assignment.agent, userTurn);
```

`readArtifactText` reads the artifact body from the backend (or local cache, if the daemon already does this). Use whatever read path the daemon already uses for artifacts; if none exists, add a minimal one — but again, if this expands the task significantly, stop and report.

- [ ] **Step 7: Add an integration test for the daemon prompt assembly (if a test harness exists)**

Look under `packages/relay-daemon/tests/` and `packages/relay-core/tests/handoff.test.ts`. If a test exists that exercises the prompt-assembly function with a sample session, extend it to cover the multi-agent case asserting `[Previous from @codex]` appears. If no such test exists, add one only if doing so is straightforward; otherwise note it as a follow-up and rely on Task 8's smoke.

- [ ] **Step 8: Build, run all relay-core + daemon tests**

```bash
make build-packages
node --test dist/packages/relay-core/tests/last-assistant-text.test.js
node --test dist/packages/relay-core/tests/bridged-prompt.test.js
node --test dist/packages/relay-core/tests/handoff.test.js
```

All green. If daemon tests exist, run those too.

- [ ] **Step 9: Stage**

```bash
git add packages/relay-core/src/last-assistant-text.ts packages/relay-core/src/index.ts packages/relay-core/tests/last-assistant-text.test.ts packages/relay-daemon/
```

---

## Task 3: Backend `session.archived` event and archive endpoint

**Files:**
- Modify: `backend/relay/controller.py`
- Modify: `backend/relay/session_store.py`
- Modify: `backend/relay/api/session_routes.py`
- Create: `backend/tests/api/test_session_archive.py`

- [ ] **Step 1: Read current snapshot derivation**

Open `backend/relay/session_store.py`, find the event-replay loop that builds the session snapshot. Note where status/phase mutations are applied. The `archived` flag will be added to the snapshot dict (default `False`) and flipped to `True` on `session.archived`.

- [ ] **Step 2: Write failing controller test**

`backend/tests/api/test_session_archive.py`:

```python
import pytest
from fastapi.testclient import TestClient


@pytest.mark.api
def test_archive_endpoint_marks_session_archived(client: TestClient, employee_token: str, session_id: str) -> None:
    headers = {"Authorization": f"Bearer {employee_token}"}
    resp = client.post(f"/sessions/{session_id}/archive", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("archived") is True


@pytest.mark.api
def test_assign_rejects_archived_session(client: TestClient, employee_token: str, session_id: str) -> None:
    headers = {"Authorization": f"Bearer {employee_token}"}
    client.post(f"/sessions/{session_id}/archive", headers=headers)
    resp = client.post(
        f"/sessions/{session_id}/assignments",
        headers=headers,
        json={"assignments": [{"agent": "claude", "mode": "implement"}]},
    )
    assert resp.status_code == 409


@pytest.mark.api
def test_archive_requires_owner(client: TestClient, other_employee_token: str, session_id: str) -> None:
    headers = {"Authorization": f"Bearer {other_employee_token}"}
    resp = client.post(f"/sessions/{session_id}/archive", headers=headers)
    assert resp.status_code in (403, 404)
```

Engineer must align fixture names (`client`, `employee_token`, `session_id`, `other_employee_token`) with `backend/tests/conftest.py` — adjust if names differ.

- [ ] **Step 3: Run test, verify it fails**

```bash
cd backend && uv run pytest tests/api/test_session_archive.py -v
```

Expected: 404 (route does not exist).

- [ ] **Step 4: Add `archive_session` to `SessionController`**

In `backend/relay/controller.py` (alongside `assign_session`):

```python
def archive_session(self, session_id: str) -> dict[str, Any]:
    snapshot = self.store.get_session(session_id)
    if snapshot.get("archived"):
        return snapshot
    self._append(session_id, relay_event("session.archived", session_id, {}))
    logger.info("Session archived", session_id=session_id)
    return self.store.get_session(session_id)
```

And add an archived/in-flight check at the top of `assign_session`:

```python
def assign_session(self, session_id: str, assignments: list[dict[str, Any]]) -> dict[str, Any]:
    snapshot = self.store.get_session(session_id)
    if snapshot.get("archived"):
        raise HTTPException(status_code=409, detail="Session is archived.")
    if any(r.get("status") == "running" for r in snapshot.get("agentRuns", [])):
        raise HTTPException(status_code=409, detail="Session has a run in flight.")
    # ... existing body ...
```

Import `HTTPException` at the top of the file if not already imported.

- [ ] **Step 5: Derive `archived` flag in `session_store.py`**

In the event-replay loop, initialize `snapshot["archived"] = False`. On event type `session.archived`, set `snapshot["archived"] = True`.

- [ ] **Step 6: Add archive route in `backend/relay/api/session_routes.py`**

After the `/handoffs` route:

```python
@router.post("/sessions/{session_id}/archive")
async def archive(session_id: str, request: Request, ctx: AppContextDep) -> dict[str, Any]:
    actor = request_actor(request, ctx.auth_store)
    get_session_for_actor(ctx.session_store, session_id, actor)
    controller = SessionController(
        ctx.session_store,
        task_store=ctx.task_store,
        owner_employee_id=actor["employeeId"],
    )
    return controller.archive_session(session_id)
```

- [ ] **Step 7: Run tests, verify all pass**

```bash
cd backend && uv run pytest tests/api/test_session_archive.py -v
cd backend && uv run pytest tests/ -v
```

All green.

- [ ] **Step 8: Stage**

```bash
git add backend/
```

---

## Task 4: Web `useActiveSession` hook

**Files:**
- Create: `web/src/hooks/useActiveSession.ts`
- Create: `web/tests/useActiveSession.test.ts`

- [ ] **Step 1: Write failing test**

`web/tests/useActiveSession.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickInitialActiveSessionId } from "../src/hooks/useActiveSession";

describe("pickInitialActiveSessionId", () => {
  it("returns stored id when session exists and is not archived", () => {
    const sessions = [{ id: "s1", archived: false }, { id: "s2", archived: false }] as any;
    assert.equal(pickInitialActiveSessionId("s2", sessions), "s2");
  });

  it("falls back to newest non-archived session when stored id is missing", () => {
    const sessions = [{ id: "s1", archived: false, createdAt: "2026-06-01" }, { id: "s2", archived: false, createdAt: "2026-06-10" }] as any;
    assert.equal(pickInitialActiveSessionId(null, sessions), "s2");
  });

  it("skips archived sessions on fallback", () => {
    const sessions = [{ id: "s1", archived: false, createdAt: "2026-06-01" }, { id: "s2", archived: true, createdAt: "2026-06-10" }] as any;
    assert.equal(pickInitialActiveSessionId(null, sessions), "s1");
  });

  it("returns null when no eligible session", () => {
    assert.equal(pickInitialActiveSessionId(null, []), null);
  });

  it("returns null when stored id points to archived session and no other eligible", () => {
    const sessions = [{ id: "s2", archived: true, createdAt: "2026-06-10" }] as any;
    assert.equal(pickInitialActiveSessionId("s2", sessions), null);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd web && npx tsx --test tests/useActiveSession.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement hook + pure picker**

`web/src/hooks/useActiveSession.ts`:

```ts
import { useEffect, useState, useCallback } from "react";

type SessionLike = { id: string; archived?: boolean; createdAt?: string };

const STORAGE_PREFIX = "relay.activeSession.";

export function pickInitialActiveSessionId(stored: string | null, sessions: SessionLike[]): string | null {
  if (stored) {
    const hit = sessions.find((s) => s.id === stored && !s.archived);
    if (hit) return hit.id;
  }
  const eligible = sessions
    .filter((s) => !s.archived)
    .slice()
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return eligible[0]?.id ?? null;
}

export function useActiveSession(employeeId: string, sessions: SessionLike[]) {
  const key = STORAGE_PREFIX + employeeId;
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId) { setActiveSessionIdState(null); return; }
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
    setActiveSessionIdState(pickInitialActiveSessionId(stored, sessions));
  }, [employeeId, sessions, key]);

  const setActiveSessionId = useCallback((id: string | null) => {
    setActiveSessionIdState(id);
    if (typeof window === "undefined" || !employeeId) return;
    if (id) window.localStorage.setItem(key, id);
    else window.localStorage.removeItem(key);
  }, [employeeId, key]);

  return { activeSessionId, setActiveSessionId };
}
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
cd web && npx tsx --test tests/useActiveSession.test.ts
```

5 passing.

- [ ] **Step 5: Stage**

```bash
git add web/src/hooks/useActiveSession.ts web/tests/useActiveSession.test.ts
```

---

## Task 5: Web API helpers for assignment append + archive

**Files:**
- Modify: `web/src/api.ts`

- [ ] **Step 1: Read existing helpers**

Open `web/src/api.ts`, locate `createSession`, `recordHandoff`, `recordDecision`. Match their conventions (token header, error mapping).

- [ ] **Step 2: Add helpers**

```ts
export async function appendAssignment(
  sessionId: string,
  assignment: { agent: AgentName; mode: AssignmentMode },
  token: string,
): Promise<RelaySession> {
  const resp = await fetch(`${baseUrl()}/sessions/${sessionId}/assignments`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ assignments: [assignment] }),
  });
  if (resp.status === 409) throw new ConflictError(await resp.text());
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

export async function archiveSession(sessionId: string, token: string): Promise<RelaySession> {
  const resp = await fetch(`${baseUrl()}/sessions/${sessionId}/archive`, {
    method: "POST",
    headers: authHeaders(token),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}
```

Engineer must reuse this file's existing `baseUrl`/`authHeaders`/error-helper conventions — names above are illustrative. If `ConflictError` doesn't already exist, add a small class beside the existing error types.

- [ ] **Step 3: Stage**

```bash
git add web/src/api.ts
```

---

## Task 6: Web send-flow rewires to one shared thread

**Files:**
- Modify: `web/src/App.tsx`
- Create: `web/tests/sharedThread.test.ts`

- [ ] **Step 1: Write failing test**

`web/tests/sharedThread.test.ts` — pure-function test for the new `chooseSendAction` helper we will extract from `sendMessage` so it can be tested without React:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chooseSendAction } from "../src/lib/sendAction";

describe("chooseSendAction", () => {
  it("appends when active session exists and is open", () => {
    const action = chooseSendAction({ activeSessionId: "s1", session: { id: "s1", archived: false, agentRuns: [] } as any });
    assert.deepEqual(action, { kind: "append", sessionId: "s1" });
  });

  it("creates when no active session", () => {
    const action = chooseSendAction({ activeSessionId: null, session: undefined });
    assert.deepEqual(action, { kind: "create" });
  });

  it("creates when active session is archived", () => {
    const action = chooseSendAction({ activeSessionId: "s1", session: { id: "s1", archived: true, agentRuns: [] } as any });
    assert.deepEqual(action, { kind: "create" });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd web && npx tsx --test tests/sharedThread.test.ts
```

Expected: module not found.

- [ ] **Step 3: Create the pure helper**

`web/src/lib/sendAction.ts`:

```ts
import type { RelaySession } from "../types";

export type SendAction = { kind: "append"; sessionId: string } | { kind: "create" };

export function chooseSendAction(input: { activeSessionId: string | null; session: RelaySession | undefined }): SendAction {
  const { activeSessionId, session } = input;
  if (activeSessionId && session && !session.archived) {
    return { kind: "append", sessionId: activeSessionId };
  }
  return { kind: "create" };
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
cd web && npx tsx --test tests/sharedThread.test.ts
```

3 passing.

- [ ] **Step 5: Rewire `App.tsx`**

Replace today's `threadSessions` line and `sendMessage` body:

Remove:
```ts
const threadSessions = useMemo(() => sandboxSessions.filter((s) => s.agentRuns.some((r) => r.agent === activeAgent)), [sandboxSessions, activeAgent]);
```

Add per-employee session list + active session hook:
```ts
const employeeSessions = useMemo(
  () => sandboxSessions.filter((s) => sessionBelongsToEmployee(s, selectedEmployee, selectedSandbox, selectedNode)),
  [sandboxSessions, selectedEmployee, selectedSandbox, selectedNode],
);
const { activeSessionId, setActiveSessionId } = useActiveSession(selectedEmployee, employeeSessions);
const activeSession = useMemo(() => employeeSessions.find((s) => s.id === activeSessionId), [employeeSessions, activeSessionId]);
```

Rewrite `sendMessage` (keep auth + routing as today; only the create/append branch changes):

```ts
const { agent: routedAgent, goal } = routeComposerMessage(raw, activeAgent, agents);
if (!goal) { setStatus({ tone: "warn", message: t("toast.add_task", { agent: routedAgent }) }); return; }
// ... existing token / sandbox guards ...
const assignment = { agent: routedAgent, mode: composerMode };
const action = chooseSendAction({ activeSessionId, session: activeSession });
let sessionId: string;
if (action.kind === "append") {
  await appendAssignment(action.sessionId, assignment, token);
  sessionId = action.sessionId;
} else {
  const session = await createSession({ taskGoal: goal, assignments: [assignment], workspacePath: sandbox.workspacePath, ownerEmployeeId: selectedEmployee }, token);
  sessionId = session.id;
  setActiveSessionId(sessionId);
}
setSelectedSessionId(sessionId);
composer.setComposerText(""); composer.setMentionOpen(false);
await runSandbox({ sandboxId: sandbox.id, taskGoal: goal, assignments: [assignment], sessionId }, token);
setStatus({ tone: "good", message: t("toast.message_sent", { employee: selectedEmployee, agent: routedAgent }) });
```

Catch a `ConflictError` from `appendAssignment` and surface as a "run in flight, try again" toast.

Pass `activeSession` (not the filtered selection) to the transcript area, and remove the `activeAgent` dependency from message rendering — `MessageBlock` already shows the per-message agent badge.

- [ ] **Step 6: Type-check + tests**

```bash
cd web && npm run build
cd web && npx tsx --test tests/sharedThread.test.ts tests/useActiveSession.test.ts tests/status.test.ts tests/messageRouting.test.ts
```

All green.

- [ ] **Step 7: Stage**

```bash
git add web/src/App.tsx web/src/lib/sendAction.ts web/tests/sharedThread.test.ts
```

---

## Task 7: "New thread" button

**Files:**
- Modify: thread header component (engineer locates by `grep -n "Transcript\\|thread.no_employee_selected\\|DecisionBar" web/src/components`).
- Modify: `web/src/i18n/locales/{en,zh-CN,zh-TW}/translation.json` — add `thread.new_thread` key.

- [ ] **Step 1: Add i18n keys**

In each translation JSON, under `thread`:
```json
"new_thread": "New thread"
```
(Localized variants for `zh-CN` / `zh-TW`: "新对话" / "新對話".)

- [ ] **Step 2: Add button to the thread header**

Render only when `activeSession` exists. On click:

```tsx
<button
  type="button"
  onClick={async () => {
    if (!activeSession) return;
    try { await archiveSession(activeSession.id, selectedToken); }
    finally { setActiveSessionId(null); setSelectedSessionId(null); }
  }}
>
  {t("thread.new_thread")}
</button>
```

- [ ] **Step 3: Manual smoke (UI verification — see Task 8)**

(Defer real verification to Task 8 which exercises end-to-end.)

- [ ] **Step 4: Stage**

```bash
git add web/src/components web/src/i18n
```

---

## Task 8: End-to-end smoke (manual)

This is a UI feature. Type checks and unit tests alone do not confirm correctness.

- [ ] **Step 1: Start backend + daemon + web dev server**

```bash
make backend &
make daemon &
make web
```

- [ ] **Step 2: Send to @claude on a fresh employee**

Open the web UI, select an employee, type "hello from claude" with claude tab active. Expect: a new session appears in the transcript with one claude run.

- [ ] **Step 3: Switch to @codex tab and send another message**

Type "review that". Expect:
- No new session is created in the sessions sidebar count.
- The transcript shows both the claude run and the codex run inline.
- The codex CLI received a prompt containing `[Previous from @claude]\n<claude's last text>`. Verify via daemon logs at `<workspace>/.relay/daemon-nodes/logs/*.jsonl`.

- [ ] **Step 4: Switch tabs back to @claude — transcript stays put**

Expect: tab change does NOT filter the transcript (this is the key behavior change).

- [ ] **Step 5: Click "New thread", send again**

Expect:
- The previous session is archived (sessions sidebar shows it grayed out / hidden per UX choice).
- A new session is created on send.
- localStorage `relay.activeSession.<employeeId>` reflects the new id.

- [ ] **Step 6: Reload page**

Expect: the active session is restored from localStorage; transcript is unchanged.

- [ ] **Step 7: Concurrent-send guard**

Send a message that takes time. Before it completes, attempt to send again. Expect: composer disabled (today's behavior). If you force a parallel send, backend returns 409 and the UI shows the toast — confirm.

- [ ] **Step 8: Stage any final fixes from the smoke**

```bash
git add -A
```

---

## Self-Review

**Spec coverage:**
- §1 Decisions 1 (one persistent session per employee) → Tasks 4, 6.
- §1 Decisions 2 (tabs no longer filter transcript) → Task 6 Step 5.
- §1 Decisions 3 (bridged prompt) → Tasks 1, 2.
- §1 Decisions 4 (no schema changes) → respected throughout.
- §Architecture Web → Tasks 4, 5, 6, 7.
- §Architecture Backend (`/assignments` 409 + `/archive`) → Task 3.
- §Architecture relay-core (`buildBridgedPrompt`) → Task 1, integrated in Task 2.
- §Edge cases (run in flight, failed prior, missing active id, archived session) → covered by Tasks 3, 4, 6.
- §Testing (relay-core, backend, web) → Tasks 1, 3, 4, 6 + Task 8 smoke.

**Placeholder scan:** Some tasks (Task 2, Task 5, Task 7) ask the engineer to locate an exact line via `grep` before editing, because the relevant code's precise location is not pinned in the spec and re-discovery is faster than guessing. Each such step gives the exact grep command, the symbol to find, and the edit shape. This is intentional, not a placeholder.

**Type consistency:** `pickInitialActiveSessionId` / `useActiveSession` / `chooseSendAction` / `appendAssignment` / `archiveSession` / `buildBridgedPrompt` names are used consistently across tasks 1–7. `SessionLike`/`RelaySession`/`AgentName`/`AssignmentMode` names follow existing `relay-core` and `web/src/types.ts` conventions; if these names differ in the actual files, the engineer should match local names rather than introduce new ones.

**Commit cadence:** Per the user's global rule "Do NOT create git commit," each task ends with `git add` only, not `git commit`. The user will commit on their own cadence.
