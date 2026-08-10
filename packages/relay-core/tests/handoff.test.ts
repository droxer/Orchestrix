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
  buildClaudeActionCommand,
  buildClaudeAskCommand,
  buildClaudeReviewCommand,
  buildCodexActionCommand,
  buildCodexAskCommand,
  buildCodexReviewCommand,
  buildKimiActionCommand,
  buildKimiAskCommand,
  buildKimiReviewCommand,
  buildPiActionCommand,
  buildPiAskCommand,
  buildPiPreflightCommand,
  buildPiReviewCommand,
  claudeActionNode,
  claudeTaskPrompt,
  ClaudeStreamRenderer,
  codexActionPrompt,
  reviewPrompt,
  CodexStreamRenderer,
  extractTokenUsageFromJsonl,
  failureCount,
  formatClaudeJsonLine,
  formatCodexJsonLine,
  formatKimiJsonLine,
  formatPiJsonLine,
  getAgent,
  KimiStreamRenderer,
  agentCredentialEnv,
  guestCodexConfigToml,
  guestAgentEnv,
  guestPiAuthJson,
  guestPiModelsJson,
  hostWorkspacePath,
  isAgentName,
  JsonLineRenderer,
  materializeEvents,
  piTaskPrompt,
  PiStreamRenderer,
  PlainTextStreamRenderer,
  relayEvent,
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

async function withEnvAsync<T>(env: NodeJS.ProcessEnv, fn: () => Promise<T>): Promise<T> {
  const oldEnv = process.env;
  process.env = { ...env };
  try {
    return await fn();
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

describe("review mode", () => {
  it("runs a review pass as an informational agent run for every agent", async () => {
    for (const agent of AGENT_NAMES) {
      const stdout = agent === "codex"
        ? `${codexStdout("Blocking issue found.")}\n`
        : "Blocking issue found.\n";
      const patch = await runAgentNode(agent, "review", state({ task_goal: "Fix auth" }), {
        sink: () => undefined,
        execStream: async (cmd, args) => {
          assert.equal(cmd, "bash");
          assert.doesNotMatch(args?.[1] ?? "", /RELAY_REVIEW_VERDICT/);
          return { exit_code: 0, stdout, stderr: "" };
        },
      });

      assert.equal(patch.last_exit_code, 0);
      assert.equal(patch.agent_failures?.[agent], 0);
      assert.match(patch.agent_logs?.[0] ?? "", /Blocking issue found/);
      assert.equal("review_verdict" in patch, false);
      assert.equal("review_feedback" in patch, false);
    }
  });

  it("marks a non-zero review exit as a failure for every agent", async () => {
    for (const agent of AGENT_NAMES) {
      const patch = await runAgentNode(agent, "review", state({ task_goal: "Fix auth" }), {
        sink: () => undefined,
        execStream: async () => ({ exit_code: 1, stdout: "", stderr: "boom" }),
      });

      assert.equal(patch.last_exit_code, 1);
      assert.equal(patch.agent_failures?.[agent], 1);
    }
  });

  it("builds review commands for every agent without a verdict marker", () => {
    const taskState = state({ task_goal: "Review auth" });
    for (const [agent, command] of [
      ["claude", buildClaudeReviewCommand(taskState)],
      ["codex", buildCodexReviewCommand(taskState)],
      ["pi", buildPiReviewCommand(taskState)],
      ["kimi", buildKimiReviewCommand(taskState)],
    ] as Array<[AgentName, string]>) {
      assert.match(command, new RegExp(agent));
      assert.match(command, /Review auth/);
      assert.doesNotMatch(command, /RELAY_REVIEW_VERDICT/);
    }
  });

  it("builds read-only ask commands for every agent", () => {
    const taskState = state({ task_goal: "How does auth work?" });
    for (const [agent, command] of [
      ["claude", buildClaudeAskCommand(taskState)],
      ["codex", buildCodexAskCommand(taskState)],
      ["pi", buildPiAskCommand(taskState)],
      ["kimi", buildKimiAskCommand(taskState)],
    ] as Array<[AgentName, string]>) {
      assert.match(command, new RegExp(agent));
      // The ask prompt carries the read-only instruction and never the review marker.
      assert.match(command, /read-only planning discussion/);
      assert.match(command, /respond to them directly/);
      assert.doesNotMatch(command, /RELAY_REVIEW_VERDICT/);
    }
  });

  it("confines ask mode to read-only at the CLI level for Claude and Codex", () => {
    const taskState = state({ task_goal: "Explain the build" });
    assert.match(buildClaudeAskCommand(taskState), /--permission-mode\s+plan/);
    assert.doesNotMatch(buildClaudeAskCommand(taskState), /bypassPermissions/);
    assert.match(buildCodexAskCommand(taskState), /--sandbox\s+read-only/);
    assert.doesNotMatch(buildCodexAskCommand(taskState), /--ask-for-approval/);
    assert.doesNotMatch(buildCodexAskCommand(taskState), /dangerously-bypass/);
  });
});

describe("prompts", () => {
  it("applies the logical-agent identity and personality to every runtime and task mode", () => {
    const logicalAgentState = state({
      task_goal: "Implement the endpoint",
      agent_display_name: "Sentinel",
      agent_instructions: "Act as the employee's security reviewer.",
    });
    const builders = [
      ["Claude action", buildClaudeActionCommand],
      ["Claude ask", buildClaudeAskCommand],
      ["Claude review", buildClaudeReviewCommand],
      ["Codex action", buildCodexActionCommand],
      ["Codex ask", buildCodexAskCommand],
      ["Codex review", buildCodexReviewCommand],
      ["Pi action", buildPiActionCommand],
      ["Pi ask", buildPiAskCommand],
      ["Pi review", buildPiReviewCommand],
      ["Kimi action", buildKimiActionCommand],
      ["Kimi ask", buildKimiAskCommand],
      ["Kimi review", buildKimiReviewCommand],
    ] as const;

    for (const [label, buildCommand] of builders) {
      const command = buildCommand(logicalAgentState);
      assert.match(
        command,
        /\[Agent identity\]\nYour name is Sentinel\./,
        `${label} should identify the logical agent by its display name`,
      );
      assert.match(
        command,
        /\[Agent personality\]\nApply this personality consistently throughout the task\./,
        `${label} should explicitly apply the agent personality`,
      );
      assert.ok(
        command.indexOf("[Agent identity]")
          < command.indexOf("[Agent personality]"),
        `${label} should place the identity before the personality`,
      );
      assert.ok(
        command.indexOf("[Agent personality]")
          < command.indexOf("Implement the endpoint"),
        `${label} should place the personality before the user task`,
      );
    }
  });
  it("describes the shared thread workspace and the agent's private home", () => {
    const sharedWorkspaceState = state({
      task_goal: "Draft the report",
      agent_home_subdir: "agents/agent-YWdlbnRfMQ",
    });

    const prompt = claudeTaskPrompt(sharedWorkspaceState);

    assert.match(prompt, /\[Workspace\]\n.*workspace for this thread/);
    assert.match(prompt, /Your private directory is `agents\/agent-YWdlbnRfMQ\/`/);
    assert.match(prompt, /\[User\]\nDraft the report$/);
  });
  it("tells a team member which role it is playing, in every task mode", () => {
    const reviewerState = state({
      task_goal: "Ship the endpoint",
      agent_role: "reviewer",
    });

    for (const [label, buildCommand] of [
      ["action", buildClaudeActionCommand],
      ["ask", buildClaudeAskCommand],
      ["review", buildClaudeReviewCommand],
    ] as const) {
      const command = buildCommand(reviewerState);
      assert.match(
        command,
        /\[Role\]\nYou are the reviewer on this task\./,
        `${label} should name the agent's role`,
      );
      assert.match(
        command,
        /Other agents on the thread hold the other roles/,
        `${label} should scope the role against its teammates`,
      );
    }
  });
  it("scopes a team member to its explicit assignment brief", () => {
    const assignedState = state({
      task_goal: "Ship the endpoint",
      assignment_brief: "Implement only the database migration and its tests.",
      team_phase: "execution",
    });

    const prompt = claudeTaskPrompt(assignedState);

    assert.match(prompt, /\[Your assignment\]/);
    assert.match(prompt, /Implement only the database migration and its tests\./);
    assert.match(prompt, /\[Team phase\]\nThis assignment is in the execution phase\./);
    assert.ok(
      prompt.indexOf("[Your assignment]") < prompt.indexOf("[User]"),
      "the assignment boundary should precede the shared team goal",
    );
  });
  it("points task work at its durable progress log and asks for an update", () => {
    const taskState = state({
      task_goal: "Migrate the billing tables",
      progress_file: "PROGRESS.md",
    });

    const prompt = claudeTaskPrompt(taskState);

    assert.match(prompt, /\[Progress log\]\n`PROGRESS\.md` in the workspace/);
    assert.match(prompt, /Read it before you start/);
    assert.match(prompt, /Before you finish, update it/);
  });
  it("does not ask a read-only ask pass to write the progress log", () => {
    const taskState = state({
      task_goal: "What is left here?",
      progress_file: "PROGRESS.md",
    });

    const prompt = buildClaudeAskCommand(taskState);

    assert.match(prompt, /Read it before you start/);
    assert.doesNotMatch(prompt, /Before you finish, update it/);
    assert.match(prompt, /Do NOT modify, create, or delete any files/);
  });
  it("asks a run to state whether the task is finished, but never a read-only pass", () => {
    const roundState = state({
      task_goal: "Migrate the billing tables",
      round_result_file: ".relay/round-result.json",
    });

    const prompt = claudeTaskPrompt(roundState);
    assert.match(prompt, /\[Finishing\]\nWhen you stop, write `\.relay\/round-result\.json`/);
    assert.match(prompt, /"status": "done" \| "continue" \| "blocked"/);

    // An ask pass cannot write files, so asking it for the verdict would
    // contradict its own guard.
    assert.doesNotMatch(buildClaudeAskCommand(roundState), /\[Finishing\]/);
  });
  it("tells a lead sent back to repair what it is fixing", () => {
    const repairState = state({
      task_goal: "Ship the migration",
      repair_note: "Reviewer action failed with exit code 3. Fix the cause.",
    });

    const prompt = claudeTaskPrompt(repairState);

    assert.match(
      prompt,
      /\[Repair\]\nReviewer action failed with exit code 3\. Fix the cause\./,
    );
    assert.ok(
      prompt.indexOf("[Repair]") < prompt.indexOf("[User]"),
      "the repair note should precede the user task",
    );
  });
  it("omits the progress prelude when the run keeps no log", () => {
    assert.doesNotMatch(
      claudeTaskPrompt(state({ task_goal: "Fix auth" })),
      /\[Progress log\]/,
    );
  });
  it("omits the role prelude for an agent dispatched without one", () => {
    assert.doesNotMatch(claudeTaskPrompt(state({ task_goal: "Fix auth" })), /\[Role\]/);
  });
  it("omits the workspace prelude when no personal home is set", () => {
    assert.doesNotMatch(claudeTaskPrompt(state({ task_goal: "Fix auth" })), /\[Workspace\]/);
  });
  it("runs agents at the configured workspace root", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "relay-shared-root-"));
    const cwds: Array<string | undefined> = [];
    await withEnvAsync({ ...process.env, RELAY_AGENT_WORKSPACE: workspace }, () =>
      runAgentNode("claude", "action", state({ agent_home_subdir: "agents/agent-YWdlbnRfMQ" }), {
        execStream: async (_command, _args, options) => {
          cwds.push(options?.cwd);
          return { exit_code: 0, stdout: "", stderr: "" };
        },
      }),
    );

    assert.deepEqual(cwds, [workspace]);
  });
  it("uses an explicit thread workspace without mutating process-global configuration", async () => {
    const rootWorkspace = mkdtempSync(join(tmpdir(), "relay-node-root-"));
    const threadWorkspace = join(rootWorkspace, "ses_explicit");
    mkdirSync(threadWorkspace);
    const cwds: Array<string | undefined> = [];

    await withEnvAsync({ ...process.env, RELAY_AGENT_WORKSPACE: rootWorkspace }, () =>
      runAgentNode("codex", "action", state(), {
        workspacePath: threadWorkspace,
        execStream: async (_command, args, options) => {
          cwds.push(options?.cwd);
          assert.equal(process.env.RELAY_AGENT_WORKSPACE, rootWorkspace);
          assert.match(args?.[1] ?? "", new RegExp(threadWorkspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
          return { exit_code: 0, stdout: "", stderr: "" };
        },
      }),
    );

    assert.deepEqual(cwds, [threadWorkspace]);
  });
  it("keeps the head of long agent output in the completed agent log", async () => {
    const head = "HEAD-OF-REPLY-MARKER";
    const stdout = `${head}\n${"x".repeat(20_000)}`;
    const patch = await runAgentNode("claude", "action", state({ task_goal: "Long output" }), {
      execStream: async () => ({ exit_code: 0, stdout, stderr: "" }),
    });

    assert.ok(patch.agent_logs?.[0]?.includes(head));
  });
  it("Claude action prompt carries the task goal", () => {
    const prompt = claudeTaskPrompt(state({ task_goal: "Fix auth" }));

    assert.match(prompt, /Fix auth/);
    assert.doesNotMatch(prompt, /Review feedback to fix:/);
  });

  it("Pi action prompt carries the task goal", () => {
    const prompt = piTaskPrompt(state({ task_goal: "Fix auth" }));

    assert.match(prompt, /Fix auth/);
    assert.doesNotMatch(prompt, /Review feedback to fix:/);
  });

  it("Codex implementation prompt does not require a review verdict", () => {
    const prompt = codexActionPrompt(state({ task_goal: "Fix auth" }));
    const command = buildCodexActionCommand(state({ task_goal: "Fix auth" }));

    assert.match(prompt, /Fix auth/);
    assert.doesNotMatch(prompt, /Read docs\/plan\.md/);
    assert.doesNotMatch(prompt, /Implement the requested changes/);
    assert.doesNotMatch(prompt, /run tests/);
    assert.doesNotMatch(prompt, /RELAY_REVIEW_VERDICT/);
    assert.match(command, /codex/);
    assert.match(command, /exec/);
    assert.doesNotMatch(command, /RELAY_REVIEW_VERDICT/);
  });

  it("review prompt defines the review contract without a verdict marker", () => {
    const prompt = reviewPrompt(state({ task_goal: "Review this branch exactly how I asked" }));
    const command = buildCodexReviewCommand(state({ task_goal: "Review this branch exactly how I asked" }));

    assert.match(prompt, /Review this branch exactly how I asked/);
    assert.match(prompt, /blocking bugs/);
    assert.doesNotMatch(prompt, /RELAY_REVIEW_VERDICT/);
    assert.match(command, /Review this branch exactly how I asked/);
    assert.doesNotMatch(command, /RELAY_REVIEW_VERDICT/);
  });

  it("builds Claude command against the daemon node host workspace when configured", () => {
    withEnv({
      RELAY_AGENT_HOME: "/tmp/relay-agent-home",
      RELAY_AGENT_WORKSPACE: "/tmp/relay-host-workspace",
      RELAY_RUN_AS_CURRENT_USER: "1",
    }, () => {
      const command = buildClaudeActionCommand(state());

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
    const patch = await claudeActionNode(state(), {
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
      const result = runShellCommand(buildPiActionCommand(state()), process.env);

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
      const result = runShellCommand(buildPiActionCommand(state()), process.env);

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
      const result = runShellCommand(buildPiActionCommand(state()), process.env);

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
      const result = runShellCommand(buildCodexActionCommand(state({ task_goal: "Implement invocation fix" })), process.env);
      const args = readFileSync(argsPath, "utf8").split(/\n/).filter(Boolean);

      assert.equal(result.exit_code, 0, result.stderr || result.error_message);
      assert.equal(readFileSync(homePath, "utf8").trim(), join(temp, "home", ".codex"));
      assert.ok(args.includes("exec"));
      assert.ok(args.includes("--json"));
      assert.ok(args.includes("--skip-git-repo-check"));
      assert.ok(args.includes("--dangerously-bypass-approvals-and-sandbox"));
      assert.ok(args.includes("features.multi_agent=true"));
      assert.ok(args.includes("features.multi_agent_v2=true"));
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
        codexStdout("Looks good."),
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

  it("renders Pi JSON streaming text deltas without empty terminal warnings", () => {
    const renderer = new PiStreamRenderer();
    const output = [
      { type: "turn_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      {
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hi " },
      },
      {
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "from Pi JSON." },
      },
      { type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } },
      { type: "turn_end", message: { role: "assistant", content: [], stopReason: "stop" }, toolResults: [] },
    ].map((event) => renderer.feed(`${JSON.stringify(event)}\n`)).join("");

    assert.match(output, /Hi from Pi JSON\./);
    assert.doesNotMatch(output, /no assistant text/i);
    assert.doesNotMatch(output, /"type":"message_update"/);
  });

  it("does not replay Pi final message content after streaming deltas", () => {
    const renderer = new PiStreamRenderer();
    const output = [
      { type: "turn_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      {
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hi " },
      },
      {
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "from Pi JSON." },
      },
      {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Hi from Pi JSON." }], stopReason: "stop" },
      },
      {
        type: "turn_end",
        message: { role: "assistant", content: [{ type: "text", text: "Hi from Pi JSON." }], stopReason: "stop" },
      },
    ].map((event) => renderer.feed(`${JSON.stringify(event)}\n`)).join("");

    assert.equal((output.match(/Hi from Pi JSON\./g) ?? []).length, 1);
  });

  it("does not replay Pi text_end content after streaming deltas", () => {
    const renderer = new PiStreamRenderer();
    const output = [
      { type: "turn_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      {
        type: "message_update",
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hi from Pi JSON." },
      },
      {
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "Hi from Pi JSON." }] },
        assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "Hi from Pi JSON." },
      },
      {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Hi from Pi JSON." }], stopReason: "stop" },
      },
      {
        type: "turn_end",
        message: { role: "assistant", content: [{ type: "text", text: "Hi from Pi JSON." }], stopReason: "stop" },
      },
    ].map((event) => renderer.feed(`${JSON.stringify(event)}\n`)).join("");

    assert.equal((output.match(/Hi from Pi JSON\./g) ?? []).length, 1);
  });

  it("renders Pi text_end content when no deltas streamed", () => {
    const renderer = new PiStreamRenderer();
    const output = [
      { type: "turn_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      {
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "Hi from Pi JSON." }] },
        assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "Hi from Pi JSON." },
      },
      {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Hi from Pi JSON." }], stopReason: "stop" },
      },
    ].map((event) => renderer.feed(`${JSON.stringify(event)}\n`)).join("");

    assert.equal((output.match(/Hi from Pi JSON\./g) ?? []).length, 1);
  });

  it("ignores Pi JSON empty assistant lifecycle events", () => {
    const output = formatPiJsonLine(JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [], stopReason: "stop" },
    }));

    assert.equal(output, "");
  });

  it("ignores repeated Pi empty assistant lifecycle events", () => {
    const renderer = new PiStreamRenderer();
    const output = [
      { type: "turn_start" },
      { type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } },
      { type: "turn_end", message: { role: "assistant", content: [], stopReason: "stop" }, toolResults: [] },
    ].map((event) => renderer.feed(`${JSON.stringify(event)}\n`)).join("");

    assert.equal(output, "");
  });

  it("renders Pi JSON assistant errors as visible status", () => {
    const output = formatPiJsonLine(JSON.stringify({
      type: "turn_end",
      message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Connection error." },
    }));

    assert.match(output, /Pi error: Connection error\./);
  });

  it("renders Kimi stream-json assistant messages without raw JSON", () => {
    const renderer = new KimiStreamRenderer();
    const output = renderer.feed(
      JSON.stringify({ role: "assistant", content: "Loop engineering is the latest paradigm." }) + "\n",
    );

    assert.match(output, /● Loop engineering is the latest paradigm\./);
    assert.doesNotMatch(output, /"role":"assistant"/);
  });

  it("renders Kimi assistant content arrays and tool_calls", () => {
    const output = formatKimiJsonLine(JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "Searching the web." }],
      tool_calls: [{ id: "call_1", function: { name: "web_search" } }],
    }));

    assert.match(output, /● Searching the web\./);
    assert.match(output, /⏺ .*tool.* web_search/);
    assert.doesNotMatch(output, /"tool_calls"/);
  });

  it("drops Kimi tool-result and non-assistant messages", () => {
    const renderer = new KimiStreamRenderer();
    const output = [
      { role: "user", content: "最新的 loop engineering 是？" },
      { role: "tool", tool_call_id: "call_1", content: "raw tool output" },
    ].map((event) => renderer.feed(`${JSON.stringify(event)}\n`)).join("");

    assert.equal(output, "");
  });

  it("falls back to sanitized plain text for non-JSON Kimi lines", () => {
    const renderer = new KimiStreamRenderer();
    const output = renderer.feed("plain text leak\n");

    assert.match(output, /● plain text leak/);
  });

  it("surfaces Kimi error events as visible status", () => {
    const output = formatKimiJsonLine(JSON.stringify({ type: "error", message: "auth required" }));

    assert.match(output, /Kimi error: auth required/);
  });

  it("filters the Kimi resume-session notice from stderr", () => {
    const renderer = new StderrLineRenderer();
    const output = renderer.feed(
      "To resume this session: kimi -r session_4df5ca77-7d81-4e28-8bdd-65d31e9b5864\n",
    );

    assert.equal(output, "");
  });

  it("filters the Claude claude.ai connectors notice from stderr", () => {
    const renderer = new StderrLineRenderer();
    const output = renderer.feed(
      "⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors\n",
    );

    assert.equal(output, "");
  });

  it("filters the Claude claude.ai connectors notice from stdout text lines", () => {
    const renderer = new ClaudeStreamRenderer();
    const output = renderer.feed(
      "⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set\n",
    );

    assert.equal(output, "");
  });

  it("builds the Kimi action command in stream-json mode", () => {
    const command = buildKimiActionCommand(state({ task_goal: "Do the thing" }));

    assert.match(command, /--output-format stream-json/);
    assert.match(command, /--prompt/);
  });

  it("filters noisy seccomp stderr warnings", () => {
    const renderer = new StderrLineRenderer();
    const output = renderer.feed(
      "2026-06-03T14:06:38.981712Z  WARN libcontainer::process::init::process: seccomp not available, unable to set seccomp privileges!\n",
    );

    assert.equal(output, "");
  });

  it("filters Codex stdin notice from stderr", () => {
    const renderer = new StderrLineRenderer();
    const output = [
      "Reading additional input from stdin.\n",
      "Reading additional input from stdin...\n",
      "Reading additional input from stdin…\n",
    ].map((line) => renderer.feed(line)).join("");

    assert.equal(output, "");
  });

  it("filters the harmless Codex v1 router fallback when v2 handles collaboration", () => {
    const renderer = new StderrLineRenderer();
    assert.equal(
      renderer.feed("2026-07-12T05:08:48Z ERROR codex_core::tools::router: error=unsupported call: multi_agent_v1__spawn_agent\n"),
      "",
    );
  });
});

describe("execution cancellation", () => {
  it("kills shell child processes when local process execution is cancelled", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "relay-process-cancel-"));
    const marker = join(workspace, "survived.txt");
    const release = join(workspace, "release.txt");
    const controller = new AbortController();
    const pending = localProcessExecStream("bash", [
      "-c",
      `(while [ ! -f ${JSON.stringify(release)} ]; do sleep 0.05; done; printf survived > ${JSON.stringify(marker)}) & wait`,
    ], {
      cwd: workspace,
      signal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort("stop test process");
    const result = await pending;
    writeFileSync(release, "go");
    await new Promise((resolve) => setTimeout(resolve, 300));

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
      prepareAgentSkills: async () => {
        calls.push("skills");
      },
      execStream: async () => ({ exit_code: 0, stdout: "", stderr: "" }),
      runShell: async (command) => {
        calls.push(`shell:${command}`);
        return { exit_code: 0, stdout: "ok\n", stderr: "" };
      },
    };

    await ensureAgentReady("codex", undefined, undefined, manager);
    await ensureAgentReady("codex", undefined, undefined, manager);

    // Every agent gets shared skills installed after auth, before preflight.
    assert.equal(calls[0], "auth:codex");
    assert.equal(calls[1], "skills");
    assert.match(calls[2] ?? "", /^shell:su agent .*codex login status/);
    assert.equal(calls.length, 3);

    resetAgentReadiness();
    calls.length = 0;
    await ensureAgentReady("kimi", undefined, undefined, manager);

    assert.equal(calls[0], "auth:kimi");
    assert.equal(calls[1], "skills");
    assert.match(calls[2] ?? "", /^shell:su agent .*KIMI_CODE_HOME=.*kimi --version && kimi doctor/);
    assert.equal(calls.length, 3);

    resetAgentReadiness();
    calls.length = 0;
    await ensureAgentReady("claude", undefined, undefined, manager);

    // Claude needs no guest auth but still gets the shared skills before preflight.
    assert.equal(calls[0], "skills");
    assert.match(calls[1] ?? "", /^shell:su agent .*claude/);
    assert.equal(calls.length, 2);
  });

  it("allows Kimi env-key auth without a host Kimi Code home", async () => {
    const oldEnv = process.env;
    let execCalled = false;
    setSessionBox({
      exec: async () => {
        execCalled = true;
        throw new Error("guest auth setup should not copy files when Kimi env auth is available");
      },
    });
    process.env = {
      KIMI_CODE_HOME: join(tmpdir(), "relay-missing-kimi-code-home"),
      KIMI_API_KEY: "kimi-key",
    };
    try {
      await prepareGuestAgentAuth(["kimi"]);
    } finally {
      process.env = oldEnv;
      setSessionBox(null);
    }

    assert.equal(execCalled, false);
  });

  it("requires Kimi login files or env-key auth", async () => {
    const oldEnv = process.env;
    process.env = {
      KIMI_CODE_HOME: join(tmpdir(), "relay-missing-kimi-code-home"),
    };
    try {
      await assert.rejects(
        () => prepareGuestAgentAuth(["kimi"]),
        /Kimi requires a host Kimi Code login, KIMI_API_KEY, or MOONSHOT_API_KEY/,
      );
    } finally {
      process.env = oldEnv;
    }
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
        const command = buildPiActionCommand(state());
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
        const command = buildPiActionCommand(state());
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
        const command = buildPiActionCommand(state());

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
        const command = buildPiActionCommand(state());

        assert.equal(auth.anthropic.key, "pi-key");
        assert.equal(provider.api, "anthropic-messages");
        assert.equal(provider.baseUrl, "https://api.example.com/anthropic");
        assert.equal("authHeader" in provider, false);
        assert.match(command, /--provider anthropic/);
        assert.match(command, /--model claude-compatible/);
      },
    );
  });

  it("uses Anthropic fallback credentials when Pi selects the Anthropic provider", () => {
    withEnv(
      {
        ANTHROPIC_API_KEY: "anthropic-key",
        OPENAI_API_KEY: "openai-key",
      },
      () => {
        const auth = JSON.parse(guestPiAuthJson());
        const piEnv = agentCredentialEnv("pi");

        assert.equal(auth.anthropic.key, "anthropic-key");
        assert.ok(piEnv.some(([key, value]) => key === "PI_API_KEY" && value === "anthropic-key"));
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
        const codexCommand = buildCodexActionCommand(state());
        const claudeCommand = buildClaudeActionCommand(state());

        assert.ok(codexEnv.some(([key, value]) => key === "OPENAI_API_KEY" && value === "llm-key"));
        assert.ok(codexEnv.some(([key, value]) => key === "CODEX_API_KEY" && value === "llm-key"));
        assert.ok(claudeEnv.some(([key, value]) => key === "ANTHROPIC_API_KEY" && value === "claude-key"));
        assert.match(codexConfig, /https:\/\/llm\.example\.com\/v1/);
        assert.match(codexConfig, /llm-model/);
        assert.match(codexConfig, /\[features\][\s\S]*multi_agent = true/);
        assert.match(codexConfig, /\[features\][\s\S]*multi_agent_v2 = true/);
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
      const claudeCommand = buildClaudeActionCommand(state());
      assert.ok(claudeCommand.includes("anthropic-secret"));
      for (const other of ["openai-secret", "pi-secret", "kimi-secret", "moonshot-secret"]) {
        assert.ok(!claudeCommand.includes(other), `Claude run exposed ${other}`);
      }

      const codexCommand = buildCodexActionCommand(state());
      assert.ok(codexCommand.includes("openai-secret"));
      for (const other of ["anthropic-secret", "pi-secret", "kimi-secret", "moonshot-secret"]) {
        assert.ok(!codexCommand.includes(other), `Codex run exposed ${other}`);
      }

      const kimiCommand = buildKimiActionCommand(state());
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

describe("token usage accounting", () => {
  it("extracts Claude usage from assistant stream JSON", () => {
    const usage = extractTokenUsageFromJsonl([
      JSON.stringify({
        type: "assistant",
        message: {
          usage: {
            input_tokens: 10,
            output_tokens: 4,
            cache_creation_input_tokens: 3,
            cache_read_input_tokens: 2,
          },
        },
      }),
    ].join("\n"), "claude");

    assert.deepEqual(usage, { input: 10, output: 4, cache: 5, total: 19, source: "claude" });
  });

  it("uses Claude's cumulative result usage instead of summing repeated stream snapshots", () => {
    const repeatedAssistant = {
      type: "assistant",
      message: {
        id: "msg_1",
        usage: {
          input_tokens: 3,
          output_tokens: 3,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 0,
        },
      },
    };
    const usage = extractTokenUsageFromJsonl([
      JSON.stringify(repeatedAssistant),
      JSON.stringify(repeatedAssistant),
      JSON.stringify({
        type: "result",
        usage: {
          input_tokens: 3,
          output_tokens: 3,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 0,
        },
      }),
    ].join("\n"), "claude");

    assert.deepEqual(usage, { input: 3, output: 3, cache: 100, total: 106, source: "claude" });
  });

  it("extracts Codex/OpenAI-style usage from the final JSON event", () => {
    const usage = extractTokenUsageFromJsonl([
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          prompt_tokens_details: { cached_tokens: 6 },
        },
      }),
    ].join("\n"), "codex");

    assert.deepEqual(usage, { input: 6, output: 8, cache: 6, total: 20, source: "codex" });
  });

  it("separates Codex cached_input_tokens from uncached input", () => {
    const usage = extractTokenUsageFromJsonl(JSON.stringify({
      type: "turn.completed",
      usage: {
        input_tokens: 100,
        cached_input_tokens: 80,
        output_tokens: 10,
      },
    }), "codex");

    assert.deepEqual(usage, { input: 20, output: 10, cache: 80, total: 110, source: "codex" });
  });

  it("sums usage across multiple reported model calls", () => {
    const usage = extractTokenUsageFromJsonl([
      JSON.stringify({ type: "turn.completed", usage: { prompt_tokens: 10, completion_tokens: 4 } }),
      JSON.stringify({ type: "turn.completed", usage: { prompt_tokens: 8, completion_tokens: 3 } }),
    ].join("\n"), "codex");

    assert.deepEqual(usage, { input: 18, output: 7, cache: 0, total: 25, source: "codex" });
  });

  it("counts each finalized Pi message once and includes cache reads and writes", () => {
    const message = {
      role: "assistant",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 20,
        cacheWrite: 4,
        totalTokens: 39,
      },
    };
    const usage = extractTokenUsageFromJsonl([
      JSON.stringify({ type: "message_start", message }),
      JSON.stringify({ type: "message_update", message }),
      JSON.stringify({ type: "message_end", message }),
      JSON.stringify({ type: "turn_end", message }),
    ].join("\n"), "pi");

    assert.deepEqual(usage, { input: 10, output: 5, cache: 24, total: 39, source: "pi" });
  });

  it("does not estimate usage when JSONL has no reported counts", () => {
    assert.equal(extractTokenUsageFromJsonl(JSON.stringify({ type: "turn.completed" })), undefined);
  });

  it("materializes token usage onto runs and sessions", () => {
    const sessionId = "ses_tokens";
    const events = [
      relayEvent("session.created", sessionId, {
        workspacePath: "/workspace",
        taskGoal: "count tokens",
        participants: ["human", "codex"],
      }),
      relayEvent("collaboration.round.started", sessionId, {
        manifest: {
          collaborationId: "col_1",
          roundId: "round_1",
          source: "task",
          purpose: "accomplish",
          strategy: "coordinate",
          address: { kind: "room" },
          assignments: [{ assignmentId: "assignment_1", agentId: "agent_builder", mode: "action", phase: "execution" }],
          completionPolicy: "assigned_work",
        },
      }),
      relayEvent("agent.started", sessionId, {
        runId: "run_1",
        assignmentId: "assignment_1",
        agent: "codex",
        role: "fixer",
        mode: "action",
        logicalAgentId: "agent_builder",
        placementId: "placement_1",
        daemonNodeId: "node_1",
        agentVersion: 7,
        workspaceIdentity: { workspacePath: "/workspace" },
        brief: "Implement the migration.",
        coordinator: true,
        teamSnapshot: {
          teamId: "team_1",
          memberAgentIds: ["agent_builder", "agent_reviewer"],
          leadAgentId: "agent_builder",
        },
        teamPhase: "execution",
      }),
      relayEvent("agent.completed", sessionId, {
        runId: "run_1",
        agent: "codex",
        status: "completed",
        exitCode: 0,
        tokenUsage: { input: 5, output: 7, cache: 3, total: 15, source: "codex" },
      }),
    ];

    const session = materializeEvents(events);

    assert.deepEqual(session.agentRuns[0].tokenUsage, { input: 5, output: 7, cache: 3, total: 15, source: "codex" });
    assert.equal(session.agentRuns[0].logicalAgentId, "agent_builder");
    assert.equal(session.agentRuns[0].placementId, "placement_1");
    assert.equal(session.agentRuns[0].daemonNodeId, "node_1");
    assert.equal(session.agentRuns[0].agentVersion, 7);
    assert.deepEqual(session.agentRuns[0].workspaceIdentity, { workspacePath: "/workspace" });
    assert.equal(session.agentRuns[0].assignmentId, "assignment_1");
    assert.equal(session.agentRuns[0].brief, "Implement the migration.");
    assert.equal(session.agentRuns[0].coordinator, true);
    assert.equal(session.agentRuns[0].teamPhase, "execution");
    assert.deepEqual(session.agentRuns[0].teamSnapshot?.memberAgentIds, ["agent_builder", "agent_reviewer"]);
    assert.equal(session.activeCollaborationId, "col_1");
    assert.equal(session.activeRoundId, "round_1");
    assert.equal(session.collaborationRevision, 1);
    assert.equal(session.collaborationRounds[0]?.strategy, "coordinate");
    assert.deepEqual(session.tokenUsage, { input: 5, output: 7, cache: 3, total: 15 });
  });

  it("clears pending feedback when materializing terminal session events", () => {
    const sessionId = "ses_terminal_feedback";
    const events = [
      relayEvent("session.created", sessionId, {
        workspacePath: "/workspace",
        taskGoal: "finish session",
        participants: ["human", "codex"],
      }),
      relayEvent("session.status", sessionId, {
        status: "waiting_for_human",
        phase: "feedback",
        pendingDecision: "feedback",
      }),
      relayEvent("session.completed", sessionId, {
        outcome: "done",
      }),
    ];

    const session = materializeEvents(events);

    assert.equal(session.status, "completed");
    assert.equal(session.pendingDecision, undefined);
  });

  it("clears pending feedback when materializing cancel decisions", () => {
    const sessionId = "ses_cancel_feedback";
    const events = [
      relayEvent("session.created", sessionId, {
        workspacePath: "/workspace",
        taskGoal: "cancel session",
        participants: ["human", "codex"],
      }),
      relayEvent("session.status", sessionId, {
        status: "waiting_for_human",
        phase: "feedback",
        pendingDecision: "feedback",
      }),
      relayEvent("human.decision", sessionId, {
        decision: {
          id: "dec_cancel",
          kind: "cancel",
          createdAt: new Date().toISOString(),
        },
      }),
    ];

    const session = materializeEvents(events);

    assert.equal(session.status, "cancelled");
    assert.equal(session.pendingDecision, undefined);
  });

  it("applies session.renamed to the materialized title", () => {
    const sessionId = "ses_titled";
    const base = materializeEvents([
      relayEvent("session.created", sessionId, {
        workspacePath: "/workspace",
        taskGoal: "fix the auth redirect bug",
        participants: ["human"],
      }),
    ]);
    // Unset by default — callers fall back to taskGoal for the label.
    assert.equal(base.title, undefined);

    const renamed = materializeEvents([
      relayEvent("session.created", sessionId, {
        workspacePath: "/workspace",
        taskGoal: "fix the auth redirect bug",
        participants: ["human"],
      }),
      relayEvent("session.renamed", sessionId, { title: "Auth bug" }),
    ]);
    assert.equal(renamed.title, "Auth bug");
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
      assert.equal(getAgent(agent).defaultMode, "action");
    }
  });

  it("embeds the task goal in the Kimi implement command without leaking raw JSONL", () => {
    withEnv(
      {
        RELAY_AGENT_HOME: "/tmp/relay-agent-home",
        RELAY_AGENT_WORKSPACE: "/tmp/relay-host-workspace",
        RELAY_RUN_AS_CURRENT_USER: "1",
        KIMI_MODEL: "kimi-test",
      },
      () => {
        const command = buildKimiActionCommand(state({ task_goal: "Wire up Kimi" }));
        assert.match(command, /kimi --model kimi-test --output-format stream-json --prompt/);
        assert.match(command, /Wire up Kimi/);
        assert.ok(command.indexOf("--model kimi-test") < command.indexOf("--prompt"));
        assert.doesNotMatch(command, /--yolo/);
        assert.doesNotMatch(command, /--auto/);
        assert.doesNotMatch(command, /stdbuf/);
      },
    );
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
