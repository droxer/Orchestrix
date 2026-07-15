import type { RelaySession } from "relay-core";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { commandToAgentRequest, parseChatCommand } from "../commands.js";
import type {
  ChatAgentRequest,
  ChatCancelRequest,
  ChatConversationRef,
  ChatConversationBinding,
  ChatRun,
  ChatSessionSink,
  ChatStatusRequest,
} from "../types.js";

export interface ProviderHttpResponse {
  status: number;
  body?: unknown;
}

export interface ChatCommandGateway {
  run(request: ChatAgentRequest, sink?: ChatSessionSink, signal?: AbortSignal): Promise<ChatRun>;
  status(request: ChatStatusRequest, signal?: AbortSignal): Promise<RelaySession>;
  cancel(request: ChatCancelRequest, signal?: AbortSignal): Promise<RelaySession>;
  listConversations(ref: ChatConversationRef, signal?: AbortSignal): Promise<RelaySession[]>;
  switchConversation(ref: ChatConversationRef, sessionId: string, signal?: AbortSignal): Promise<void>;
  conversationBinding?(ref: ChatConversationRef, signal?: AbortSignal): Promise<ChatConversationBinding | undefined>;
}

export interface ProviderMessenger {
  send(text: string): Promise<string | undefined>;
  edit(messageId: string, text: string): Promise<void>;
}

export interface ProviderEventStore {
  claim(namespace: string, eventId: string): Promise<boolean>;
  complete(namespace: string, eventId: string): Promise<void>;
  release(namespace: string, eventId: string): Promise<void>;
}

export function retryProviderDispatch(
  label: string,
  operation: () => Promise<void>,
  eventStore: ProviderEventStore,
  namespace: string,
  eventId: string,
): void {
  void (async () => {
    let attempt = 0;
    for (;;) {
      try {
        await operation();
        for (;;) {
          try {
            await eventStore.complete(namespace, eventId);
            return;
          } catch (error) {
            console.error(`${label} completed but its event receipt could not be saved; retrying.`, error);
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
        }
      } catch (error) {
        attempt += 1;
        const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(attempt - 1, 6));
        console.error(`${label} dispatch failed; retrying in ${delayMs}ms.`, error);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  })();
}

export class MemoryProviderEventStore implements ProviderEventStore {
  private readonly claimed = new Map<string, { state: "pending" | "completed"; at: number }>();

  async claim(namespace: string, eventId: string): Promise<boolean> {
    const key = `${namespace}:${eventId}`;
    const record = this.claimed.get(key);
    if (record?.state === "completed" || (record?.state === "pending" && Date.now() - record.at < 60_000)) return false;
    this.claimed.set(key, { state: "pending", at: Date.now() });
    return true;
  }

  async complete(namespace: string, eventId: string): Promise<void> {
    this.claimed.set(`${namespace}:${eventId}`, { state: "completed", at: Date.now() });
  }

  async release(namespace: string, eventId: string): Promise<void> {
    this.claimed.delete(`${namespace}:${eventId}`);
  }
}

export class FileProviderEventStore implements ProviderEventStore {
  private pending: Promise<void> = Promise.resolve();
  private readonly records = new Map<string, { state: "pending" | "completed"; at: number }>();
  private loaded = false;
  private writes = 0;

  constructor(private readonly path: string) {}

  claim(namespace: string, eventId: string): Promise<boolean> {
    return this.serial(async () => {
      await this.load();
      const key = `${namespace}:${eventId}`;
      const record = this.records.get(key);
      const now = Date.now();
      if (record?.state === "completed" && now - record.at < 7 * 24 * 60 * 60_000) return false;
      if (record?.state === "pending" && now - record.at < 60_000) return false;
      await this.record(key, "pending", now);
      return true;
    });
  }

  complete(namespace: string, eventId: string): Promise<void> {
    return this.serial(async () => this.record(`${namespace}:${eventId}`, "completed", Date.now()));
  }

  release(namespace: string, eventId: string): Promise<void> {
    return this.serial(async () => this.record(`${namespace}:${eventId}`, "released", Date.now()));
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    let contents = "";
    try {
      contents = await readFile(this.path, "utf8");
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    for (const line of contents.split("\n")) {
      if (!line) continue;
      try {
        const item = JSON.parse(line) as { key: string; state: "pending" | "completed" | "released"; at: number };
        if (item.state === "released") this.records.delete(item.key);
        else this.records.set(item.key, { state: item.state, at: item.at });
      } catch {
        this.records.set(line, { state: "completed", at: Date.now() });
      }
    }
    this.loaded = true;
  }

  private async record(key: string, state: "pending" | "completed" | "released", at: number): Promise<void> {
    await this.load();
    if (state === "released") this.records.delete(key);
    else this.records.set(key, { state, at });
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify({ key, state, at })}\n`, { encoding: "utf8", mode: 0o600 });
    if (++this.writes >= 1_000) await this.compact();
  }

  private async compact(): Promise<void> {
    const cutoff = Date.now() - 7 * 24 * 60 * 60_000;
    const lines: string[] = [];
    for (const [key, record] of this.records) {
      if (record.state === "completed" && record.at < cutoff) continue;
      lines.push(JSON.stringify({ key, ...record }));
    }
    await writeFile(this.path, lines.length ? `${lines.join("\n")}\n` : "", { encoding: "utf8", mode: 0o600 });
    this.writes = 0;
  }
}

export async function dispatchProviderCommand(
  ref: ChatConversationRef,
  text: string,
  gateway: ChatCommandGateway,
  messenger: ProviderMessenger,
): Promise<void> {
  const command = parseChatCommand(text);
  if (!command) {
    await messenger.send("Invalid Relay command.");
    return;
  }
  if (command.kind === "run" || command.kind === "new") {
    const existing = await gateway.conversationBinding?.(ref);
    let progressId = existing?.providerMessageId;
    if (progressId && progressId !== "@original") {
      try {
        await messenger.edit(progressId, "Relay request accepted.");
      } catch {
        progressId = undefined;
      }
    } else {
      progressId = undefined;
    }
    progressId = progressId ?? await messenger.send("Relay request accepted.") ?? ref.messageId;
    const request = commandToAgentRequest({ ...ref, messageId: progressId }, command);
    if (!request) return;
    await gateway.run(request, sessionSink(messenger, progressId));
    return;
  }
  if (command.kind === "status") {
    const session = await gateway.status({ ...ref, sessionId: command.sessionId });
    await messenger.send(`Relay session ${session.id}: ${session.status}.`);
    return;
  }
  if (command.kind === "cancel") {
    const session = await gateway.cancel({ ...ref, sessionId: command.sessionId, reason: command.reason });
    await messenger.send(`Relay session ${session.id}: ${session.status}.`);
    return;
  }
  if (command.kind === "list") {
    const sessions = await gateway.listConversations(ref);
    await messenger.send(sessions.length
      ? sessions.map((session) => `${session.id} · ${session.status}`).join("\n")
      : "No open Relay conversations.");
    return;
  }
  await gateway.switchConversation(ref, command.sessionId);
  await messenger.send(`This conversation now uses Relay session ${command.sessionId}.`);
}

function sessionSink(messenger: ProviderMessenger, messageId?: string): ChatSessionSink {
  let lastProgressAt = 0;
  const edit = async (text: string) => {
    if (messageId) await messenger.edit(messageId, text);
    else await messenger.send(text);
  };
  return {
    started: ({ session }) => edit(`Relay session ${session.id} started.`),
    event: async ({ event }) => {
      if (event.type !== "agent.output" || Date.now() - lastProgressAt < 1_000) return;
      lastProgressAt = Date.now();
      await edit("Relay agent is working…");
    },
    completed: (session) => edit(`Relay session ${session.id} ${session.status}.`),
    degraded: () => edit("Relay started, but conversation recovery could not be saved."),
    failed: (error) => edit(`Relay failed: ${error instanceof Error ? error.message : String(error)}`),
  };
}
