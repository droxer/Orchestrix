import type { RelaySession } from "relay-core";
import type {
  ChatAgentRequest,
  ChatCancelRequest,
  ChatConversationRef,
  ChatIdentity,
  ChatIdentityResolver,
  ChatRun,
  ChatSandboxResolver,
  ChatSessionSink,
  ChatStatusRequest,
  RelayChatBackend,
} from "./types.js";

export interface RelayChatGatewayOptions {
  backend: RelayChatBackend;
  identities: ChatIdentityResolver;
  sandboxes?: ChatSandboxResolver;
}

export class RelayChatGateway {
  private readonly backend: RelayChatBackend;
  private readonly identities: ChatIdentityResolver;
  private readonly sandboxes?: ChatSandboxResolver;

  constructor(options: RelayChatGatewayOptions) {
    this.backend = options.backend;
    this.identities = options.identities;
    this.sandboxes = options.sandboxes;
  }

  async run(request: ChatAgentRequest, sink: ChatSessionSink = {}, signal?: AbortSignal): Promise<ChatRun> {
    const identity = await this.requireIdentity(request);
    try {
      // Continue the session this thread is already bound to unless the caller
      // pinned one explicitly or asked for a fresh conversation (/relay new).
      let sessionId = request.sessionId;
      if (!sessionId && !request.forceNew) {
        sessionId = (await this.backend.resolveConversationSession?.(request, signal))?.id;
      }
      const agentId = await this.resolveAgentId(identity, request.agent, signal);
      if (!agentId || !this.backend.startAgentRun) {
        throw new Error(`No ready Relay agent is configured for ${identity.employeeId}.`);
      }
      const session = await this.backend.startAgentRun({
            agentId,
            taskGoal: request.taskGoal,
            mode: request.mode,
            sessionId,
            employeeId: identity.employeeId,
            signal,
          });
      // Persist the thread -> session binding so follow-ups, status, and cancel
      // resume the same conversation after a bot restart.
      try {
        await this.backend.bindConversationSession?.(request, session.id, signal);
      } catch {
        // The run is already active; keep the live stream usable even if the
        // durable chat mapping cannot be refreshed.
      }
      const run = { session, conversation: request };
      await sink.started?.(run);
      void this.followSession(session.id, identity.employeeId, sink, signal);
      return run;
    } catch (error) {
      await sink.failed?.(error);
      throw error;
    }
  }

  /** The owner's open conversations for a `/relay list` command. */
  async listConversations(ref: ChatConversationRef, signal?: AbortSignal): Promise<RelaySession[]> {
    await this.requireIdentity(ref);
    return (await this.backend.listConversationSessions?.(ref, signal)) ?? [];
  }

  /** Rebind a chat thread to an existing session for `/relay switch`. */
  async switchConversation(ref: ChatConversationRef, sessionId: string, signal?: AbortSignal): Promise<void> {
    await this.requireIdentity(ref);
    await this.backend.bindConversationSession?.(ref, sessionId, signal);
  }

  async cancel(request: ChatCancelRequest, signal?: AbortSignal): Promise<RelaySession> {
    const identity = await this.requireIdentity(request);
    if (this.backend.cancelSessionRun) {
      return this.backend.cancelSessionRun({
        sessionId: request.sessionId,
        reason: request.reason,
        employeeId: identity.employeeId,
        signal,
      });
    }
    const sandboxId = request.sandboxId ?? identity.defaultSandboxId;
    if (!sandboxId) throw new Error(`No sandbox is configured for employee ${identity.employeeId}.`);
    return this.backend.cancelSandboxRun({
      sandboxId,
      sessionId: request.sessionId,
      reason: request.reason,
      employeeId: identity.employeeId,
      signal,
    });
  }

  async status(request: ChatStatusRequest, signal?: AbortSignal): Promise<RelaySession> {
    const identity = await this.requireIdentity(request);
    return this.backend.getSession(request.sessionId, { employeeId: identity.employeeId, signal });
  }

  private async followSession(sessionId: string, employeeId: string, sink: ChatSessionSink, signal?: AbortSignal): Promise<void> {
    try {
      await this.backend.streamSessionEvents(sessionId, async (event) => {
        await sink.event?.({ sessionId, event });
      }, { employeeId, signal });
      await sink.completed?.(await this.backend.getSession(sessionId, { employeeId, signal }));
    } catch (error) {
      await sink.failed?.(error);
    }
  }

  private async requireIdentity(ref: ChatConversationRef): Promise<ChatIdentity> {
    const identity = await this.identities.resolve(ref);
    if (!identity) {
      throw new Error(`No Relay employee is linked to ${ref.provider} user ${ref.externalUserId}.`);
    }
    return identity;
  }

  private async resolveAgentId(identity: ChatIdentity, executorKind: ChatAgentRequest["agent"], signal?: AbortSignal): Promise<string | undefined> {
    const agents = await this.backend.listEmployeeAgents?.(identity.employeeId, signal);
    if (identity.defaultAgentId) {
      const defaultAgent = agents?.find((agent) => agent.id === identity.defaultAgentId);
      if (defaultAgent?.executorKind === executorKind && defaultAgent.availability === "ready") {
        return defaultAgent.id;
      }
    }
    return agents?.find((agent) => agent.executorKind === executorKind && agent.availability === "ready")?.id;
  }

  private async requireSandbox(identity: ChatIdentity, request: ChatAgentRequest): Promise<string> {
    const sandboxId = request.sandboxId
      ?? await this.sandboxes?.resolve({ identity, request })
      ?? identity.defaultSandboxId;
    if (!sandboxId) {
      throw new Error(`No sandbox is configured for employee ${identity.employeeId}.`);
    }
    return sandboxId;
  }
}
