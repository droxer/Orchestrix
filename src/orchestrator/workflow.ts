import {
  activeBox,
  collectExecution,
  ensureLocalDevboxOci,
  ensureSingleOrchestrator,
  importBoxLite,
  prepareGuestAgentAuth,
  prepareGuestWorkspace,
  setSessionBox,
  stopSessionBox,
} from "./box.js";
import {
  DEVBOX_IMAGE,
  hostWorkspaceOwner,
  hostWorkspacePath,
  piBaseUrl,
  piModel,
  piProvider,
} from "./env.js";
import { ansi, emitOrPrint, keyValue, section, status, type AgentOutputSink } from "./format.js";
import { guestAgentEnv, runAsAgent, setSessionGuestEnv } from "./guest.js";
import { buildPiPreflightCommand } from "./commands.js";
import {
  claudeImplementNode,
  codexImplementNode,
  codexReviewNode,
  piImplementNode,
} from "./nodes.js";
import {
  routeClaudeHandoff,
  routeCodexHandoff,
  routePiHandoff,
  type Route,
} from "./routing.js";
import {
  GUEST_WORKSPACE,
  initialAgentState,
  mergeAgentState,
  type AgentName,
  type AgentRunOptions,
  type AgentState,
  type CodexTaskMode,
} from "./state.js";

export interface OrchestratorSession {
  rootfsPath: string;
  hostWorkspace: string;
  hostUid: number;
  hostGid: number;
  syncedUid: number;
  syncedGid: number;
}

const readyAgents = new Set<AgentName>();

export function resetAgentReadiness(): void {
  readyAgents.clear();
}

export async function ensureAgentReady(agent: AgentName, sink?: AgentOutputSink, signal?: AbortSignal): Promise<void> {
  if (readyAgents.has(agent)) return;
  if (signal?.aborted) throw new Error(`${agent} readiness cancelled.`);
  if (agent === "codex" || agent === "pi") {
    await prepareGuestAgentAuth([agent], signal);
  }
  const [name, command] = agent === "claude"
    ? ["Claude Code", runAsAgent("claude --version")]
    : agent === "codex"
      ? ["Codex auth", runAsAgent("codex login status")]
      : ["Pi coding agent", buildPiPreflightCommand()];
  const result = await collectExecution(await activeBox().exec("bash", ["-c", command]), false, undefined, undefined, undefined, signal);
  if (result.exit_code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`${name} preflight failed. ${detail}`);
  }
  readyAgents.add(agent);
  emitOrPrint(sink, status("ok", `${name} ready.`));
}

export async function runAgentTask(
  agent: AgentName,
  taskGoal: string,
  mode: CodexTaskMode = "implement",
  options: AgentRunOptions = {},
): Promise<AgentState> {
  let state = initialAgentState(taskGoal);
  if (agent === "claude") {
    state = mergeAgentState(state, await claudeImplementNode(state, options));
  } else if (agent === "pi") {
    state = mergeAgentState(state, await piImplementNode(state, options));
  } else if (mode === "review") {
    state = mergeAgentState(state, await codexReviewNode(state, options));
  } else {
    state = mergeAgentState(state, await codexImplementNode(state, options));
  }
  return state;
}

export async function runWorkflow(initialState: AgentState, options: AgentRunOptions = {}): Promise<AgentState> {
  let state = initialState;
  let next: Route = "claude_implement";
  while (next !== "__end__") {
    if (next === "claude_implement") {
      await ensureAgentReady("claude", options.sink, options.signal);
      state = mergeAgentState(state, await claudeImplementNode(state, options));
      next = routeClaudeHandoff(state, options.sink);
    } else if (next === "pi_implement") {
      await ensureAgentReady("pi", options.sink, options.signal);
      state = mergeAgentState(state, await piImplementNode(state, options));
      next = routePiHandoff(state, options.sink);
    } else {
      await ensureAgentReady("codex", options.sink, options.signal);
      state = mergeAgentState(state, await codexReviewNode(state, options));
      next = routeCodexHandoff(state, options.sink);
    }
  }
  return state;
}

export async function withOrchestratorSession<T>(
  action: (session: OrchestratorSession) => Promise<T>,
  sink?: AgentOutputSink,
): Promise<T> {
  ensureSingleOrchestrator();
  resetAgentReadiness();
  if (!sink) {
    console.log(section("Relay", ansi.cyan));
    console.log(keyValue("image", DEVBOX_IMAGE));
    console.log(keyValue("mount", GUEST_WORKSPACE));
  } else {
    sink(`${keyValue("image", DEVBOX_IMAGE)}\n`);
    sink(`${keyValue("mount", GUEST_WORKSPACE)}\n`);
  }
  const rootfsPath = ensureLocalDevboxOci(sink);
  const hostWorkspace = hostWorkspacePath();

  const { JsBoxlite } = await importBoxLite();
  const runtime = JsBoxlite.withDefaultConfig();
  const boxName = "relay";
  try {
    const [hostUid, hostGid] = hostWorkspaceOwner(hostWorkspace);
    const guestEnv = guestAgentEnv(hostWorkspace);
    setSessionGuestEnv(guestEnv);
    const env = guestEnv.map(([key, value]) => ({ key, value }));
    const box = await runtime.create(
      {
        rootfsPath,
        volumes: [{ hostPath: hostWorkspace, guestPath: GUEST_WORKSPACE, readOnly: false }],
        env,
        workingDir: GUEST_WORKSPACE,
      },
      boxName,
    );
    setSessionBox(box);
    emitOrPrint(sink, keyValue("rootfs", rootfsPath));
    emitOrPrint(sink, keyValue("workspace", hostWorkspace));

    const [syncedUid, syncedGid] = await prepareGuestWorkspace(hostWorkspace);
    emitOrPrint(sink, keyValue("owner", `uid=${syncedUid} gid=${syncedGid} (host uid=${hostUid} gid=${hostGid})`));
    emitOrPrint(sink, keyValue("codex", `provider=dashscope base_url=${process.env.OPENAI_BASE_URL || "(default)"}`));
    emitOrPrint(sink, keyValue("pi", `provider=${piProvider()} model=${piModel() || "(default)"} base_url=${piBaseUrl() || "(default)"}`));

    return await action({
      rootfsPath,
      hostWorkspace,
      hostUid,
      hostGid,
      syncedUid,
      syncedGid,
    });
  } finally {
    await stopSessionBox();
    resetAgentReadiness();
    if (runtime.remove) await runtime.remove(boxName);
  }
}

export async function main(taskGoal: string): Promise<void> {
  await withOrchestratorSession(async () => {
    await runWorkflow(initialAgentState(taskGoal));
  });
}

export function run(argv: string[] = process.argv.slice(2)): void {
  if (argv[0] === "run-workflow") {
    const taskGoal = argv.slice(1).join(" ").trim();
    if (!taskGoal) {
      throw new Error("Usage: relay run-workflow <task>");
    }
    main(taskGoal).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
    return;
  }
  if (argv.length > 0) {
    throw new Error(`Unknown arguments: ${argv.join(" ")}`);
  }
  import("../tui.js").then(({ runInteractiveTui }) => runInteractiveTui()).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
