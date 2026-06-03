import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type AgentState,
  buildPiImplementCommand,
  buildPiPreflightCommand,
  claudeTaskPrompt,
  classifyCodexReview,
  ClaudeStreamRenderer,
  CodexStreamRenderer,
  extractCodexFeedback,
  formatClaudeJsonLine,
  formatCodexJsonLine,
  guestAgentEnv,
  guestPiAuthJson,
  guestPiModelsJson,
  JsonLineRenderer,
  piTaskPrompt,
  PlainTextStreamRenderer,
  routeClaudeHandoff,
  routeCodexHandoff,
  routePiHandoff,
  StderrLineRenderer,
} from "../src/orchestrator.js";

function codexStdout(message: string): string {
  return JSON.stringify({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: message,
    },
  });
}

function state(overrides: Partial<AgentState> = {}): AgentState {
  return {
    task_goal: "task",
    agent_logs: [],
    last_exit_code: 0,
    claude_failures: 0,
    pi_failures: 0,
    codex_failures: 0,
    codex_verdict: "",
    codex_feedback: "",
    ...overrides,
  };
}

function withEnv<T>(env: NodeJS.ProcessEnv, fn: () => T): T {
  const oldEnv = process.env;
  process.env = { ...env };
  try {
    return fn();
  } finally {
    process.env = oldEnv;
  }
}

describe("Codex review parsing", () => {
  it("routes rejected zero-exit verdict to Claude", () => {
    const feedback = extractCodexFeedback(
      codexStdout("Blocking issue found.\nORCHESTRIX_REVIEW_VERDICT: REJECTED"),
    );

    assert.equal(classifyCodexReview(0, feedback), "rejected");
    assert.equal(routeCodexHandoff(state({ codex_verdict: "rejected", codex_feedback: feedback })), "claude_implement");
  });

  it("routes approved verdict to end", () => {
    const feedback = extractCodexFeedback(codexStdout("Looks good.\nORCHESTRIX_REVIEW_VERDICT: APPROVED"));

    assert.equal(classifyCodexReview(0, feedback), "approved");
    assert.equal(routeCodexHandoff(state({ codex_verdict: "approved", codex_feedback: feedback })), "__end__");
  });

  it("retries Codex runtime failure instead of Claude", () => {
    assert.equal(classifyCodexReview(1, "auth failed"), "failed");
    assert.equal(
      routeCodexHandoff(state({ last_exit_code: 1, codex_failures: 1, codex_verdict: "failed", codex_feedback: "auth failed" })),
      "codex_review",
    );
  });
});

describe("prompts", () => {
  it("Claude prompt includes Codex feedback", () => {
    const prompt = claudeTaskPrompt(
      state({
        task_goal: "Fix auth",
        codex_verdict: "rejected",
        codex_feedback: "Token expiry is not checked.",
      }),
    );

    assert.match(prompt, /Fix auth/);
    assert.match(prompt, /Token expiry is not checked\./);
  });

  it("Pi prompt includes Codex feedback", () => {
    const prompt = piTaskPrompt(
      state({
        task_goal: "Fix auth",
        codex_verdict: "rejected",
        codex_feedback: "Token expiry is not checked.",
      }),
    );

    assert.match(prompt, /Fix auth/);
    assert.match(prompt, /current implementation/);
    assert.match(prompt, /Token expiry is not checked\./);
  });
});

describe("agent stream rendering", () => {
  it("renders Claude stream-json text without raw JSON", () => {
    const renderer = new ClaudeStreamRenderer();
    const output = renderer.feed(
      [
        JSON.stringify({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Implemented auth." },
          },
        }),
        JSON.stringify({ type: "result", is_error: false }),
      ].join("\n") + "\n",
    );

    assert.match(output, /Claude \| Implemented auth\./);
    assert.match(output, /Claude finished/);
    assert.doesNotMatch(output, /\{"type":"stream_event"/);
  });

  it("renders Codex json events without raw JSON", () => {
    const renderer = new CodexStreamRenderer();
    const output = renderer.feed(
      [
        JSON.stringify({ type: "turn.started" }),
        codexStdout("Looks good.\nORCHESTRIX_REVIEW_VERDICT: APPROVED"),
        JSON.stringify({ type: "turn.completed" }),
      ].join("\n") + "\n",
    );

    assert.match(output, /Codex is reviewing/);
    assert.match(output, /Codex \| Looks good/);
    assert.match(output, /Codex finished/);
    assert.doesNotMatch(output, /\{"type":"item.completed"/);
  });

  it("buffers partial JSON lines before rendering", () => {
    const renderer = new JsonLineRenderer(formatCodexJsonLine);
    const line = codexStdout("Buffered review.");

    assert.equal(renderer.feed(line.slice(0, 12)), "");
    const output = renderer.feed(`${line.slice(12)}\n`);

    assert.match(output, /Buffered review\./);
    assert.doesNotMatch(output, /\{"type":"item.completed"/);
  });

  it("renders Pi plain text chunks with a stable stream prefix", () => {
    const renderer = new PlainTextStreamRenderer("Pi", "");
    const output = renderer.feed("First chunk") + renderer.feed(" continues\nNext line\n");

    assert.match(output, /Pi \| First chunk continues/);
    assert.match(output, /Pi \| Next line/);
  });

  it("filters noisy seccomp stderr warnings", () => {
    const renderer = new StderrLineRenderer();
    const output = renderer.feed(
      "2026-06-03T14:06:38.981712Z  WARN libcontainer::process::init::process: seccomp not available, unable to set seccomp privileges!\n",
    );

    assert.equal(output, "");
  });
});

describe("handoff routing", () => {
  it("routes Claude success to Pi", () => {
    assert.equal(routeClaudeHandoff(state()), "pi_implement");
  });

  it("routes Pi success to Codex review", () => {
    assert.equal(routePiHandoff(state()), "codex_review");
  });

  it("retries Pi failure", () => {
    assert.equal(routePiHandoff(state({ last_exit_code: 1, pi_failures: 1 })), "pi_implement");
  });
});

describe("Pi provider config", () => {
  it("generates Pi provider config from OpenAI-compatible env", () => {
    withEnv(
      {
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: "https://api.example.com/v1",
        OPENAI_MODEL: "test-model",
      },
      () => {
        const auth = JSON.parse(guestPiAuthJson());
        const models = JSON.parse(guestPiModelsJson());
        const command = buildPiImplementCommand(state());
        const preflight = buildPiPreflightCommand();

        assert.ok("openai" in auth);
        const provider = models.providers.openai;
        assert.equal(provider.baseUrl, "https://api.example.com/v1");
        assert.equal(provider.apiKey, "$PI_API_KEY");
        assert.equal(provider.api, "openai-completions");
        assert.equal(provider.authHeader, true);
        assert.equal(provider.compat.maxTokensField, "max_tokens");
        assert.equal(provider.compat.supportsDeveloperRole, false);
        assert.equal(provider.compat.supportsStore, false);
        assert.equal(provider.models[0].id, "test-model");
        assert.match(command, /PI_CODING_AGENT_DIR=\/home\/agent\/.pi\/agent/);
        assert.match(command, /--provider openai/);
        assert.match(command, /--model test-model/);
        assert.match(command, /--print-streaming/);
        assert.match(command, / -P /);
        assert.match(command, / -p /);
        assert.match(command, /if pi --help/);
        assert.match(preflight, /pi --list-models/);
        assert.match(preflight, /openai test-model/);
      },
    );
  });

  it("uses native Minimax provider for known OpenAI env", () => {
    withEnv(
      {
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: "https://api.minimaxi.com/v1",
        OPENAI_MODEL: "MiniMax-M2.7",
      },
      () => {
        const auth = JSON.parse(guestPiAuthJson());
        const models = JSON.parse(guestPiModelsJson());
        const command = buildPiImplementCommand(state());
        const preflight = buildPiPreflightCommand();

        assert.equal(auth["minimax-cn"].key, "test-key");
        assert.deepEqual(models, { providers: {} });
        assert.match(command, /--provider minimax-cn/);
        assert.match(command, /--model MiniMax-M2\.7/);
        assert.match(preflight, /pi --list-models/);
        assert.match(preflight, /minimax-cn MiniMax-M2\.7/);
      },
    );
  });

  it("PI env overrides OpenAI env", () => {
    withEnv(
      {
        OPENAI_API_KEY: "openai-key",
        OPENAI_BASE_URL: "https://api.openai-compatible.com/v1",
        OPENAI_MODEL: "openai-model",
        PI_API_KEY: "pi-key",
        PI_BASE_URL: "https://pi.example.com/v1",
        PI_MODEL: "pi-model",
      },
      () => {
        const auth = JSON.parse(guestPiAuthJson());
        const provider = JSON.parse(guestPiModelsJson()).providers.openai;

        assert.equal(auth.openai.key, "pi-key");
        assert.equal(provider.baseUrl, "https://pi.example.com/v1");
        assert.equal(provider.models[0].id, "pi-model");
      },
    );
  });

  it("generates Anthropic-compatible Pi provider config", () => {
    withEnv(
      {
        PI_API_KEY: "pi-key",
        PI_BASE_URL: "https://api.example.com/anthropic",
        PI_MODEL: "claude-compatible",
        PI_PROVIDER: "anthropic",
      },
      () => {
        const auth = JSON.parse(guestPiAuthJson());
        const provider = JSON.parse(guestPiModelsJson()).providers.anthropic;
        const command = buildPiImplementCommand(state());

        assert.equal(auth.anthropic.key, "pi-key");
        assert.equal(provider.api, "anthropic-messages");
        assert.equal(provider.baseUrl, "https://api.example.com/anthropic");
        assert.equal("authHeader" in provider, false);
        assert.match(command, /--provider anthropic/);
        assert.match(command, /--model claude-compatible/);
      },
    );
  });

  it("derives guest Pi API key from OpenAI key", () => {
    withEnv(
      {
        OPENAI_API_KEY: "openai-key",
        OPENAI_BASE_URL: "https://api.example.com/v1",
        OPENAI_MODEL: "test-model",
      },
      () => {
        const guestEnv = guestAgentEnv();
        assert.ok(guestEnv.some(([key, value]) => key === "PI_API_KEY" && value === "openai-key"));
      },
    );
  });
});
