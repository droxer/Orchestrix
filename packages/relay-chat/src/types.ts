import type { AgentName } from "relay-core";
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
  defaultAgentId?: string;
  isAdmin?: boolean;
}

export interface ChatIdentityResolver {
  resolve(ref: ChatConversationRef): Promise<ChatIdentity | undefined>;
}

export interface ChatAgentRequest extends ChatConversationRef {
  taskGoal: string;
  agentId?: string;
  sessionId?: string;
  /** Start a fresh conversation, ignoring any existing thread->session binding. */
  forceNew?: boolean;
  idempotencyKey?: string;
}

export interface ChatCancelRequest extends ChatConversationRef {
  sessionId: string;
  reason?: string;
}

export interface ChatStatusRequest extends ChatConversationRef {
  sessionId: string;
}

export type ChatCommand =
  | { kind: "run"; taskGoal: string; agentId?: string; sessionId?: string }
  | { kind: "new"; taskGoal: string; agentId?: string }
  | { kind: "list" }
  | { kind: "switch"; sessionId: string }
  | { kind: "status"; sessionId: string }
  | { kind: "cancel"; sessionId: string; reason?: string };

export interface ChatRun {
  session: RelaySession;
  conversation: ChatConversationRef;
  recovery: "persisted" | "degraded";
}

export interface ChatConversationBinding {
  session?: RelaySession;
  providerMessageId?: string;
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
  degraded?(error: unknown, run: ChatRun): Promise<void> | void;
  failed?(error: unknown): Promise<void> | void;
}

export interface RelayChatRequestContext {
  employeeId?: string;
  signal?: AbortSignal;
}

export interface RelayChatBackend {
  listEmployeeAgents?(employeeId: string, signal?: AbortSignal): Promise<Array<{ id: string; executorKind: AgentName; availability: string }>>;
  startAgentRun?(input: {
    agentId: string;
    taskGoal: string;
    sessionId?: string;
    employeeId?: string;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }): Promise<RelaySession>;
  continueThread?(input: {
    sessionId: string;
    taskGoal: string;
    employeeId?: string;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }): Promise<RelaySession>;
  cancelSessionRun?(input: {
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
  /** The live session a chat thread is currently bound to, if any. */
  resolveConversationSession?(ref: ChatConversationRef, signal?: AbortSignal): Promise<RelaySession | undefined>;
  resolveConversationBinding?(ref: ChatConversationRef, signal?: AbortSignal): Promise<ChatConversationBinding | undefined>;
  /** Bind (or rebind) a chat thread to one of the owner's sessions. */
  bindConversationSession?(ref: ChatConversationRef, sessionId: string, signal?: AbortSignal): Promise<void>;
  /** The owner's open conversations, for list/switch commands. */
  listConversationSessions?(ref: ChatConversationRef, signal?: AbortSignal): Promise<RelaySession[]>;
}
