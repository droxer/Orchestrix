import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  AGENT_NAMES,
  type AgentState,
  type AgentName,
  agentNameList,
  buildClaudeImplementCommand,
  buildClaudeReviewCommand,
  buildCodexImplementCommand,
  buildCodexReviewCommand,
  buildKimiImplementCommand,
  buildKimiReviewCommand,
  buildPiImplementCommand,
  buildPiPreflightCommand,
  buildPiReviewCommand,
  claudeImplementNode,
  claudeTaskPrompt,
  classifyReview,
  ClaudeStreamRenderer,
  codexImplementPrompt,
  reviewPrompt,
  CodexStreamRenderer,
  extractReviewFeedback,
  failureCount,
  formatClaudeJsonLine,
  formatCodexJsonLine,
  formatPiJsonLine,
  getAgent,
  agentCredentialEnv,
  guestCodexConfigToml,
  guestAgentEnv,
  guestPiAuthJson,
  guestPiModelsJson,
  hostWorkspacePath,
  isAgentName,
  JsonLineRenderer,
  piTaskPrompt,
  PlainTextStreamRenderer,
  routeClaudeHandoff,
  routePiHandoff,
  runAgentNode,
  StderrLineRenderer,
  withFailure,
} from "../src/index.js";
import {
  BoxLiteExecutionManager,
  collectExecution,
  ensureAgentReady,
  ensureLocalDevboxOci,
  localProcessExecStream,
  prepareGuestAgentAuth,
  resetAgentReadiness,
  setSessionBox,
  type ExecutionManager,
} from "../../relay-daemon/src/index.js";

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
    agent_failures: {},
    review_verdict: "",
    review_feedback: "",
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
    "prev=",
    "for arg in \"$@\"; do",
    "  if [ \"$prev\" = \"--mode\" ] && [ \"$arg\" = \"json\" ]; then flag=json; fi",
    "  case \"$arg\" in -P|--print-streaming) flag=streaming ;; -p|--print) flag=print ;; esac",
    "  prev=\"$arg\"",
    "done",
    "printf '%s\\n' \"$flag\"",
    "test -n \"$flag\"",
  ].join("\n"));
  chmodSync(path, 0o755);
}

describe("review parsing", () => {
  it("classifies rejected zero-exit verdict", () => {
    const feedback = extractReviewFeedback(
      codexStdout("Blocking issue found.\nRELAY_REVIEW_VERDICT: REJECTED"),
    );

    assert.equal(classifyReview(0, feedback), "rejected");
  });

  it("classifies approved verdict", () => {
    const feedback = extractReviewFeedback(codexStdout("Looks good.\nRELAY_REVIEW_VERDICT: APPROVED"));

    assert.equal(classifyReview(0, feedback), "approved");
  });

  it("extracts review verdicts from newer Codex assistant message events", () => {
    const feedback = extractReviewFeedback(
      JSON.stringify({
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Looks good.\nRELAY_REVIEW_VERDICT: APPROVED" }],
      }) + "\n",
    );

    assert.equal(feedback, "Looks good.\nRELAY_REVIEW_VERDICT: APPROVED");
    assert.equal(classifyReview(0, feedback), "approved");
  });

  it("extracts review verdicts from Pi JSON assistant message events", () => {
    const feedback = extractReviewFeedback(
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Looks good.\nRELAY_REVIEW_VERDICT: APPROVED" }],
        },
      }) + "\n",
    );

    assert.equal(feedback, "Looks good.\nRELAY_REVIEW_VERDICT: APPROVED");
    assert.equal(classifyReview(0, feedback), "approved");
  });

  it("extracts review verdicts from Claude stream-json events", () => {
    const feedback = extractReviewFeedback(
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Looks good.\n" } },
      }) + "\n" +
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "RELAY_REVIEW_VERDICT: APPROVED" } },
      }) + "\n",
    );

    assert.equal(feedback, "Looks good.\n\nRELAY_REVIEW_VERDICT: APPROVED");
    assert.equal(classifyReview(0, feedback), "approved");
  });

  it("does not treat a missing review verdict as success", () => {
    assert.equal(classifyReview(0, "Looks good."), "failed");
  });

  it("classifies review node output for every agent", async () => {
    for (const agent of AGENT_NAMES) {
      const stdout = agent === "codex"
        ? `${codexStdout("Blocking issue found.\nRELAY_REVIEW_VERDICT: REJECTED")}\n`
        : "Blocking issue found.\nRELAY_REVIEW_VERDICT: REJECTED\n";
      const patch = await runAgentNode(agent, "review", state({ task_goal: "Fix auth" }), {
        sink: () => undefined,
        execStream: async (cmd, args) => {
          assert.equal(cmd, "bash");
          assert.match(args?.[1] ?? "", /RELAY_REVIEW_VERDICT/);
          return { exit_code: 0, stdout, stderr: "" };
        },
      });

      assert.equal(patch.review_verdict, "rejected");
      assert.equal(patch.agent_failures?.[agent], 0);
      assert.match(patch.review_feedback ?? "", /Blocking issue found/);
    }
  });

  it("marks missing review verdict as a review failure for every agent", async () => {
    for (const agent of AGENT_NAMES) {
      const patch = await runAgentNode(agent, "review", state({ task_goal: "Fix auth" }), {
        sink: () => undefined,
        execStream: async () => ({ exit_code: 0, stdout: "Looks good.\n", stderr: "" }),
      });

      assert.equal(patch.review_verdict, "failed");
      assert.equal(patch.agent_failures?.[agent], 1);
    }
  });

  it("builds review commands for every agent", () => {
    const taskState = state({ task_goal: "Review auth" });
    for (const [agent, command] of [
      ["claude", buildClaudeReviewCommand(taskState)],
      ["codex", buildCodexReviewCommand(taskState)],
      ["pi", buildPiReviewCommand(taskState)],
      ["kimi", buildKimiReviewCommand(taskState)],
    ] as Array<[AgentName, string]>) {
      assert.match(command, new RegExp(agent));
      assert.match(command, /RELAY_REVIEW_VERDICT/);
    }
  });
});

describe("prompts", () => {
  it("Claude prompt includes review feedback", () => {
    const prompt = claudeTaskPrompt(
      state({
        task_goal: "Fix auth",
        review_verdict: "rejected",
        review_feedback: "Token expiry is not checked.",
      }),
    );

    assert.match(prompt, /Fix auth/);
    assert.doesNotMatch(prompt, /Read docs\/plan\.md/);
    assert.doesNotMatch(prompt, /Run tests/);
    assert.match(prompt, /Review feedback to fix:/);
    assert.match(prompt, /Token expiry is not checked\./);
  });

  it("Pi prompt includes review feedback", () => {
    const prompt = piTaskPrompt(
      state({
        task_goal: "Fix auth",
        review_verdict: "rejected",
        review_feedback: "Token expiry is not checked.",
      }),
    );

    assert.match(prompt, /Fix auth/);
    assert.doesNotMatch(prompt, /Read docs\/plan\.md/);
    assert.doesNotMatch(prompt, /current implementation/);
    assert.doesNotMatch(prompt, /run tests/);
    assert.match(prompt, /Review feedback to fix:/);
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

  it("review prompt defines the review contract and verdict marker", () => {
    const prompt = reviewPrompt(state({ task_goal: "Review this branch exactly how I asked" }));
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
  it("uses Pi JSON mode when pi --help advertises it", () => {
    const temp = mkdtempSync(join(tmpdir(), "relay-pi-invoke-"));
    const workspace = mkdtempSync(join(tmpdir(), "relay-pi-workspace-"));
    writeFakePi(join(temp, "pi"));

    withEnv({
      PATH: `${temp}:${process.env.PATH ?? ""}`,
      RELAY_AGENT_HOME: join(temp, "home"),
      RELAY_AGENT_WORKSPACE: workspace,
      RELAY_RUN_AS_CURRENT_USER: "1",
      PI_HELP_TEXT: "Options:\n  --mode <mode> Output mode: text or json\n  --print, -p  Non-interactive mode",
    }, () => {
      const result = runShellCommand(buildPiImplementCommand(state()), process.env);

      assert.equal(result.exit_code, 0, result.stderr || result.error_message);
      assert.equal(result.stdout, "json\n");
    });
  });

  it("falls back to Pi -p when pi --help does not advertise JSON or streaming print", () => {
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

  it("uses Pi -P when pi --help advertises streaming print but not JSON mode", () => {
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

  it("renders Pi JSON assistant message events without raw JSON", () => {
    const line = JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hi from Pi JSON." }],
      },
    });

    const output = formatPiJsonLine(line);

    assert.match(output, /Hi from Pi JSON\./);
    assert.doesNotMatch(output, /"type":"message"/);
  });

  it("renders Pi JSON empty assistant events as visible status", () => {
    const output = formatPiJsonLine(JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "stop" },
    }));

    assert.match(output, /Pi returned no assistant text\./);
  });

  it("renders Pi JSON assistant errors as visible status", () => {
    const output = formatPiJsonLine(JSON.stringify({
      type: "turn_end",
      message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Connection error." },
    }));

    assert.match(output, /Pi error: Connection error\./);
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

  it("closes BoxLite stdin before collecting output", async () => {
    const events: string[] = [];
    const execution = {
      stdin: async () => ({
        close: async () => {
          events.push("stdin closed");
        },
      }),
      stdout: async () => ({
        next: async () => {
          events.push("stdout read");
          return null;
        },
      }),
      stderr: async () => ({
        next: async () => {
          events.push("stderr read");
          return null;
        },
      }),
      wait: async () => ({ exitCode: 0 }),
    };

    const result = await collectExecution(execution);

    assert.equal(result.exit_code, 0);
    assert.equal(events[0], "stdin closed");
    assert.ok(events.includes("stdout read"));
    assert.ok(events.includes("stderr read"));
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

    resetAgentReadiness();
    calls.length = 0;
    await ensureAgentReady("kimi", undefined, undefined, manager);

    assert.equal(calls[0], "auth:kimi");
    assert.match(calls[1] ?? "", /^shell:su agent .*KIMI_CODE_HOME=.*kimi --version/);
    assert.equal(calls.length, 2);
  });

  it("provisions Kimi config and credentials into the guest without copying host binaries", async () => {
    const temp = mkdtempSync(join(tmpdir(), "relay-kimi-code-"));
    const credentials = join(temp, "credentials");
    const oauth = join(temp, "oauth");
    const bin = join(temp, "bin");
    mkdirSync(credentials, { recursive: true });
    mkdirSync(oauth, { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(temp, "config.toml"), "default_model = \"kimi-test\"\n");
    writeFileSync(join(temp, "tui.toml"), "theme = \"dark\"\n");
    writeFileSync(join(credentials, "kimi-code.json"), "{\"token\":\"secret\"}\n");
    writeFileSync(join(oauth, "kimi-code"), "");
    writeFileSync(join(bin, "kimi"), "mac binary");

    const oldEnv = process.env;
    let script = "";
    setSessionBox({
      exec: async (_cmd: string, args: string[]) => {
        script = args[1] ?? "";
        const emptyReader = { next: async () => null };
        return {
          stdout: async () => emptyReader,
          stderr: async () => emptyReader,
          wait: async () => ({ exitCode: 0 }),
        };
      },
    });
    process.env = { KIMI_CODE_HOME: temp };
    try {
      await prepareGuestAgentAuth(["kimi"]);
    } finally {
      process.env = oldEnv;
      setSessionBox(null);
    }

    assert.match(script, /\/home\/agent\/\.kimi-code\/config\.toml/);
    assert.match(script, /\/home\/agent\/\.kimi-code\/tui\.toml/);
    assert.match(script, /\/home\/agent\/\.kimi-code\/credentials\/kimi-code\.json/);
    assert.match(script, /\/home\/agent\/\.kimi-code\/oauth\/kimi-code/);
    assert.doesNotMatch(script, /\/home\/agent\/\.kimi-code\/bin\/kimi/);
  });
});

describe("handoff routing", () => {
  it("routes Claude success to Pi", () => {
    assert.equal(routeClaudeHandoff(state()), "pi_implement");
  });

  it("ends after Pi success", () => {
    assert.equal(routePiHandoff(state()), "__end__");
  });

  it("retries Pi failure", () => {
    assert.equal(routePiHandoff(state({ last_exit_code: 1, agent_failures: { pi: 1 } })), "pi_implement");
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
        assert.match(command, /--mode json/);
        assert.match(command, /--print-streaming/);
        assert.match(command, / -P /);
        assert.match(command, / -p /);
        assert.match(command, /elif pi --help/);
        assert.match(preflight, /pi --list-models/);
        assert.match(preflight, /openai test-model/);
      },
    );
  });

  it("uses Anthropic-compatible Pi config for MiniMax-compatible OpenAI env", () => {
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
        const provider = models.providers["minimax-cn"];
        assert.equal(provider.baseUrl, "https://api.minimaxi.com/anthropic");
        assert.equal(provider.api, "anthropic-messages");
        assert.equal(provider.apiKey, "$PI_API_KEY");
        assert.equal(provider.models[0].id, "MiniMax-M2.7");
        assert.match(command, /--provider minimax-cn/);
        assert.match(command, /--model MiniMax-M2\.7/);
        assert.match(preflight, /pi --list-models/);
        assert.match(preflight, /minimax-cn MiniMax-M2\.7/);
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
        const piEnv = agentCredentialEnv("pi");
        assert.ok(piEnv.some(([key, value]) => key === "PI_API_KEY" && value === "openai-key"));
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
        const codexEnv = agentCredentialEnv("codex");
        const claudeEnv = agentCredentialEnv("claude");
        const codexConfig = guestCodexConfigToml();
        const codexCommand = buildCodexImplementCommand(state());
        const claudeCommand = buildClaudeImplementCommand(state());

        assert.ok(codexEnv.some(([key, value]) => key === "OPENAI_API_KEY" && value === "llm-key"));
        assert.ok(codexEnv.some(([key, value]) => key === "CODEX_API_KEY" && value === "llm-key"));
        assert.ok(claudeEnv.some(([key, value]) => key === "ANTHROPIC_API_KEY" && value === "claude-key"));
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

describe("credential scoping", () => {
  const allProviderEnv = {
    ANTHROPIC_API_KEY: "anthropic-secret",
    OPENAI_API_KEY: "openai-secret",
    PI_API_KEY: "pi-secret",
    KIMI_API_KEY: "kimi-secret",
    MOONSHOT_API_KEY: "moonshot-secret",
  };

  it("keeps API keys out of the sandbox (VM-lifetime) env", () => {
    withEnv(allProviderEnv, () => {
      const guestEnv = guestAgentEnv();
      const keys = guestEnv.map(([key]) => key);
      for (const secretKey of Object.keys(allProviderEnv)) {
        assert.ok(!keys.includes(secretKey), `${secretKey} must not be baked into the sandbox env`);
      }
      const serialized = JSON.stringify(guestEnv);
      for (const secret of Object.values(allProviderEnv)) {
        assert.ok(!serialized.includes(secret), `secret ${secret} leaked into the sandbox env`);
      }
    });
  });

  it("injects only the running agent's provider credentials", () => {
    withEnv(allProviderEnv, () => {
      const claudeCommand = buildClaudeImplementCommand(state());
      assert.ok(claudeCommand.includes("anthropic-secret"));
      for (const other of ["openai-secret", "pi-secret", "kimi-secret", "moonshot-secret"]) {
        assert.ok(!claudeCommand.includes(other), `Claude run exposed ${other}`);
      }

      const codexCommand = buildCodexImplementCommand(state());
      assert.ok(codexCommand.includes("openai-secret"));
      for (const other of ["anthropic-secret", "pi-secret", "kimi-secret", "moonshot-secret"]) {
        assert.ok(!codexCommand.includes(other), `Codex run exposed ${other}`);
      }

      const kimiCommand = buildKimiImplementCommand(state());
      assert.ok(kimiCommand.includes("kimi-secret"));
      assert.ok(kimiCommand.includes("moonshot-secret"));
      for (const other of ["anthropic-secret", "openai-secret", "pi-secret"]) {
        assert.ok(!kimiCommand.includes(other), `Kimi run exposed ${other}`);
      }
    });
  });

  it("scopes credential resolution per agent", () => {
    withEnv(allProviderEnv, () => {
      const claudeKeys = agentCredentialEnv("claude").map(([key]) => key);
      const codexKeys = agentCredentialEnv("codex").map(([key]) => key);
      const piKeys = agentCredentialEnv("pi").map(([key]) => key);
      const kimiKeys = agentCredentialEnv("kimi").map(([key]) => key);

      assert.deepEqual(claudeKeys, ["ANTHROPIC_API_KEY"]);
      assert.ok(codexKeys.includes("OPENAI_API_KEY") && codexKeys.includes("CODEX_API_KEY"));
      assert.ok(!codexKeys.includes("ANTHROPIC_API_KEY"));
      assert.ok(piKeys.includes("PI_API_KEY") && !piKeys.includes("OPENAI_API_KEY"));
      assert.ok(kimiKeys.includes("KIMI_API_KEY") && kimiKeys.includes("MOONSHOT_API_KEY"));
      assert.ok(!kimiKeys.includes("ANTHROPIC_API_KEY"));
    });
  });
});

describe("agent registry", () => {
  it("validates agent names through the registry", () => {
    assert.equal(isAgentName("claude"), true);
    assert.equal(isAgentName("kimi"), true);
    assert.equal(isAgentName("gpt"), false);
    assert.equal(isAgentName(42), false);
  });

  it("includes the four registered agents in a stable order", () => {
    assert.deepEqual(AGENT_NAMES, ["claude", "pi", "codex", "kimi"]);
    assert.equal(agentNameList(), "claude, pi, codex, kimi");
  });

  it("exposes review commands for every agent", () => {
    for (const agent of AGENT_NAMES) {
      assert.equal(typeof getAgent(agent).buildReviewCommand, "function");
      assert.equal(getAgent(agent).defaultMode, "implement");
    }
  });

  it("embeds the task goal in the Kimi implement command without leaking raw JSONL", () => {
    const command = buildKimiImplementCommand(state({ task_goal: "Wire up Kimi" }));
    assert.match(command, /kimi/);
    assert.match(command, /Wire up Kimi/);
    assert.doesNotMatch(command, /stream-json/);
  });

  it("tracks failures per agent and resets on success", () => {
    const base = state();
    const afterFail = withFailure(base, "kimi", true);
    assert.equal(afterFail.kimi, 1);
    const afterSecond = withFailure({ ...base, agent_failures: afterFail }, "kimi", true);
    assert.equal(afterSecond.kimi, 2);
    const afterPass = withFailure({ ...base, agent_failures: afterSecond }, "kimi", false);
    assert.equal(afterPass.kimi, 0);
    assert.equal(failureCount({ ...base, agent_failures: { codex: 3 } }, "codex"), 3);
    assert.equal(failureCount(base, "pi"), 0);
  });
});
