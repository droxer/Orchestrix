import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  type AgentState,
  BoxLiteExecutionManager,
  buildClaudeImplementCommand,
  buildCodexImplementCommand,
  buildCodexReviewCommand,
  buildPiImplementCommand,
  buildPiPreflightCommand,
  claudeImplementNode,
  claudeTaskPrompt,
  classifyCodexReview,
  ClaudeStreamRenderer,
  collectExecution,
  codexReviewNode,
  codexImplementPrompt,
  codexReviewPrompt,
  CodexStreamRenderer,
  extractCodexFeedback,
  formatClaudeJsonLine,
  formatCodexJsonLine,
  ensureLocalDevboxOci,
  ensureAgentReady,
  resetAgentReadiness,
  type ExecutionManager,
  guestCodexConfigToml,
  guestAgentEnv,
  guestPiAuthJson,
  guestPiModelsJson,
  hostWorkspacePath,
  JsonLineRenderer,
  piTaskPrompt,
  PlainTextStreamRenderer,
  routeClaudeHandoff,
  routeCodexHandoff,
  routePiHandoff,
  StderrLineRenderer,
} from "../packages/relay-daemon/src/index.js";
import { localProcessExecStream } from "../packages/relay-daemon-node/src/index.js";

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

function runShellCommand(command: string, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync("bash", ["-c", command], {
    cwd: env.RELAY_AGENT_WORKSPACE,
    env: env as Record<string, string>,
    encoding: "utf8",
  });
  return {
    exit_code: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    error_message: result.error?.message,
  };
}

function writeFakePi(path: string): void {
  writeFileSync(path, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--help\" ]; then printf '%s\\n' \"$PI_HELP_TEXT\"; exit 0; fi",
    "flag=",
    "for arg in \"$@\"; do",
    "  case \"$arg\" in -P|--print-streaming) flag=streaming ;; -p|--print) flag=print ;; esac",
    "done",
    "printf '%s\\n' \"$flag\"",
    "test -n \"$flag\"",
  ].join("\n"));
  chmodSync(path, 0o755);
}

describe("Codex review parsing", () => {
  it("routes rejected zero-exit verdict to Claude", () => {
    const feedback = extractCodexFeedback(
      codexStdout("Blocking issue found.\nRELAY_REVIEW_VERDICT: REJECTED"),
    );

    assert.equal(classifyCodexReview(0, feedback), "rejected");
    assert.equal(routeCodexHandoff(state({ codex_verdict: "rejected", codex_feedback: feedback })), "claude_implement");
  });

  it("routes approved verdict to end", () => {
    const feedback = extractCodexFeedback(codexStdout("Looks good.\nRELAY_REVIEW_VERDICT: APPROVED"));

    assert.equal(classifyCodexReview(0, feedback), "approved");
    assert.equal(routeCodexHandoff(state({ codex_verdict: "approved", codex_feedback: feedback })), "__end__");
  });

  it("extracts review verdicts from newer Codex assistant message events", () => {
    const feedback = extractCodexFeedback(
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Looks good.\nRELAY_REVIEW_VERDICT: APPROVED" }],
      }) + "\n",
    );

    assert.equal(feedback, "Looks good.\nRELAY_REVIEW_VERDICT: APPROVED");
    assert.equal(classifyCodexReview(0, feedback), "approved");
  });

  it("retries Codex runtime failure instead of Claude", () => {
    assert.equal(classifyCodexReview(1, "auth failed"), "failed");
    assert.equal(
      routeCodexHandoff(state({ last_exit_code: 1, codex_failures: 1, codex_verdict: "failed", codex_feedback: "auth failed" })),
      "codex_review",
    );
  });

  it("does not treat a missing review verdict as success", () => {
    assert.equal(routeCodexHandoff(state({ codex_verdict: "failed", codex_failures: 1 })), "codex_review");
  });

  it("classifies Codex review node output before routing", async () => {
    const stdout = `${codexStdout("Blocking issue found.\nRELAY_REVIEW_VERDICT: REJECTED")}\n`;
    const patch = await codexReviewNode(state({ task_goal: "Fix auth" }), {
      sink: () => undefined,
      execStream: async (cmd, args) => {
        assert.equal(cmd, "bash");
        assert.match(args?.[1] ?? "", /RELAY_REVIEW_VERDICT/);
        return { exit_code: 0, stdout, stderr: "" };
      },
    });

    assert.equal(patch.codex_verdict, "rejected");
    assert.equal(patch.codex_failures, 0);
    assert.match(patch.codex_feedback ?? "", /Blocking issue found/);
    assert.equal(routeCodexHandoff(state(patch)), "claude_implement");
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
    assert.doesNotMatch(prompt, /Read docs\/plan\.md/);
    assert.doesNotMatch(prompt, /Run tests/);
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
    assert.doesNotMatch(prompt, /Read docs\/plan\.md/);
    assert.doesNotMatch(prompt, /current implementation/);
    assert.doesNotMatch(prompt, /run tests/);
    assert.match(prompt, /Token expiry is not checked\./);
  });

  it("Codex implementation prompt does not require a review verdict", () => {
    const prompt = codexImplementPrompt(state({ task_goal: "Fix auth" }));
    const command = buildCodexImplementCommand(state({ task_goal: "Fix auth" }));

    assert.match(prompt, /Fix auth/);
    assert.doesNotMatch(prompt, /Read docs\/plan\.md/);
    assert.doesNotMatch(prompt, /Implement the requested changes/);
    assert.doesNotMatch(prompt, /run tests/);
    assert.doesNotMatch(prompt, /RELAY_REVIEW_VERDICT/);
    assert.match(command, /codex/);
    assert.match(command, /exec/);
    assert.doesNotMatch(command, /RELAY_REVIEW_VERDICT/);
  });

  it("Codex review prompt defines the review contract and verdict marker", () => {
    const prompt = codexReviewPrompt(state({ task_goal: "Review this branch exactly how I asked" }));
    const command = buildCodexReviewCommand(state({ task_goal: "Review this branch exactly how I asked" }));

    assert.match(prompt, /Review this branch exactly how I asked/);
    assert.match(prompt, /blocking bugs/);
    assert.match(prompt, /RELAY_REVIEW_VERDICT: APPROVED/);
    assert.match(prompt, /RELAY_REVIEW_VERDICT: REJECTED/);
    assert.match(command, /Review this branch exactly how I asked/);
    assert.match(command, /RELAY_REVIEW_VERDICT/);
  });

  it("builds Claude command against the daemon node host workspace when configured", () => {
    withEnv({
      RELAY_AGENT_HOME: "/tmp/relay-agent-home",
      RELAY_AGENT_WORKSPACE: "/tmp/relay-host-workspace",
      RELAY_RUN_AS_CURRENT_USER: "1",
    }, () => {
      const command = buildClaudeImplementCommand(state());

      assert.match(command, /export HOME=\/tmp\/relay-agent-home/);
      assert.match(command, /CODEX_HOME=\/tmp\/relay-agent-home\/\.codex/);
      assert.match(command, /PI_CODING_AGENT_DIR=\/tmp\/relay-agent-home\/\.pi\/agent/);
      assert.match(command, /cd \/tmp\/relay-host-workspace/);
      assert.match(command, /--add-dir \/tmp\/relay-host-workspace/);
      assert.doesNotMatch(command, /su agent/);
    });
  });
});

describe("agent failure logging", () => {
  it("includes executor spawn errors in Claude agent logs", async () => {
    const patch = await claudeImplementNode(state(), {
      execStream: async () => ({
        exit_code: -1,
        stdout: "",
        stderr: "",
        error_message: "spawn cwd /workspace ENOENT",
      }),
    });

    assert.equal(patch.last_exit_code, -1);
    assert.match(patch.agent_logs?.[0] ?? "", /spawn cwd \/workspace ENOENT/);
  });
});

describe("agent command invocation", () => {
  it("falls back to Pi -p when pi --help does not advertise streaming print", () => {
    const temp = mkdtempSync(join(tmpdir(), "relay-pi-invoke-"));
    const workspace = mkdtempSync(join(tmpdir(), "relay-pi-workspace-"));
    writeFakePi(join(temp, "pi"));

    withEnv({
      PATH: `${temp}:${process.env.PATH ?? ""}`,
      RELAY_AGENT_HOME: join(temp, "home"),
      RELAY_AGENT_WORKSPACE: workspace,
      RELAY_RUN_AS_CURRENT_USER: "1",
      PI_HELP_TEXT: "Options:\n  --print, -p  Non-interactive mode",
    }, () => {
      const result = runShellCommand(buildPiImplementCommand(state()), process.env);

      assert.equal(result.exit_code, 0, result.stderr || result.error_message);
      assert.equal(result.stdout, "print\n");
    });
  });

  it("uses Pi -P when pi --help advertises streaming print", () => {
    const temp = mkdtempSync(join(tmpdir(), "relay-pi-invoke-"));
    const workspace = mkdtempSync(join(tmpdir(), "relay-pi-workspace-"));
    writeFakePi(join(temp, "pi"));

    withEnv({
      PATH: `${temp}:${process.env.PATH ?? ""}`,
      RELAY_AGENT_HOME: join(temp, "home"),
      RELAY_AGENT_WORKSPACE: workspace,
      RELAY_RUN_AS_CURRENT_USER: "1",
      PI_HELP_TEXT: "Options:\n  --print-streaming, -P  Stream print output",
    }, () => {
      const result = runShellCommand(buildPiImplementCommand(state()), process.env);

      assert.equal(result.exit_code, 0, result.stderr || result.error_message);
      assert.equal(result.stdout, "streaming\n");
    });
  });

  it("invokes Codex exec with JSON output inside the configured agent home and workspace", () => {
    const temp = mkdtempSync(join(tmpdir(), "relay-codex-invoke-"));
    const fakeCodex = join(temp, "codex");
    const workspace = mkdtempSync(join(tmpdir(), "relay-codex-workspace-"));
    const argsPath = join(temp, "codex-args.txt");
    const homePath = join(temp, "codex-home.txt");
    writeFileSync(fakeCodex, [
      "#!/bin/sh",
      "printf '%s\\n' \"$CODEX_HOME\" > \"$CODEX_HOME_OUT\"",
      "printf '%s\\n' \"$@\" > \"$CODEX_ARGS_OUT\"",
      "printf '%s\\n' '{\"type\":\"turn.completed\"}'",
    ].join("\n"));
    chmodSync(fakeCodex, 0o755);

    withEnv({
      PATH: `${temp}:${process.env.PATH ?? ""}`,
      RELAY_AGENT_HOME: join(temp, "home"),
      RELAY_AGENT_WORKSPACE: workspace,
      RELAY_RUN_AS_CURRENT_USER: "1",
      CODEX_ARGS_OUT: argsPath,
      CODEX_HOME_OUT: homePath,
    }, () => {
      const result = runShellCommand(buildCodexImplementCommand(state({ task_goal: "Implement invocation fix" })), process.env);
      const args = readFileSync(argsPath, "utf8").split(/\n/).filter(Boolean);

      assert.equal(result.exit_code, 0, result.stderr || result.error_message);
      assert.equal(readFileSync(homePath, "utf8").trim(), join(temp, "home", ".codex"));
      assert.ok(args.includes("exec"));
      assert.ok(args.includes("--json"));
      assert.ok(args.includes("--skip-git-repo-check"));
      assert.ok(args.includes("--dangerously-bypass-approvals-and-sandbox"));
      assert.equal(args[args.indexOf("-C") + 1], workspace);
      assert.ok(args.indexOf("exec") > args.indexOf(workspace));
      assert.ok(args.indexOf("--json") > args.indexOf("exec"));
      assert.match(args.at(-1) ?? "", /Implement invocation fix/);
    });
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

    assert.match(output, /● Implemented auth\./);
    assert.match(output, /Claude finished/);
    assert.doesNotMatch(output, /\{"type":"stream_event"/);
  });

  it("renders Claude assistant stream-json messages without raw JSON", () => {
    const renderer = new ClaudeStreamRenderer();
    const output = renderer.feed(
      [
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "Implemented the requested daemon fix." },
            ],
          },
        }),
        JSON.stringify({ type: "result", is_error: false }),
      ].join("\n") + "\n",
    );

    assert.match(output, /● Implemented the requested daemon fix\./);
    assert.match(output, /Claude finished/);
    assert.doesNotMatch(output, /\{"type":"assistant"/);
  });

  it("renders Codex json events without raw JSON", () => {
    const renderer = new CodexStreamRenderer();
    const output = renderer.feed(
      [
        JSON.stringify({ type: "turn.started" }),
        codexStdout("Looks good.\nRELAY_REVIEW_VERDICT: APPROVED"),
        JSON.stringify({ type: "turn.completed" }),
      ].join("\n") + "\n",
    );

    assert.match(output, /Codex started/);
    assert.match(output, /● Looks good/);
    assert.match(output, /Codex finished/);
    assert.doesNotMatch(output, /\{"type":"item.completed"/);
  });

  it("renders Codex assistant message content from newer JSON event shapes", () => {
    const renderer = new CodexStreamRenderer();
    const output = renderer.feed(
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "New Codex response shape." }],
      }) + "\n",
    );

    assert.match(output, /● New Codex response shape\./);
    assert.doesNotMatch(output, /\{"type":"message"/);
  });

  it("buffers partial JSON lines before rendering", () => {
    const renderer = new JsonLineRenderer(formatCodexJsonLine);
    const line = codexStdout("Buffered review.");

    assert.equal(renderer.feed(line.slice(0, 12)), "");
    const output = renderer.feed(`${line.slice(12)}\n`);

    assert.match(output, /Buffered review\./);
    assert.doesNotMatch(output, /\{"type":"item.completed"/);
  });

  it("renders Pi plain text chunks with a block marker and indented continuation", () => {
    const renderer = new PlainTextStreamRenderer("Pi", "");
    const output = renderer.feed("First chunk") + renderer.feed(" continues\nNext line\n");

    assert.match(output, /● First chunk continues/);
    assert.match(output, /\n {2}Next line/);
  });

  it("filters noisy seccomp stderr warnings", () => {
    const renderer = new StderrLineRenderer();
    const output = renderer.feed(
      "2026-06-03T14:06:38.981712Z  WARN libcontainer::process::init::process: seccomp not available, unable to set seccomp privileges!\n",
    );

    assert.equal(output, "");
  });
});

describe("execution cancellation", () => {
  it("kills shell child processes when local process execution is cancelled", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "relay-process-cancel-"));
    const marker = join(workspace, "survived.txt");
    const controller = new AbortController();
    const pending = localProcessExecStream("bash", [
      "-c",
      `(sleep 1; printf survived > ${JSON.stringify(marker)}) & wait`,
    ], {
      cwd: workspace,
      signal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort("stop test process");
    const result = await pending;
    await new Promise((resolve) => setTimeout(resolve, 1200));

    assert.notEqual(result.exit_code, 0);
    assert.equal(existsSync(marker), false);
  });

  it("kills the active BoxLite execution when aborted", async () => {
    const controller = new AbortController();
    let killed = false;
    const execution = {
      stdout: async () => ({
        next: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return null;
        },
      }),
      stderr: async () => ({
        next: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return null;
        },
      }),
      wait: async () => ({ exitCode: killed ? 143 : 0 }),
      kill: async () => {
        killed = true;
      },
    };

    setTimeout(() => controller.abort(), 1);
    const result = await collectExecution(execution, false, undefined, undefined, undefined, controller.signal);

    assert.equal(killed, true);
    assert.equal(result.error_message, "Execution cancelled.");
  });
});

describe("devbox OCI preparation", () => {
  it("builds and exports the devbox when the local Docker image is missing", () => {
    const temp = mkdtempSync(join(tmpdir(), "relay-devbox-"));
    const dockerfile = join(temp, "dockerfile");
    const ociLayoutDir = join(temp, "oci");
    const calls: string[] = [];
    let imageExists = false;

    writeFileSync(dockerfile, "FROM scratch\n");
    const runCommand = ((command: string, args: string[]) => {
      calls.push([command, ...args].join(" "));
      if (command === "docker" && args[0] === "image" && args[1] === "inspect" && args.includes("--format")) {
        return { status: imageExists ? 0 : 1, stdout: imageExists ? "sha256:test\n" : "", stderr: "" };
      }
      if (command === "docker" && args[0] === "image" && args[1] === "inspect") {
        return { status: imageExists ? 0 : 1, stdout: "", stderr: "" };
      }
      if (command === "make" && args[0] === "devbox-oci") {
        imageExists = true;
        return { status: 0, stdout: "", stderr: "" };
      }
      if (command === "sh") {
        writeFileSync(join(ociLayoutDir, "oci-layout"), "{}\n");
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unexpected command" };
    }) as any;

    assert.equal(ensureLocalDevboxOci(undefined, { dockerfile, ociLayoutDir, runCommand }), ociLayoutDir);
    assert.equal(calls.includes("make devbox-oci"), true);
    assert.equal(existsSync(join(ociLayoutDir, ".docker-image-id")), true);
  });

  it("reports a build failure when the missing Docker image cannot be created", () => {
    const temp = mkdtempSync(join(tmpdir(), "relay-devbox-"));
    const dockerfile = join(temp, "dockerfile");
    const ociLayoutDir = join(temp, "oci");
    writeFileSync(dockerfile, "FROM scratch\n");

    const runCommand = ((command: string, args: string[]) => {
      if (command === "docker" && args[0] === "image" && args[1] === "inspect") {
        return { status: 1, stdout: "", stderr: "" };
      }
      if (command === "make" && args[0] === "devbox-oci") {
        return { status: 2, stdout: "", stderr: "build failed" };
      }
      return { status: 1, stdout: "", stderr: "unexpected command" };
    }) as any;

    assert.throws(
      () => ensureLocalDevboxOci(undefined, { dockerfile, ociLayoutDir, runCommand }),
      /Failed to build local devbox image/,
    );
  });
});

describe("execution manager boundary", () => {
  it("recreates a stale BoxLite sandbox through the execution boundary", async () => {
    const manager = new BoxLiteExecutionManager();
    const box = { id: "box" };
    const calls: string[] = [];
    const runtime = {
      getOrCreate: async () => {
        calls.push("getOrCreate");
        if (!calls.includes("remove")) throw new Error("box with name relay already exists");
        return { box };
      },
      remove: async (name: string, force: boolean) => {
        calls.push("remove");
        assert.equal(name, "relay");
        assert.equal(force, true);
      },
    };

    const sandbox = await manager.createSandbox(runtime, {
      rootfsPath: "/tmp/rootfs",
      boxName: "relay",
      volumes: [],
      env: [],
      workingDir: "/workspace",
      autoRemove: true,
    });

    assert.equal(sandbox.name, "relay");
    assert.equal(sandbox.raw, box);
    assert.deepEqual(calls, ["getOrCreate", "remove", "getOrCreate"]);
  });

  it("runs agent readiness through the execution manager", async () => {
    resetAgentReadiness();
    const calls: string[] = [];
    const manager: ExecutionManager = {
      ensureImage: () => "/tmp/rootfs",
      createSandbox: async () => ({ name: "relay", raw: {} }),
      setActiveSandbox: () => undefined,
      stopActiveSandbox: async () => undefined,
      removeSandbox: async () => undefined,
      prepareWorkspace: async () => [501, 20],
      prepareAgentAuth: async (agents) => {
        calls.push(`auth:${[...agents].join(",")}`);
      },
      execStream: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
      runShell: async (command) => {
        calls.push(`shell:${command}`);
        return { exit_code: 0, stdout: "ok\n", stderr: "" };
      },
    };

    await ensureAgentReady("codex", undefined, undefined, manager);
    await ensureAgentReady("codex", undefined, undefined, manager);

    assert.equal(calls[0], "auth:codex");
    assert.match(calls[1] ?? "", /^shell:su agent .*codex login status/);
    assert.equal(calls.length, 2);
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

  it("uses OpenAI-compatible Pi config for MiniMax-compatible OpenAI env", () => {
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

        assert.equal(auth.openai.key, "test-key");
        const provider = models.providers.openai;
        assert.equal(provider.baseUrl, "https://api.minimaxi.com/v1");
        assert.equal(provider.api, "openai-completions");
        assert.equal(provider.models[0].id, "MiniMax-M2.7");
        assert.match(command, /--provider openai/);
        assert.match(command, /--model MiniMax-M2\.7/);
        assert.match(preflight, /pi --list-models/);
        assert.match(preflight, /openai MiniMax-M2\.7/);
      },
    );
  });

  it("still allows explicit native MiniMax Pi provider config", () => {
    withEnv(
      {
        PI_API_KEY: "test-key",
        PI_PROVIDER: "minimax-cn",
        PI_MODEL: "MiniMax-M2.7",
      },
      () => {
        const auth = JSON.parse(guestPiAuthJson());
        const models = JSON.parse(guestPiModelsJson());
        const command = buildPiImplementCommand(state());

        assert.equal(auth["minimax-cn"].key, "test-key");
        assert.deepEqual(models, { providers: {} });
        assert.match(command, /--provider minimax-cn/);
        assert.match(command, /--model MiniMax-M2\.7/);
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

  it("normalizes common LLM env aliases for agent credentials", () => {
    withEnv(
      {
        LLM_API_KEY: "llm-key",
        LLM_BASE_URL: "https://llm.example.com/v1",
        LLM_MODEL: "llm-model",
        CLAUDE_API_KEY: "claude-key",
        CLAUDE_MODEL: "claude-model",
      },
      () => {
        const guestEnv = guestAgentEnv();
        const codexConfig = guestCodexConfigToml();
        const codexCommand = buildCodexImplementCommand(state());
        const claudeCommand = buildClaudeImplementCommand(state());

        assert.ok(guestEnv.some(([key, value]) => key === "OPENAI_API_KEY" && value === "llm-key"));
        assert.ok(guestEnv.some(([key, value]) => key === "CODEX_API_KEY" && value === "llm-key"));
        assert.ok(guestEnv.some(([key, value]) => key === "ANTHROPIC_API_KEY" && value === "claude-key"));
        assert.match(codexConfig, /https:\/\/llm\.example\.com\/v1/);
        assert.match(codexConfig, /llm-model/);
        assert.match(codexCommand, /-m llm-model/);
        assert.match(claudeCommand, /--model claude-model/);
      },
    );
  });

  it("uses RELAY_WORKSPACE for the host workspace path", () => {
    const temp = mkdtempSync(join(tmpdir(), "relay-workspace-"));
    const explicit = mkdtempSync(join(tmpdir(), "relay-explicit-workspace-"));
    const makeWorkspace = mkdtempSync(join(tmpdir(), "relay-make-workspace-"));

    withEnv({ RELAY_WORKSPACE: temp }, () => {
      assert.equal(hostWorkspacePath(), temp);
      assert.equal(hostWorkspacePath(explicit), explicit);
    });
    withEnv({ WORKSPACE: makeWorkspace }, () => {
      assert.equal(hostWorkspacePath(), makeWorkspace);
    });
    withEnv({ RELAY_WORKSPACE: temp, WORKSPACE: makeWorkspace }, () => {
      assert.equal(hostWorkspacePath(), temp);
    });
  });
});
