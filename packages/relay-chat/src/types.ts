import type { AgentName, AgentTaskMode } from "relay-core";
import type { RelayEvent, RelaySession } from "relay-core";

export type ChatProvider = "discord" | "telegram" | "lark";

export interface ChatConversationRef {
  provider: ChatProvider;
  externalUserId: string;
  conversationId: string;
  threadId?: string;
  messageId?: string;
  tenantId?: string;
}

export interface ChatIdentity {
  employeeId: string;
  displayName?: string;
  defaultSandboxId?: string;
  isAdmin?: boolean;
}

export interface ChatIdentityResolver {
  resolve(ref: ChatConversationRef): Promise<ChatIdentity | undefined>;
}

export interface ChatSandboxResolver {
  resolve(input: {
    identity: ChatIdentity;
    request: ChatAgentRequest;
  }): Promise<string | undefined>;
}

export interface ChatAgentRequest extends ChatConversationRef {
  taskGoal: string;
  agent: AgentName;
  mode: AgentTaskMode;
  sandboxId?: string;
  sessionId?: string;
}

export interface ChatCancelRequest extends ChatConversationRef {
  sandboxId?: string;
  sessionId: string;
  reason?: string;
}

export interface ChatStatusRequest extends ChatConversationRef {
  sessionId: string;
}

export type ChatCommand =
  | { kind: "run"; taskGoal: string; agent: AgentName; mode: AgentTaskMode; sandboxId?: string; sessionId?: string }
  | { kind: "status"; sessionId: string }
  | { kind: "cancel"; sessionId: string; sandboxId?: string; reason?: string };

export interface ChatRun {
  session: RelaySession;
  conversation: ChatConversationRef;
}

export interface ChatSessionUpdate {
  sessionId: string;
  event: RelayEvent;
  session?: RelaySession;
}

export interface ChatSessionSink {
  started?(run: ChatRun): Promise<void> | void;
  event?(update: ChatSessionUpdate): Promise<void> | void;
  completed?(session: RelaySession): Promise<void> | void;
  failed?(error: unknown): Promise<void> | void;
}

export interface RelayChatRequestContext {
  employeeId?: string;
  signal?: AbortSignal;
}

export interface RelayChatBackend {
  startSandboxRun(input: {
    sandboxId: string;
    taskGoal: string;
    assignments: Array<{ agent: AgentName; mode?: AgentTaskMode }>;
    sessionId?: string;
    employeeId?: string;
    signal?: AbortSignal;
  }): Promise<RelaySession>;
  cancelSandboxRun(input: {
    sandboxId: string;
    sessionId: string;
    reason?: string;
    employeeId?: string;
    signal?: AbortSignal;
  }): Promise<RelaySession>;
  getSession(sessionId: string, context?: RelayChatRequestContext): Promise<RelaySession>;
  streamSessionEvents(
    sessionId: string,
    onEvent: (event: RelayEvent) => Promise<void> | void,
    context?: RelayChatRequestContext,
  ): Promise<void>;
}
