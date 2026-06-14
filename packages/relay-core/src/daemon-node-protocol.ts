import type { AgentName, AgentState, CodexReviewVerdict, CodexTaskMode } from "./state.js";

export type DaemonNodeStatus = "ready" | "busy" | "stopped";

export const DAEMON_NODE_PROTOCOL_VERSION = 1 as const;
export const DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [1];

export interface DaemonNodeRegistration {
  sandboxId: string;
  employeeId?: string;
  token: string;
  workspacePath?: string;
  protocolVersion: number;
  supportedAgents: AgentName[];
  status?: DaemonNodeStatus;
}

export interface DaemonNodeRunCommand {
  id: string;
  type: "run.start";
  sessionId: string;
  runId: string;
  taskGoal: string;
  agent: AgentName;
  mode: CodexTaskMode;
  workspacePath?: string;
  state?: AgentState;
}

export interface DaemonNodeCancelCommand {
  id: string;
  type: "run.cancel";
  commandId: string;
  sessionId: string;
  runId: string;
  agent: AgentName;
  mode: CodexTaskMode;
  reason: string;
}

export type DaemonNodeCommand = DaemonNodeRunCommand | DaemonNodeCancelCommand;

export type DaemonNodeEvent =
  | {
      type: "run.output";
      commandId: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      stream: "stdout" | "stderr";
      text: string;
      sequence: number;
    }
  | {
      type: "run.completed";
      commandId: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      mode: CodexTaskMode;
      exitCode: number;
      agentLog: string;
      codexVerdict?: CodexReviewVerdict | "";
      codexFeedback?: string;
    }
  | {
      type: "run.failed";
      commandId: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      mode: CodexTaskMode;
      error: string;
      exitCode?: number;
    }
  | {
      type: "run.cancelled";
      commandId: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      mode: CodexTaskMode;
      reason: string;
    };
