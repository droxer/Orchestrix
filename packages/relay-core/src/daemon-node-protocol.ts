import type { AgentName, AgentState, ReviewVerdict, AgentTaskMode } from "./state.js";

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
  mode: AgentTaskMode;
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
  mode: AgentTaskMode;
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
      mode: AgentTaskMode;
      exitCode: number;
      agentLog: string;
      reviewVerdict?: ReviewVerdict | "";
      reviewFeedback?: string;
    }
  | {
      type: "run.failed";
      commandId: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      mode: AgentTaskMode;
      error: string;
      exitCode?: number;
    }
  | {
      type: "run.cancelled";
      commandId: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      mode: AgentTaskMode;
      reason: string;
    };
