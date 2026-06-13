import {
  ensureSingleOrchestrator,
  importBoxLite,
} from "./box.js";
import {
  DEVBOX_IMAGE,
  GUEST_WORKSPACE,
  ansi,
  emitOrPrint,
  getAgent,
  guestAgentEnv,
  hostWorkspaceOwner,
  hostWorkspacePath,
  keyValue,
  piBaseUrl,
  piModel,
  piProvider,
  section,
  setSessionGuestEnv,
  type AgentName,
  type AgentOutputSink,
} from "relay-core";
import { defaultExecutionManager, type ExecutionManager } from "./execution.js";

export interface OrchestratorSession {
  rootfsPath: string;
  hostWorkspace: string;
  hostUid: number;
  hostGid: number;
  syncedUid: number;
  syncedGid: number;
}

export interface OrchestratorSessionOptions {
  boxName?: string;
  workspacePath?: string;
  executionManager?: ExecutionManager;
  /**
   * pgrep pattern used to refuse starting a second BoxLite runtime. The
   * default matches any Relay process; long-lived daemons pass a narrower
   * pattern so the backend and TUI running alongside them do not trip it.
   */
  singleInstancePattern?: string;
}

export interface ActiveOrchestratorSession {
  session: OrchestratorSession;
  close(): Promise<void>;
}

const readyAgents = new Set<AgentName>();

export function resetAgentReadiness(): void {
  readyAgents.clear();
}

export async function ensureAgentReady(
  agent: AgentName,
  sink?: AgentOutputSink,
  signal?: AbortSignal,
  executionManager: ExecutionManager = defaultExecutionManager,
): Promise<void> {
  if (readyAgents.has(agent)) return;
  if (signal?.aborted) throw new Error(`${agent} readiness cancelled.`);
  const def = getAgent(agent);
  if (def.needsGuestAuth) {
    await executionManager.prepareAgentAuth([agent], signal);
  }
  const result = await executionManager.runShell(def.preflight.command(), signal);
  if (result.exit_code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`${def.preflight.label} preflight failed. ${detail}`);
  }
  readyAgents.add(agent);
}

export async function startOrchestratorSession(
  sink?: AgentOutputSink,
  options: OrchestratorSessionOptions = {},
): Promise<ActiveOrchestratorSession> {
  ensureSingleOrchestrator(options.singleInstancePattern);
  resetAgentReadiness();
  if (!sink) {
    console.log(section("Relay", ansi.cyan));
    console.log(keyValue("image", DEVBOX_IMAGE));
    console.log(keyValue("mount", GUEST_WORKSPACE));
  } else {
    sink(`${keyValue("image", DEVBOX_IMAGE)}\n`);
    sink(`${keyValue("mount", GUEST_WORKSPACE)}\n`);
  }
  const executionManager = options.executionManager ?? defaultExecutionManager;
  const rootfsPath = executionManager.ensureImage(sink);
  const hostWorkspace = options.workspacePath ?? hostWorkspacePath();

  const { JsBoxlite } = await importBoxLite();
  const runtime = JsBoxlite.withDefaultConfig();
  const boxName = options.boxName ?? "relay";
  const close = async (): Promise<void> => {
    await executionManager.stopActiveSandbox();
    resetAgentReadiness();
    await executionManager.removeSandbox(runtime, boxName);
  };
  try {
    const [hostUid, hostGid] = hostWorkspaceOwner(hostWorkspace);
    const guestEnv = guestAgentEnv(hostWorkspace);
    setSessionGuestEnv(guestEnv);
    const env = guestEnv.map(([key, value]) => ({ key, value }));
    const sandbox = await executionManager.createSandbox(runtime, {
      rootfsPath,
      boxName,
      volumes: [{ hostPath: hostWorkspace, guestPath: GUEST_WORKSPACE, readOnly: false }],
      env,
      workingDir: GUEST_WORKSPACE,
      autoRemove: true,
    });
    executionManager.setActiveSandbox(sandbox);
    emitOrPrint(sink, keyValue("box", boxName));
    emitOrPrint(sink, keyValue("rootfs", rootfsPath));
    emitOrPrint(sink, keyValue("workspace", hostWorkspace));

    const [syncedUid, syncedGid] = await executionManager.prepareWorkspace(hostWorkspace);
    emitOrPrint(sink, keyValue("owner", `uid=${syncedUid} gid=${syncedGid} (host uid=${hostUid} gid=${hostGid})`));
    emitOrPrint(sink, keyValue("codex", `provider=dashscope base_url=${process.env.OPENAI_BASE_URL || "(default)"}`));
    emitOrPrint(sink, keyValue("pi", `provider=${piProvider()} model=${piModel() || "(default)"} base_url=${piBaseUrl() || "(default)"}`));

    return {
      session: {
        rootfsPath,
        hostWorkspace,
        hostUid,
        hostGid,
        syncedUid,
        syncedGid,
      },
      close,
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

export async function withOrchestratorSession<T>(
  action: (session: OrchestratorSession) => Promise<T>,
  sink?: AgentOutputSink,
  options: OrchestratorSessionOptions = {},
): Promise<T> {
  const active = await startOrchestratorSession(sink, options);
  try {
    return await action(active.session);
  } finally {
    await active.close();
  }
}
