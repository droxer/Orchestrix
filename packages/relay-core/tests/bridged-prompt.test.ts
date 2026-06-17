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
