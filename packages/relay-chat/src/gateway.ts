import type { RelaySession } from "relay-core";
import type {
  ChatAgentRequest,
  ChatCancelRequest,
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
    const sandboxId = await this.requireSandbox(identity, request);
    try {
      const session = await this.backend.startSandboxRun({
        sandboxId,
        taskGoal: request.taskGoal,
        assignments: [{ agent: request.agent, mode: request.mode }],
        sessionId: request.sessionId,
        employeeId: identity.employeeId,
        signal,
      });
      const run = { session, conversation: request };
      await sink.started?.(run);
      void this.followSession(session.id, identity.employeeId, sink, signal);
      return run;
    } catch (error) {
      await sink.failed?.(error);
      throw error;
    }
  }

  async cancel(request: ChatCancelRequest, signal?: AbortSignal): Promise<RelaySession> {
    const identity = await this.requireIdentity(request);
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

  private async requireIdentity(ref: ChatAgentRequest | ChatCancelRequest | ChatStatusRequest): Promise<ChatIdentity> {
    const identity = await this.identities.resolve(ref);
    if (!identity) {
      throw new Error(`No Relay employee is linked to ${ref.provider} user ${ref.externalUserId}.`);
    }
    return identity;
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
