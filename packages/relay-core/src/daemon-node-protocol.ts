import type { AgentName, AgentState, ReviewVerdict, AgentTaskMode } from "./state.js";
import type { TokenUsage } from "./token-usage.js";

export type DaemonNodeStatus = "ready" | "busy" | "stopped";
export type DaemonAgentAdapter = "cli" | "service";
export type DaemonAgentHealthStatus = "ready" | "failed";

export interface DaemonAgentHealth {
  status: DaemonAgentHealthStatus;
  detail?: string;
  version?: string;
  adapter?: DaemonAgentAdapter;
}

export type DaemonMcpTransport = "stdio" | "sse" | "http";

/** A SKILL.md directory installed in an agent's home inside the node. */
export interface DaemonAgentSkill {
  name: string;
  namespace?: string;
  description?: string;
}

/** An MCP server configured for an agent CLI inside the node. */
export interface DaemonAgentMcpServer {
  name: string;
  transport: DaemonMcpTransport;
  command?: string;
}

/** What an agent CLI actually has installed inside the node. */
export interface DaemonAgentInventory {
  skills: DaemonAgentSkill[];
  mcpServers: DaemonAgentMcpServer[];
}

export const DAEMON_NODE_PROTOCOL_VERSION = 1 as const;
export const DAEMON_NODE_SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [1];

export interface DaemonNodeRegistration {
  sandboxId: string;
  employeeId?: string;
  token: string;
  workspacePath?: string;
  protocolVersion: number;
  supportedAgents: AgentName[];
  agentHealth?: Partial<Record<AgentName, DaemonAgentHealth>>;
  agentInventory?: Partial<Record<AgentName, DaemonAgentInventory>>;
  status?: DaemonNodeStatus;
}

export interface DaemonNodeRunCommand {
  id: string;
  type: "run.start";
  leaseId?: string;
  leaseExpiresAt?: string;
  attempt?: number;
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
  leaseId?: string;
  leaseExpiresAt?: string;
  attempt?: number;
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
      leaseId?: string;
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
      leaseId?: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      mode: AgentTaskMode;
      exitCode: number;
      agentLog: string;
      reviewVerdict?: ReviewVerdict | "";
      reviewFeedback?: string;
      tokenUsage?: TokenUsage;
    }
  | {
      type: "run.failed";
      commandId: string;
      leaseId?: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      mode: AgentTaskMode;
      error: string;
      agentLog?: string;
      exitCode?: number;
    }
  | {
      type: "run.cancelled";
      commandId: string;
      leaseId?: string;
      sessionId: string;
      runId: string;
      agent: AgentName;
      mode: AgentTaskMode;
      reason: string;
    };
