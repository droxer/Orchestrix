#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { relayApiUrl } from "relay-core";
import { RelayChatGateway } from "./gateway.js";
import { RelayChatIdentityResolver } from "./identity.js";
import { RelayChatClient } from "./relay-client.js";
import { handleDiscordInteraction } from "./providers/discord.js";
import { handleLarkEvent } from "./providers/lark.js";
import { FileProviderEventStore } from "./providers/runtime.js";
import { handleTelegramWebhook } from "./providers/telegram.js";
import type { ChatProvider } from "./types.js";
import type { ProviderHttpResponse } from "./providers/runtime.js";

interface RuntimeIntegration {
  id: string;
  provider: ChatProvider;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
}

export interface RelayChatServerOptions {
  backendUrl: string;
  chatToken: string;
  eventStorePath: string;
  fetchFn?: typeof fetch;
}

export function createRelayChatServer(options: RelayChatServerOptions) {
  const fetchFn = options.fetchFn ?? fetch;
  const backend = new RelayChatClient({ baseUrl: options.backendUrl, token: options.chatToken, fetchFn });
  const identities = new RelayChatIdentityResolver({ baseUrl: options.backendUrl, token: options.chatToken, fetchFn });
  const gateway = new RelayChatGateway({ backend, identities });
  const eventStore = new FileProviderEventStore(options.eventStorePath);
  return createServer(async (request, response) => {
    try {
      const route = webhookRoute(request.url);
      if (request.method !== "POST" || !route) return send(response, { status: 404 });
      const integration = await runtimeIntegration(options, route.integrationId, route.provider, fetchFn);
      if (!integration) return send(response, { status: 404 });
      const rawBody = await requestBody(request);
      const result = await providerHandler(route.provider, rawBody, request, gateway, integration, eventStore, fetchFn);
      send(response, result);
    } catch (error) {
      send(response, { status: error instanceof PayloadTooLargeError ? 413 : 500 });
    }
  });
}

export async function configureRelayChatProviders(options: RelayChatServerOptions, _publicUrl: string): Promise<void> {
  const fetchFn = options.fetchFn ?? fetch;
  const integrations = await runtimeIntegrations(options, fetchFn);
  const errors: Error[] = [];
  for (const integration of integrations) {
    if (integration.provider !== "discord") continue;
    try {
      await providerRequest(
        fetchFn,
        `https://discord.com/api/v10/applications/${integration.config.applicationId}/commands`,
        discordCommands(),
        { Authorization: `Bot ${integration.secrets.botToken}` },
        "PUT",
      );
    } catch (error) {
      errors.push(new Error(`discord integration ${integration.id}: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  if (errors.length) throw new AggregateError(errors, "One or more chat providers could not be configured.");
}

async function providerHandler(
  provider: ChatProvider,
  rawBody: string,
  request: IncomingMessage,
  gateway: RelayChatGateway,
  integration: RuntimeIntegration,
  eventStore: FileProviderEventStore,
  fetchFn: typeof fetch,
): Promise<ProviderHttpResponse> {
  if (provider === "telegram") {
    return handleTelegramWebhook({
      rawBody,
      secretHeader: header(request, "x-telegram-bot-api-secret-token"),
    }, gateway, {
      integrationId: integration.id,
      botToken: integration.secrets.botToken,
      webhookSecret: integration.secrets.webhookSecret,
      eventStore,
      fetchFn,
    });
  }
  if (provider === "discord") {
    return handleDiscordInteraction({
      rawBody,
      timestamp: header(request, "x-signature-timestamp"),
      signature: header(request, "x-signature-ed25519"),
    }, gateway, {
      integrationId: integration.id,
      applicationId: String(integration.config.applicationId),
      publicKey: String(integration.config.publicKey),
      eventStore,
      fetchFn,
    });
  }
  return handleLarkEvent({
    rawBody,
    timestamp: header(request, "x-lark-request-timestamp"),
    nonce: header(request, "x-lark-request-nonce"),
    signature: header(request, "x-lark-signature"),
  }, gateway, {
    integrationId: integration.id,
    appId: String(integration.config.appId),
    appSecret: integration.secrets.appSecret,
    verificationToken: integration.secrets.verificationToken,
    encryptKey: integration.secrets.encryptKey,
    eventStore,
    fetchFn,
  });
}

async function runtimeIntegration(
  options: RelayChatServerOptions,
  integrationId: string,
  provider: ChatProvider,
  fetchFn: typeof fetch,
): Promise<RuntimeIntegration | undefined> {
  return (await runtimeIntegrations(options, fetchFn)).find(
    (integration) => integration.id === integrationId && integration.provider === provider,
  );
}

async function runtimeIntegrations(options: RelayChatServerOptions, fetchFn: typeof fetch): Promise<RuntimeIntegration[]> {
  const response = await fetchFn(relayApiUrl(options.backendUrl, "/internal/chat/integrations/runtime"), {
    headers: { Authorization: `Bearer ${options.chatToken}` },
  });
  if (!response.ok) throw new Error("Relay runtime integration lookup failed.");
  const body = await response.json() as { integrations?: RuntimeIntegration[] };
  return Array.isArray(body.integrations) ? body.integrations : [];
}

function webhookRoute(url: string | undefined): { provider: ChatProvider; integrationId: string } | undefined {
  const match = /^\/webhooks\/(discord|telegram|lark)\/([^/?]+)$/.exec(url ?? "");
  return match ? { provider: match[1] as ChatProvider, integrationId: decodeURIComponent(match[2]) } : undefined;
}

async function requestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_048_576) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function send(response: ServerResponse, result: ProviderHttpResponse): void {
  const body = result.body === undefined ? "" : JSON.stringify(result.body);
  response.writeHead(result.status, body ? { "Content-Type": "application/json" } : undefined);
  response.end(body);
}

async function providerRequest(
  fetchFn: typeof fetch,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  method = "POST",
): Promise<unknown> {
  const response = await fetchFn(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Provider setup failed with HTTP ${response.status}.`);
  const responseBody = await response.text();
  return responseBody ? JSON.parse(responseBody) : undefined;
}

function discordCommands(): unknown[] {
  const string = (name: string, description: string, required = false) => ({ type: 3, name, description, required });
  return [{
    name: "relay",
    description: "Run and manage Relay sessions",
    options: [
      { type: 1, name: "run", description: "Run a named Relay agent", options: [string("agent", "Logical Relay agent ID", true), string("prompt", "Task for the agent", true)] },
      { type: 1, name: "status", description: "Show Relay session status", options: [string("session", "Relay session ID", true)] },
      { type: 1, name: "cancel", description: "Cancel a Relay session", options: [string("session", "Relay session ID", true), string("reason", "Cancellation reason")] },
    ],
  }];
}

class PayloadTooLargeError extends Error {}

async function main(): Promise<void> {
  const backendUrl = process.env.RELAY_BACKEND_URL ?? "http://127.0.0.1:8790";
  const chatToken = process.env.RELAY_CHAT_TOKEN;
  if (!chatToken) throw new Error("RELAY_CHAT_TOKEN is required.");
  const options = {
    backendUrl,
    chatToken,
    eventStorePath: resolve(process.env.RELAY_CHAT_EVENT_STORE ?? ".relay/chat/provider-events.txt"),
  };
  if (process.env.RELAY_CHAT_PUBLIC_URL) {
    await configureRelayChatProviders(options, process.env.RELAY_CHAT_PUBLIC_URL).catch((error) => {
      process.stderr.write(`Relay chat provider setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    });
    const refreshMs = Number(process.env.RELAY_CHAT_PROVIDER_REFRESH_MS ?? 60_000);
    setInterval(() => {
      void configureRelayChatProviders(options, process.env.RELAY_CHAT_PUBLIC_URL as string).catch((error) => {
        process.stderr.write(`Relay chat provider refresh failed: ${error instanceof Error ? error.message : String(error)}\n`);
      });
    }, refreshMs).unref();
  }
  const port = Number(process.env.RELAY_CHAT_PORT ?? 8791);
  createRelayChatServer(options).listen(port, "0.0.0.0", () => {
    process.stdout.write(`Relay chat webhook server listening on ${port}\n`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
