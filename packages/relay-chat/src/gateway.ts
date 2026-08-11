import type { RelaySession } from "relay-core";
import type {
  ChatAgentRequest,
  ChatCancelRequest,
  ChatConversationRef,
  ChatConversationBinding,
  ChatIdentity,
  ChatIdentityResolver,
  ChatRun,
  ChatSessionSink,
  ChatStatusRequest,
  RelayChatBackend,
} from "./types.js";

export interface RelayChatGatewayOptions {
  backend: RelayChatBackend;
  identities: ChatIdentityResolver;
}

export class RelayChatGateway {
  private readonly backend: RelayChatBackend;
  private readonly identities: ChatIdentityResolver;

  constructor(options: RelayChatGatewayOptions) {
    this.backend = options.backend;
    this.identities = options.identities;
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
      let session: RelaySession;
      if (sessionId) {
        if (!this.backend.continueThread) {
          throw new Error("The Relay backend does not support semantic thread continuation.");
        }
        session = await this.backend.continueThread({
          sessionId,
          taskGoal: request.taskGoal,
          employeeId: identity.employeeId,
          idempotencyKey: request.idempotencyKey,
          signal,
        });
      } else {
        const agentId = await this.resolveAgentId(identity, request.agentId, signal);
        if (!agentId || !this.backend.startAgentRun) {
          throw new Error(`No ready Relay agent is configured for ${identity.employeeId}.`);
        }
        session = await this.backend.startAgentRun({
            agentId,
            taskGoal: request.taskGoal,
            employeeId: identity.employeeId,
            idempotencyKey: request.idempotencyKey,
            signal,
          });
      }
      // Persist the thread -> session binding so follow-ups, status, and cancel
      // resume the same conversation after a bot restart.
      const run: ChatRun = { session, conversation: request, recovery: "persisted" };
      try {
        if (!this.backend.bindConversationSession) {
          throw new Error("The Relay backend does not support persistent conversation bindings.");
        }
        await this.backend.bindConversationSession(request, session.id, signal);
      } catch (error) {
        run.recovery = "degraded";
        await sink.started?.(run);
        await sink.degraded?.(error, run);
        void this.followSession(session.id, identity.employeeId, sink, signal);
        return run;
      }
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

  async conversationBinding(ref: ChatConversationRef, signal?: AbortSignal): Promise<ChatConversationBinding | undefined> {
    await this.requireIdentity(ref);
    return this.backend.resolveConversationBinding?.(ref, signal);
  }

  /** Rebind a chat thread to an existing session for `/relay switch`. */
  async switchConversation(ref: ChatConversationRef, sessionId: string, signal?: AbortSignal): Promise<void> {
    await this.requireIdentity(ref);
    await this.backend.bindConversationSession?.(ref, sessionId, signal);
  }

  async cancel(request: ChatCancelRequest, signal?: AbortSignal): Promise<RelaySession> {
    const identity = await this.requireIdentity(request);
    if (!this.backend.cancelSessionRun) throw new Error("The Relay backend does not support session cancellation.");
    return this.backend.cancelSessionRun({
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

  private async resolveAgentId(identity: ChatIdentity, requestedAgentId: string | undefined, signal?: AbortSignal): Promise<string | undefined> {
    const agents = await this.backend.listEmployeeAgents?.(identity.employeeId, signal);
    const agentId = requestedAgentId ?? identity.defaultAgentId;
    if (!agentId) return undefined;
    return agents?.find((agent) => agent.id === agentId && agent.availability === "ready")?.id;
  }
}
