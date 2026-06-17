# Agent Turn Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured, bounded turn summaries to `AgentState` so that when multiple agents run in one employee session, each subsequent agent sees a concise summary of prior agents’ work in its prompt.

**Architecture:** Extend `AgentState` with an `agent_turn_summaries` array. After each `runAgentNode` completes, derive a deterministic tail-summary from `stdout`/`stderr` and append it. Update all prompt builders to inject a “Previous agent context” section. Extend the daemon `run.completed` event and Python backend to forward and merge summaries across daemon-node runs.

**Tech Stack:** TypeScript/Node.js (`relay-core`, `relay-daemon`), Python/FastAPI (`backend/relay`), `node --test`, `pytest`.

---

## File structure

- `packages/relay-core/src/state.ts` — add `AgentTurnSummary` type and field; update `initialAgentState` / `mergeAgentState`.
- `packages/relay-core/src/nodes.ts` — add `summarizeAgentRun`; return summary patch from `runAgentNode`.
- `packages/relay-core/src/prompts.ts` — add `formatAgentTurnSummaries`; append to task prompts.
- `packages/relay-core/src/daemon-node-protocol.ts` — add optional `agentTurnSummaries` to `run.completed`.
- `packages/relay-daemon/src/index.ts` — send `agentTurnSummaries` in `run.completed`.
- `backend/relay/controller.py` — mirror state fields; merge summaries in `record_agent_completed`.
- `backend/relay/daemon.py` — forward summaries from daemon events into `record_agent_completed`.
- `packages/relay-core/tests/handoff.test.ts` — add tests for summaries and prompt injection.
- `backend/tests/` — add/update tests for controller and daemon summary forwarding.

---

## Task 1: Extend TypeScript `AgentState`

**Files:**
- Modify: `packages/relay-core/src/state.ts`
- Test: `packages/relay-core/tests/handoff.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/relay-core/tests/handoff.test.ts` inside the existing `describe("handoff routing", ...)` block or a new adjacent `describe` block:

```ts
describe("agent turn summaries", () => {
  it("mergeAgentState concatenates agent_turn_summaries", () => {
    const base = state({
      agent_turn_summaries: [{ agent: "claude", mode: "implement", status: "completed", exitCode: 0, summary: "first" }],
    });
    const next = mergeAgentState(base, {
      agent_turn_summaries: [{ agent: "pi", mode: "implement", status: "failed", exitCode: 1, summary: "second" }],
    });

    assert.equal(next.agent_turn_summaries.length, 2);
    assert.equal(next.agent_turn_summaries[0].agent, "claude");
    assert.equal(next.agent_turn_summaries[1].agent, "pi");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/feihe/Workspace/Relay && npm run build -w relay-core
node --test dist/packages/relay-core/tests/handoff.test.js
```

Expected: FAIL with `Property 'agent_turn_summaries' is missing in type ...` or similar type error during build, or runtime error on the missing field.

- [ ] **Step 3: Implement the `AgentState` extension**

In `packages/relay-core/src/state.ts` and the test helper in `packages/relay-core/tests/handoff.test.ts`:

First update the test helper `state()` so existing tests continue to compile:

```ts
function state(overrides: Partial<AgentState> = {}): AgentState {
  return {
    task_goal: "task",
    agent_logs: [],
    agent_turn_summaries: [],
    last_exit_code: 0,
    agent_failures: {},
    review_verdict: "",
    review_feedback: "",
    ...overrides,
  };
}
```

Then in `packages/relay-core/src/state.ts`:

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

Update `initialAgentState`:

```ts
export function initialAgentState(taskGoal: string): AgentState {
  return {
    task_goal: taskGoal,
    agent_logs: [],
    agent_turn_summaries: [],
    last_exit_code: 0,
    agent_failures: {},
    review_verdict: "",
    review_feedback: "",
  };
}
```

Update `mergeAgentState`:

```ts
export function mergeAgentState(state: AgentState, patch: Partial<AgentState>): AgentState {
  return {
    ...state,
    ...patch,
    agent_logs: [...state.agent_logs, ...(patch.agent_logs ?? [])],
    agent_turn_summaries: [...state.agent_turn_summaries, ...(patch.agent_turn_summaries ?? [])],
    agent_failures: { ...state.agent_failures, ...(patch.agent_failures ?? {}) },
  };
}
```

Export `AgentTurnSummary` from `packages/relay-core/src/index.ts` by adding `type AgentTurnSummary` to the re-export from `./state.js`.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd /Users/feihe/Workspace/Relay && npm run build -w relay-core
node --test dist/packages/relay-core/tests/handoff.test.js
```

Expected: the new test passes; existing tests in the file still pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/feihe/Workspace/Relay
git add packages/relay-core/src/state.ts packages/relay-core/src/index.ts packages/relay-core/tests/handoff.test.ts
git commit -m "feat(relay-core): add agent_turn_summaries to AgentState"
```

---

## Task 2: Add `summarizeAgentRun` helper

**Files:**
- Modify: `packages/relay-core/src/nodes.ts`
- Test: `packages/relay-core/tests/handoff.test.ts`

- [ ] **Step 1: Write the failing test**

Add `summarizeAgentRun` to the existing `import { ... } from "../src/index.js"` block at the top of `packages/relay-core/tests/handoff.test.ts`.

Add to `packages/relay-core/tests/handoff.test.ts` inside the `agent turn summaries` describe block:

```ts
  it("summarizes a completed run with stdout tail", () => {
    const summary = summarizeAgentRun("claude", "implement", "completed", 0, "line1\nline2 final output", "", 30);
    assert.match(summary, /Claude Code completed \(exit 0\)/);
    assert.match(summary, /line2 final output/);
    assert.ok(summary.length <= 120);
  });

  it("skips empty stdout and stderr", () => {
    const summary = summarizeAgentRun("pi", "implement", "completed", 0, "", "", 30);
    assert.match(summary, /Pi completed \(exit 0\)/);
    assert.doesNotMatch(summary, /stdout/);
    assert.doesNotMatch(summary, /stderr/);
  });

  it("marks failed runs", () => {
    const summary = summarizeAgentRun("codex", "implement", "failed", 1, "", "error here", 30);
    assert.match(summary, /Codex Implement failed \(exit 1\)/);
    assert.match(summary, /error here/);
  });

  it("marks cancelled runs", () => {
    const summary = summarizeAgentRun("kimi", "implement", "cancelled", 130, "partial", "", 30);
    assert.match(summary, /Kimi cancelled \(exit 130\)/);
    assert.match(summary, /partial/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/feihe/Workspace/Relay && npm run build -w relay-core
node --test dist/packages/relay-core/tests/handoff.test.js
```

Expected: FAIL with `summarizeAgentRun is not defined` or build error for missing export.

- [ ] **Step 3: Implement `summarizeAgentRun`**

In `packages/relay-core/src/nodes.ts`, add after the imports and before `runAgentNode`:

```ts
export function summarizeAgentRun(
  agent: AgentName,
  mode: AgentTaskMode,
  status: "completed" | "failed" | "cancelled",
  exitCode: number,
  stdout: string,
  stderr: string,
  maxLength = 500,
): string {
  const def = getAgent(agent);
  const label = mode === "review" ? def.reviewLabel : def.implementLabel;
  const parts: string[] = [`${label} ${status} (exit ${exitCode}).`];
  const stdoutTail = stdout.trim().slice(-maxLength);
  const stderrTail = stderr.trim().slice(-maxLength);
  if (stdoutTail) {
    parts.push(`stdout (last ${maxLength} chars):\n${stdoutTail}`);
  }
  if (stderrTail) {
    parts.push(`stderr (last ${maxLength} chars):\n${stderrTail}`);
  }
  return parts.join("\n");
}
```

Export it from `packages/relay-core/src/index.ts` by updating the `./nodes.js` re-export block:

```ts
export {
  claudeImplementNode,
  codexImplementNode,
  piImplementNode,
  runAgentNode,
  summarizeAgentRun,
} from "./nodes.js";
```

Also ensure `type AgentTurnSummary` is re-exported from `./state.js` in `index.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd /Users/feihe/Workspace/Relay && npm run build -w relay-core
node --test dist/packages/relay-core/tests/handoff.test.js
```

Expected: all new summary tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/feihe/Workspace/Relay
git add packages/relay-core/src/nodes.ts packages/relay-core/src/index.ts packages/relay-core/tests/handoff.test.ts
git commit -m "feat(relay-core): add summarizeAgentRun helper"
```

---

## Task 3: Return summary from `runAgentNode`

**Files:**
- Modify: `packages/relay-core/src/nodes.ts`
- Test: `packages/relay-core/tests/handoff.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/relay-core/tests/handoff.test.ts`:

```ts
  it("runAgentNode appends a turn summary", async () => {
    const patch = await runAgentNode("claude", "implement", state({ task_goal: "Fix auth" }), {
      sink: () => undefined,
      execStream: async () => ({ exit_code: 0, stdout: "auth fixed", stderr: "" }),
    });

    assert.ok(patch.agent_turn_summaries);
    assert.equal(patch.agent_turn_summaries?.length, 1);
    assert.equal(patch.agent_turn_summaries?.[0].agent, "claude");
    assert.equal(patch.agent_turn_summaries?.[0].status, "completed");
    assert.match(patch.agent_turn_summaries?.[0].summary ?? "", /auth fixed/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/feihe/Workspace/Relay && npm run build -w relay-core
node --test dist/packages/relay-core/tests/handoff.test.js
```

Expected: FAIL because `runAgentNode` does not return `agent_turn_summaries`.

- [ ] **Step 3: Update `runAgentNode` to return summary patch**

In `packages/relay-core/src/nodes.ts`, modify the review branch:

```ts
  if (reviewMode) {
    const feedback = extractReviewFeedback(result.stdout);
    const verdict = classifyReview(result.exit_code, feedback);
    const status = options.signal?.aborted ? "cancelled" : result.exit_code === 0 ? "completed" : "failed";
    const summary = summarizeAgentRun(agent, mode, status, result.exit_code, result.stdout, result.stderr);
    return {
      agent_logs: [agentResultLog(def.reviewLabel, result, 4000)],
      last_exit_code: result.exit_code,
      agent_failures: withFailure(state, agent, verdict === "failed"),
      agent_turn_summaries: [{ agent, mode, status, exitCode: result.exit_code, summary }],
      review_verdict: verdict,
      review_feedback: feedback,
    };
  }
```

And the implement branch:

```ts
  const status = options.signal?.aborted ? "cancelled" : result.exit_code === 0 ? "completed" : "failed";
  const summary = summarizeAgentRun(agent, mode, status, result.exit_code, result.stdout, result.stderr);
  return {
    agent_logs: [agentResultLog(def.implementLabel, result)],
    last_exit_code: result.exit_code,
    agent_failures: withFailure(state, agent, result.exit_code !== 0),
    agent_turn_summaries: [{ agent, mode, status, exitCode: result.exit_code, summary }],
  };
```

For API symmetry, also update `SessionController.recordAgentCompleted` in `packages/relay-core/src/session-controller.ts` to accept `agentTurnSummaries` in its input object and merge it into `statePatch`:

```ts
    const statePatch: Partial<AgentState> = {
      agent_logs: [input.agentLog],
      last_exit_code: input.exitCode,
      agent_turn_summaries: input.agentTurnSummaries ?? [],
    };
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd /Users/feihe/Workspace/Relay && npm run build -w relay-core
node --test dist/packages/relay-core/tests/handoff.test.js
```

Expected: the new test passes; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/feihe/Workspace/Relay
git add packages/relay-core/src/nodes.ts packages/relay-core/src/session-controller.ts packages/relay-core/tests/handoff.test.ts
git commit -m "feat(relay-core): emit agent turn summary from runAgentNode"
```

---

## Task 4: Inject summaries into prompts

**Files:**
- Modify: `packages/relay-core/src/prompts.ts`
- Test: `packages/relay-core/tests/handoff.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/relay-core/tests/handoff.test.ts` inside the `agent turn summaries` describe block:

```ts
  it("Claude prompt includes prior agent summaries", () => {
    const prompt = claudeTaskPrompt(
      state({
        task_goal: "Fix auth",
        agent_turn_summaries: [
          { agent: "pi", mode: "implement", status: "failed", exitCode: 1, summary: "Pi failed (exit 1).\nstderr (last 500 chars):\ntests failed" },
        ],
      }),
    );

    assert.match(prompt, /Fix auth/);
    assert.match(prompt, /Previous agent context/);
    assert.match(prompt, /Pi failed \(exit 1\)/);
    assert.match(prompt, /tests failed/);
  });

  it("Codex prompt omits summary section when there are no summaries", () => {
    const prompt = codexImplementPrompt(state({ task_goal: "Fix auth" }));

    assert.doesNotMatch(prompt, /Previous agent context/);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/feihe/Workspace/Relay && npm run build -w relay-core
node --test dist/packages/relay-core/tests/handoff.test.js
```

Expected: FAIL because prompt builders do not include summaries.

- [ ] **Step 3: Implement `formatAgentTurnSummaries` and update prompts**

In `packages/relay-core/src/prompts.ts`:

```ts
import type { AgentState, AgentTurnSummary } from "./state.js";

export function formatAgentTurnSummaries(summaries: AgentTurnSummary[]): string {
  if (summaries.length === 0) return "";
  const blocks = summaries.map((item) => item.summary);
  return ["Previous agent context:", "", blocks.join("\n\n")].join("\n");
}

function appendAgentContext(prompt: string, state: AgentState): string {
  const context = formatAgentTurnSummaries(state.agent_turn_summaries);
  if (!context) return prompt;
  return `${prompt}\n\n${context}`;
}
```

Update each task prompt:

```ts
export function reviewPrompt(state: AgentState): string {
  return appendAgentContext([
    "Review the current workspace changes for the user's task.",
    // ... existing lines ...
    state.task_goal,
  ].join("\n"), state);
}

export function codexImplementPrompt(state: AgentState): string {
  return appendAgentContext(appendReviewFeedback(state.task_goal, state), state);
}

export function claudeTaskPrompt(state: AgentState): string {
  return appendAgentContext(appendReviewFeedback(state.task_goal, state), state);
}

export function piTaskPrompt(state: AgentState): string {
  return appendAgentContext(appendReviewFeedback(state.task_goal, state), state);
}

export function kimiTaskPrompt(state: AgentState): string {
  return appendAgentContext(appendReviewFeedback(state.task_goal, state), state);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd /Users/feihe/Workspace/Relay && npm run build -w relay-core
node --test dist/packages/relay-core/tests/handoff.test.js
```

Expected: prompt tests pass; existing prompt tests still pass (note: some existing assertions use `assert.doesNotMatch(prompt, /current implementation/)` which should still hold because we are not adding that phrase).

- [ ] **Step 5: Commit**

```bash
cd /Users/feihe/Workspace/Relay
git add packages/relay-core/src/prompts.ts packages/relay-core/tests/handoff.test.ts
git commit -m "feat(relay-core): inject agent turn summaries into prompts"
```

---

## Task 5: Extend daemon protocol for summaries

**Files:**
- Modify: `packages/relay-core/src/daemon-node-protocol.ts`

- [ ] **Step 1: Implement the protocol change**

In `packages/relay-core/src/daemon-node-protocol.ts`, add to the `run.completed` event:

```ts
  | {
      type: "run.completed";
      commandId: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      mode: AgentTaskMode;
      exitCode: number;
      agentLog: string;
      reviewVerdict?: ReviewVerdict | "";
      reviewFeedback?: string;
      agentTurnSummaries?: AgentTurnSummary[];
    }
```

Ensure `AgentTurnSummary` is imported from `./state.js`.

- [ ] **Step 2: Build and typecheck**

Run:

```bash
cd /Users/feihe/Workspace/Relay && npm run build --workspace=packages/relay-core
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/feihe/Workspace/Relay
git add packages/relay-core/src/daemon-node-protocol.ts
git commit -m "feat(relay-core): add agentTurnSummaries to daemon run.completed event"
```

---

## Task 6: Send summaries from the daemon

**Files:**
- Modify: `packages/relay-daemon/src/index.ts`

- [ ] **Step 1: Update `executeCommand`**

In `packages/relay-daemon/src/index.ts`, locate the `run.completed` post:

```ts
  await postJsonWithRetry(fetchFn, eventUrl, {
    type: "run.completed",
    commandId: command.id,
    sessionId: command.sessionId,
    runId: command.runId,
    agent: command.agent,
    mode: command.mode,
    exitCode: next.last_exit_code,
    agentLog: next.agent_logs.slice(-1)[0] ?? "",
    reviewVerdict: next.review_verdict,
    reviewFeedback: next.review_feedback,
    agentTurnSummaries: patch.agent_turn_summaries ?? [],
  } satisfies DaemonNodeEvent, token, signal);
```

- [ ] **Step 2: Build and typecheck**

Run:

```bash
cd /Users/feihe/Workspace/Relay && npm run build -w relay-daemon
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/feihe/Workspace/Relay
git add packages/relay-daemon/src/index.ts
git commit -m "feat(relay-daemon): forward agent turn summaries on run.completed"
```

---

## Task 7: Mirror state changes in Python backend

**Files:**
- Modify: `backend/relay/controller.py`
- Test: `backend/tests/test_controller.py` (or nearest existing controller test)

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_controller.py`, add:

```python
import pytest
from relay.controller import initial_agent_state, merge_agent_state, SessionController

def test_merge_agent_state_concatenates_summaries():
    base = initial_agent_state("Fix auth")
    base["agent_turn_summaries"] = [
        {"agent": "claude", "mode": "implement", "status": "completed", "exitCode": 0, "summary": "first"}
    ]
    patch = {
        "agent_turn_summaries": [
            {"agent": "pi", "mode": "implement", "status": "failed", "exitCode": 1, "summary": "second"}
        ]
    }
    next_state = merge_agent_state(base, patch)
    assert len(next_state["agent_turn_summaries"]) == 2
    assert next_state["agent_turn_summaries"][0]["agent"] == "claude"
    assert next_state["agent_turn_summaries"][1]["agent"] == "pi"
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/feihe/Workspace/Relay && UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/test_controller.py::test_merge_agent_state_concatenates_summaries -v
```

Expected: FAIL because `agent_turn_summaries` is not in state.

- [ ] **Step 3: Update Python state functions**

In `backend/relay/controller.py`:

```python
def initial_agent_state(task_goal: str) -> dict[str, Any]:
    return {
        "task_goal": task_goal,
        "agent_logs": [],
        "agent_turn_summaries": [],
        "last_exit_code": 0,
        "agent_failures": {},
        "review_verdict": "",
        "review_feedback": "",
    }


def merge_agent_state(state: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    return {
        **state,
        **patch,
        "agent_logs": [*state.get("agent_logs", []), *patch.get("agent_logs", [])],
        "agent_turn_summaries": [*state.get("agent_turn_summaries", []), *patch.get("agent_turn_summaries", [])],
        "agent_failures": {**state.get("agent_failures", {}), **patch.get("agent_failures", {})},
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd /Users/feihe/Workspace/Relay && UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/test_controller.py::test_merge_agent_state_concatenates_summaries -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/feihe/Workspace/Relay
git add backend/relay/controller.py backend/tests/test_controller.py
git commit -m "feat(backend): add agent_turn_summaries to Python AgentState"
```

---

## Task 8: Merge summaries in `record_agent_completed`

**Files:**
- Modify: `backend/relay/controller.py`
- Test: `backend/tests/test_controller.py`

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_controller.py`:

```python
def test_record_agent_completed_merges_turn_summaries(tmp_path):
    store = LocalSessionStore(str(tmp_path))
    controller = SessionController(store, workspace_path=str(tmp_path))
    session = controller.create_session("Fix auth", ["human", "claude", "pi"])
    state = initial_agent_state("Fix auth")
    state["agent_turn_summaries"] = [
        {"agent": "claude", "mode": "implement", "status": "completed", "exitCode": 0, "summary": "first"}
    ]
    next_state = controller.record_agent_completed(
        session["id"],
        state,
        {
            "runId": "run_1",
            "agent": "pi",
            "mode": "implement",
            "status": "failed",
            "exitCode": 1,
            "agentLog": "tests failed",
            "agent_turn_summaries": [
                {"agent": "pi", "mode": "implement", "status": "failed", "exitCode": 1, "summary": "second"}
            ],
        },
    )
    assert len(next_state["agent_turn_summaries"]) == 2
    assert next_state["agent_turn_summaries"][1]["agent"] == "pi"
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/feihe/Workspace/Relay && UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/test_controller.py::test_record_agent_completed_merges_turn_summaries -v
```

Expected: FAIL because `record_agent_completed` ignores `agent_turn_summaries`.

- [ ] **Step 3: Update `record_agent_completed`**

In `backend/relay/controller.py`, modify the `state_patch` construction:

```python
    def record_agent_completed(self, session_id: str, state: dict[str, Any], input: dict[str, Any]) -> dict[str, Any]:
        logger.info("Agent run completed", ...)
        state_patch = {
            "agent_logs": [input.get("agentLog", "")],
            "last_exit_code": input["exitCode"],
            "agent_turn_summaries": input.get("agent_turn_summaries", []),
        }
        if is_review_assignment(input["mode"]):
            state_patch["review_verdict"] = input.get("reviewVerdict", "")
            state_patch["review_feedback"] = input.get("reviewFeedback", "")
        # ... rest unchanged ...
        return merge_agent_state(state, state_patch)
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd /Users/feihe/Workspace/Relay && UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/test_controller.py::test_record_agent_completed_merges_turn_summaries -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/feihe/Workspace/Relay
git add backend/relay/controller.py backend/tests/test_controller.py
git commit -m "feat(backend): merge agent_turn_summaries in record_agent_completed"
```

---

## Task 9: Forward summaries in daemon orchestration

**Files:**
- Modify: `backend/relay/daemon.py`
- Test: `backend/tests/test_daemon.py` (or nearest existing daemon registry test)

- [ ] **Step 1: Update `_advance_run_request`**

In `backend/relay/daemon.py`, locate the `record_agent_completed` call inside `_advance_run_request` and pass summaries:

```python
        next_state = controller.record_agent_completed(run_request["sessionId"], state, {
            "runId": event["runId"],
            "agent": event["agent"],
            "mode": mode,
            "status": "completed" if event["exitCode"] == 0 else "failed",
            "exitCode": event["exitCode"],
            "agentLog": agent_log,
            "reviewVerdict": event.get("reviewVerdict", ""),
            "reviewFeedback": event.get("reviewFeedback", ""),
            "agent_turn_summaries": event.get("agentTurnSummaries", []),
        })
```

- [ ] **Step 2: Write a test for forwarding**

In `backend/tests/unit/test_daemon_registry.py`, add an async test following the existing pattern:

```python
import asyncio
from relay.daemon import DaemonNodeRegistry, ServerDaemonNodeBackend
from relay.stores import LocalDaemonStore, LocalSessionStore
from relay.controller import initial_agent_state


def test_advance_run_request_forwards_agent_turn_summaries():
    async def run_flow() -> None:
        with TemporaryDirectory() as root:
            session_store = LocalSessionStore(root)
            daemon_store = LocalDaemonStore(root)
            registry = DaemonNodeRegistry(session_store, daemon_store)
            backend = ServerDaemonNodeBackend(registry)
            registry.register({
                "sandboxId": "sbx_alice",
                "employeeId": "alice",
                "token": "node_token",
                "workspacePath": "/workspace/alice",
                "protocolVersion": 1,
                "supportedAgents": ["claude", "pi"],
                "status": "ready",
            }, "ui_token")

            session = await backend.run("sbx_alice", {
                "taskGoal": "Fix auth",
                "assignments": [
                    {"agent": "claude", "mode": "implement"},
                    {"agent": "pi", "mode": "implement"},
                ],
            })
            [command] = registry.take_commands("sbx_alice", "node_token")
            registry.handle_event("sbx_alice", {
                "type": "run.completed",
                "commandId": command["id"],
                "sessionId": command["sessionId"],
                "runId": command["runId"],
                "agent": "claude",
                "mode": "implement",
                "exitCode": 0,
                "agentLog": "auth fixed",
                "agentTurnSummaries": [
                    {"agent": "claude", "mode": "implement", "status": "completed", "exitCode": 0, "summary": "auth fixed"}
                ],
            }, "node_token")

            [next_command] = registry.take_commands("sbx_alice", "node_token")
            assert next_command["agent"] == "pi"
            assert next_command["state"]["agent_turn_summaries"][0]["agent"] == "claude"
            assert next_command["state"]["agent_turn_summaries"][0]["summary"] == "auth fixed"

    asyncio.run(run_flow())
```

- [ ] **Step 3: Run the test to verify it passes**

Run:

```bash
cd /Users/feihe/Workspace/Relay && UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_daemon_registry.py::test_advance_run_request_forwards_agent_turn_summaries -v
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/feihe/Workspace/Relay
git add backend/relay/daemon.py backend/tests/unit/test_daemon_registry.py
git commit -m "feat(backend): forward agent turn summaries through daemon orchestration"
```

---

## Task 10: Full TypeScript test run

- [ ] **Step 1: Build all packages**

```bash
cd /Users/feihe/Workspace/Relay && npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 2: Run relay-core tests**

```bash
cd /Users/feihe/Workspace/Relay && node --test dist/packages/relay-core/tests/handoff.test.js
```

Expected: all tests pass.

- [ ] **Step 3: Run TUI tests**

```bash
cd /Users/feihe/Workspace/Relay && node --test dist/packages/relay-tui/tests/tui.test.js
```

Expected: all tests pass (prompt changes should not break rendering).

- [ ] **Step 4: Commit if any fixes were needed**

If no fixes were needed, no commit. If fixes were needed, commit them with a descriptive message.

---

## Task 11: Full Python test run

- [ ] **Step 1: Run backend tests**

```bash
cd /Users/feihe/Workspace/Relay && UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/ -v
```

Expected: all tests pass.

- [ ] **Step 2: Commit if any fixes were needed**

If no fixes were needed, no commit. If fixes were needed, commit them.

---

## Task 12: Final verification and cleanup

- [ ] **Step 1: Re-run full test suites**

```bash
cd /Users/feihe/Workspace/Relay && npm run test:ts
cd /Users/feihe/Workspace/Relay && UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest
```

Expected: all tests pass.

- [ ] **Step 2: Update the design doc status**

In `docs/superpowers/specs/2026-06-16-agent-turn-summaries-design.md`, change:

```markdown
## Status

Implemented.
```

- [ ] **Step 3: Final commit**

```bash
cd /Users/feihe/Workspace/Relay
git add docs/superpowers/specs/2026-06-16-agent-turn-summaries-design.md
git commit -m "docs: mark agent turn summaries spec as implemented"
```

---

## Self-review checklist

- [ ] Spec coverage: every requirement (state field, summary generation, prompt injection, daemon protocol, backend merge/forward, tests) maps to a task.
- [ ] Placeholder scan: no TBD/TODO/fill-in-details; every task has concrete code or commands.
- [ ] Type consistency: `AgentTurnSummary`, `agent_turn_summaries`, `agentTurnSummaries` naming is consistent across TypeScript and Python.
- [ ] Backwards compatibility: daemon event field is optional; Python state default is `[]`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-16-agent-turn-summaries.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach would you like?
