import {
  acquireBoxliteHomeLock,
  importBoxLite,
  type BoxliteHomeLock,
} from "./box.js";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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
  boxliteHome: string;
  hostUid: number;
  hostGid: number;
  syncedUid: number;
  syncedGid: number;
}

export interface OrchestratorSessionOptions {
  boxName?: string;
  workspacePath?: string;
  boxliteHome?: string;
  executionManager?: ExecutionManager;
}

export interface ActiveOrchestratorSession {
  session: OrchestratorSession;
  close(): Promise<void>;
}

const readyAgents = new Set<AgentName>();

export function resolveBoxliteHome(hostWorkspace: string, override = process.env.RELAY_BOXLITE_HOME): string {
  const explicit = override?.trim();
  if (explicit) return resolve(explicit);
  const workspacePath = resolve(hostWorkspace);
  const digest = createHash("sha256").update(workspacePath).digest("hex").slice(0, 12);
  return join(homedir(), ".relay", "boxlite", digest);
}

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
  // Skills are shared across every agent under ~/.claude/skills.
  await executionManager.prepareAgentSkills(signal);
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
  const executionManager = options.executionManager ?? defaultExecutionManager;
  const hostWorkspace = options.workspacePath ?? hostWorkspacePath();
  const boxliteHome = resolveBoxliteHome(hostWorkspace, options.boxliteHome);
  resetAgentReadiness();
  if (!sink) {
    console.log(section("Relay", ansi.cyan));
    console.log(keyValue("image", DEVBOX_IMAGE));
    console.log(keyValue("mount", GUEST_WORKSPACE));
  } else {
    sink(`${keyValue("image", DEVBOX_IMAGE)}\n`);
    sink(`${keyValue("mount", GUEST_WORKSPACE)}\n`);
  }
  const rootfsPath = executionManager.ensureImage(sink);
  mkdirSync(boxliteHome, { recursive: true });
  let homeLock: BoxliteHomeLock | undefined;
  let runtime: any | undefined;
  const boxName = options.boxName ?? "relay";
  const close = async (): Promise<void> => {
    try {
      resetAgentReadiness();
      if (runtime) {
        await executionManager.stopActiveSandbox();
        await executionManager.removeSandbox(runtime, boxName);
      }
    } finally {
      runtime?.close?.();
      homeLock?.release();
    }
  };
  try {
    homeLock = acquireBoxliteHomeLock(boxliteHome);
    const { JsBoxlite } = await importBoxLite();
    runtime = new JsBoxlite({ homeDir: boxliteHome });
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
    emitOrPrint(sink, keyValue("boxlite-home", boxliteHome));

    const [syncedUid, syncedGid] = await executionManager.prepareWorkspace(hostWorkspace);
    emitOrPrint(sink, keyValue("owner", `uid=${syncedUid} gid=${syncedGid} (host uid=${hostUid} gid=${hostGid})`));
    emitOrPrint(sink, keyValue("codex", `provider=dashscope base_url=${process.env.OPENAI_BASE_URL || "(default)"}`));
    emitOrPrint(sink, keyValue("pi", `provider=${piProvider()} model=${piModel() || "(default)"} base_url=${piBaseUrl() || "(default)"}`));

    return {
      session: {
        rootfsPath,
        hostWorkspace,
        boxliteHome,
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
