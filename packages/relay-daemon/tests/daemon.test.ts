import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";

import {
  runRelayDaemon,
  type DaemonExecutionEnvironment,
  type DaemonLogger,
} from "../src/index.js";
import type { DaemonNodeCommand, DaemonNodeEvent, StreamExecResult } from "relay-core";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function testLogger(): DaemonLogger {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    output: () => undefined,
  };
}

function fakeEnvironment(input: {
  exec?: DaemonExecutionEnvironment["execStream"];
  ensure?: DaemonExecutionEnvironment["ensureAgentReady"];
} = {}): DaemonExecutionEnvironment {
  return {
    sandboxMode: "none",
    ensureAgentReady: input.ensure ?? (async () => undefined),
    execStream: input.exec ?? (async (_cmd, _args, options): Promise<StreamExecResult> => {
      options?.sink?.("done\n");
      return { exit_code: 0, stdout: "done\n", stderr: "" };
    }),
    close: async () => undefined,
  };
}

function runCommand(id = "cmd_1"): DaemonNodeCommand {
  return {
    id,
    type: "run.start",
    sessionId: "ses_1",
    runId: "run_1",
    taskGoal: "do work",
    agent: "codex",
    mode: "implement",
    workspacePath: process.cwd(),
  };
}

test("relay daemon ignores duplicate run.start commands already active", async () => {
  const stop = new AbortController();
  const events: DaemonNodeEvent[] = [];
  let execCount = 0;
  let commandBatchServed = false;
  const command = runCommand();
  const daemon = runRelayDaemon({
    backendUrl: "http://relay.test",
    sandboxId: "sbx_test",
    employeeId: "alice",
    workspacePath: process.cwd(),
    token: "node_token",
    pollIntervalMs: 5,
    shutdownGraceMs: 50,
    logger: testLogger(),
    signal: stop.signal,
    environment: fakeEnvironment({
      exec: async (_cmd, _args, options) => {
        execCount += 1;
        options?.sink?.("done\n");
        return { exit_code: 0, stdout: "done\n", stderr: "" };
      },
    }),
    fetchFn: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/") return jsonResponse({ name: "Relay backend" });
      if (path === "/daemon-nodes/register") return jsonResponse({ ok: true });
      if (path.endsWith("/commands")) {
        if (!commandBatchServed) {
          commandBatchServed = true;
          return jsonResponse({ commands: [command, command] });
        }
        return jsonResponse({ commands: [] });
      }
      if (path.endsWith("/events")) {
        events.push(await jsonBody<DaemonNodeEvent>(init));
        if (events.some((event) => event.type === "run.completed")) stop.abort();
        return jsonResponse({ ok: true }, 202);
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await daemon;

  assert.equal(execCount, 1);
  assert.equal(events.filter((event) => event.type === "run.completed").length, 1);
});

test("relay daemon retries terminal event posts across backend failures", async () => {
  const stop = new AbortController();
  let terminalAttempts = 0;
  const command = runCommand("cmd_retry");
  const daemon = runRelayDaemon({
    backendUrl: "http://relay.test",
    sandboxId: "sbx_test",
    employeeId: "alice",
    workspacePath: process.cwd(),
    token: "node_token",
    pollIntervalMs: 5,
    shutdownGraceMs: 50,
    logger: testLogger(),
    signal: stop.signal,
    environment: fakeEnvironment(),
    fetchFn: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/") return jsonResponse({ name: "Relay backend" });
      if (path === "/daemon-nodes/register") return jsonResponse({ ok: true });
      if (path.endsWith("/commands")) return jsonResponse({ commands: terminalAttempts === 0 ? [command] : [] });
      if (path.endsWith("/events")) {
        const event = await jsonBody<DaemonNodeEvent>(init);
        if (event.type === "run.completed") {
          terminalAttempts += 1;
          if (terminalAttempts === 1) return jsonResponse({ error: "temporary" }, 500);
          stop.abort();
        }
        return jsonResponse({ ok: true }, 202);
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await daemon;

  assert.equal(terminalAttempts, 2);
});

test("relay daemon posts cancellation during shutdown", async () => {
  const stop = new AbortController();
  const events: DaemonNodeEvent[] = [];
  let commandServed = false;
  const command = runCommand("cmd_shutdown");
  const daemon = runRelayDaemon({
    backendUrl: "http://relay.test",
    sandboxId: "sbx_test",
    employeeId: "alice",
    workspacePath: process.cwd(),
    token: "node_token",
    pollIntervalMs: 5,
    shutdownGraceMs: 200,
    logger: testLogger(),
    signal: stop.signal,
    environment: fakeEnvironment({
      exec: async (_cmd, _args, options) => {
        stop.abort();
        while (!options?.signal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        return { exit_code: 143, stdout: "", stderr: "", error_message: "cancelled" };
      },
    }),
    fetchFn: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/") return jsonResponse({ name: "Relay backend" });
      if (path === "/daemon-nodes/register") return jsonResponse({ ok: true });
      if (path.endsWith("/commands")) {
        if (!commandServed) {
          commandServed = true;
          return jsonResponse({ commands: [command] });
        }
        return jsonResponse({ commands: [] });
      }
      if (path.endsWith("/events")) {
        events.push(await jsonBody<DaemonNodeEvent>(init));
        return jsonResponse({ ok: true }, 202);
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await daemon;

  assert.equal(events.some((event) => event.type === "run.cancelled"), true);
});

test("relay daemon rejects a second distinct run while busy", async () => {
  const stop = new AbortController();
  const events: DaemonNodeEvent[] = [];
  let commandServed = false;
  const first = runCommand("cmd_busy_1");
  const second = { ...runCommand("cmd_busy_2"), runId: "run_2", sessionId: "ses_2" } satisfies DaemonNodeCommand;
  const daemon = runRelayDaemon({
    backendUrl: "http://relay.test",
    sandboxId: "sbx_test",
    employeeId: "alice",
    workspacePath: process.cwd(),
    token: "node_token",
    pollIntervalMs: 5,
    shutdownGraceMs: 100,
    logger: testLogger(),
    signal: stop.signal,
    environment: fakeEnvironment({
      exec: async (_cmd, _args, options) => {
        while (!events.some((event) => event.type === "run.failed" && event.commandId === "cmd_busy_2")) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        options?.sink?.("done\n");
        return { exit_code: 0, stdout: "done\n", stderr: "" };
      },
    }),
    fetchFn: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/") return jsonResponse({ name: "Relay backend" });
      if (path === "/daemon-nodes/register") return jsonResponse({ ok: true });
      if (path.endsWith("/commands")) {
        if (!commandServed) {
          commandServed = true;
          return jsonResponse({ commands: [first, second] });
        }
        return jsonResponse({ commands: [] });
      }
      if (path.endsWith("/events")) {
        const event = await jsonBody<DaemonNodeEvent>(init);
        events.push(event);
        if (event.type === "run.completed" && event.commandId === "cmd_busy_1") stop.abort();
        return jsonResponse({ ok: true }, 202);
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await daemon;

  assert.equal(events.some((event) => event.type === "run.failed" && event.commandId === "cmd_busy_2"), true);
  assert.equal(events.some((event) => event.type === "run.completed" && event.commandId === "cmd_busy_1"), true);
});

test("relay daemon can register, poll, execute, and report through a local backend server", async (t) => {
  const stop = new AbortController();
  const command = runCommand("cmd_http");
  let commandServed = false;
  const events: DaemonNodeEvent[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === "/") {
      sendJson(res, 200, { name: "Relay backend" });
      return;
    }
    if (req.url === "/daemon-nodes/register" && req.method === "POST") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.url === "/daemon-nodes/sbx_http/commands" && req.method === "GET") {
      sendJson(res, 200, { commands: commandServed ? [] : [command] });
      commandServed = true;
      return;
    }
    if (req.url === "/daemon-nodes/sbx_http/events" && req.method === "POST") {
      const event = JSON.parse(await readRequest(req)) as DaemonNodeEvent;
      events.push(event);
      if (event.type === "run.completed") stop.abort();
      sendJson(res, 202, { ok: true });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });
  if (!await listenOrSkip(server, t)) return;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP test server address.");
  const port = (address as AddressInfo).port;

  try {
    await runRelayDaemon({
      backendUrl: `http://127.0.0.1:${port}`,
      sandboxId: "sbx_http",
      employeeId: "alice",
      workspacePath: process.cwd(),
      token: "node_token",
      pollIntervalMs: 5,
      shutdownGraceMs: 100,
      logger: testLogger(),
      signal: stop.signal,
      environment: fakeEnvironment(),
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  assert.equal(events.some((event) => event.type === "run.output"), true);
  assert.equal(events.some((event) => event.type === "run.completed"), true);
});

async function jsonBody<T>(init: RequestInit | undefined): Promise<T> {
  if (typeof init?.body !== "string") throw new Error("Expected JSON request body.");
  return JSON.parse(init.body) as T;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readRequest(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function listenOrSkip(server: ReturnType<typeof createServer>, t: TestContext): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off("listening", onListening);
      if (error.code === "EPERM" || error.code === "EACCES") {
        t.skip(`local listen blocked by environment: ${error.code}`);
        resolve(false);
        return;
      }
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve(true);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}
