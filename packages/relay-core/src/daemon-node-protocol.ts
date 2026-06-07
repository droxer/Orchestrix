import type { AgentName, CodexReviewVerdict, CodexTaskMode } from "./state.js";

export type DaemonNodeStatus = "ready" | "busy" | "stopped";

export interface DaemonNodeRegistration {
  sandboxId: string;
  employeeId: string;
  token: string;
  workspacePath?: string;
  protocolVersion: 1;
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
}

export type DaemonNodeCommand = DaemonNodeRunCommand;

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
    };
