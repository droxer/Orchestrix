import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";

import {
  discoverAgentInventory,
  parseInventoryOutput,
  runRelayDaemon,
  runRelayDaemonDoctor,
  type DaemonExecutionEnvironment,
  type DaemonLogger,
} from "../src/index.js";
import type { DaemonNodeCommand, DaemonNodeEvent, DaemonNodeRegistration, StreamExecResult } from "relay-core";

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
      // Mirror collectExecution: raw chunks go through the stdout renderer
      // (which is what surfaces run.output events), the rendered text to the sink.
      const rendered = options?.stdoutRenderer?.("done\n") ?? "done\n";
      options?.sink?.(rendered);
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
    mode: "action",
    workspacePath: process.cwd(),
  };
}

function isInventoryProbe(args: string[] | undefined): boolean {
  return Boolean(args?.[1]?.includes("printf 'SKILL"));
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
      exec: async (_cmd, args, options) => {
        // The startup agent-inventory sweep also runs through execStream; only
        // count actual agent runs so the duplicate-suppression assertion holds.
        if (!isInventoryProbe(args)) execCount += 1;
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

test("relay daemon advertises only agents with passing capability preflight", async () => {
  const stop = new AbortController();
  const registrations: DaemonNodeRegistration[] = [];
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
      ensure: async (agent) => {
        if (agent === "kimi") throw new Error("Kimi is not logged in.");
      },
    }),
    fetchFn: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/") return jsonResponse({ name: "Relay backend" });
      if (path === "/daemon-nodes/register") {
        registrations.push(await jsonBody<DaemonNodeRegistration>(init));
        return jsonResponse({ ok: true });
      }
      if (path.endsWith("/commands")) {
        stop.abort();
        return jsonResponse({ commands: [] });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await daemon;

  assert.equal(registrations[0].supportedAgents.includes("codex"), true);
  assert.equal(registrations[0].supportedAgents.includes("kimi"), false);
  assert.equal(registrations[0].agentHealth?.kimi?.status, "failed");
  assert.match(registrations[0].agentHealth?.kimi?.detail ?? "", /not logged in/);
});

test("relay daemon doctor reports per-agent preflight failures", async () => {
  const report = await runRelayDaemonDoctor({
    backendUrl: "http://relay.test",
    sandboxId: "sbx_test",
    employeeId: "alice",
    workspacePath: process.cwd(),
    token: "node_token",
    logger: testLogger(),
    environment: fakeEnvironment({
      ensure: async (agent) => {
        if (agent === "codex") throw new Error("Codex auth missing.");
      },
    }),
    fetchFn: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/") return jsonResponse({ name: "Relay backend" });
      if (path === "/daemon-nodes/register") return jsonResponse({ ok: true });
      throw new Error(`unexpected URL ${url}`);
    },
  });

  assert.equal(report.ok, false);
  const codex = report.checks.find((check) => check.name === "agent:codex");
  assert.equal(codex?.ok, false);
  assert.match(codex?.detail ?? "", /auth missing/);
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

test("relay daemon preserves final agent log when output event post fails", async () => {
  const stop = new AbortController();
  const command = runCommand("cmd_output_post_failed");
  const events: DaemonNodeEvent[] = [];
  let commandServed = false;
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
      exec: async (_cmd, args, options) => {
        if (!isInventoryProbe(args)) options?.stdoutRenderer?.("  done\n\n");
        return { exit_code: 0, stdout: "  done\n\n", stderr: "" };
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
        const event = await jsonBody<DaemonNodeEvent>(init);
        events.push(event);
        if (event.type === "run.output") return jsonResponse({ error: "bad output event" }, 400);
        if (event.type === "run.failed" || event.type === "run.completed") setTimeout(() => stop.abort(), 0);
        return jsonResponse({ ok: true }, 202);
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await Promise.race([
    daemon,
    new Promise((_, reject) => setTimeout(() => reject(new Error("daemon did not post terminal event")), 1000)),
  ]);

  const failed = events.find((event) => event.type === "run.failed");
  assert.equal(failed?.type, "run.failed");
  if (!failed || failed.type !== "run.failed") throw new Error("missing run.failed event");
  assert.equal(failed.agentLog, "[Codex Action Exit 0]\nstdout:\n  done\n\n");
  assert.match(failed.error, /Daemon lost agent output/);
});

test("relay daemon exits startup preflight after external stop", async () => {
  const stop = new AbortController();
  let closeCount = 0;
  let preflightAborted = false;
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
    environment: {
      ...fakeEnvironment(),
      close: async () => {
        closeCount += 1;
      },
    },
    fetchFn: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/") {
        const signal = init?.signal as AbortSignal | undefined;
        setTimeout(() => stop.abort(), 0);
        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            preflightAborted = true;
            reject(new Error("preflight aborted"));
          }, { once: true });
        });
      }
      if (path === "/daemon-nodes/register") return jsonResponse({ ok: true });
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await Promise.race([
    daemon,
    new Promise((_, reject) => setTimeout(() => reject(new Error("daemon did not stop")), 500)),
  ]);

  assert.equal(preflightAborted, true);
  assert.equal(closeCount, 1);
});

test("relay daemon skips startup probes when external stop is already requested", async () => {
  const stop = new AbortController();
  stop.abort();
  let closeCount = 0;
  let ensureCount = 0;
  let inventoryCount = 0;
  await runRelayDaemon({
    backendUrl: "http://relay.test",
    sandboxId: "sbx_test",
    employeeId: "alice",
    workspacePath: process.cwd(),
    token: "node_token",
    pollIntervalMs: 5,
    shutdownGraceMs: 50,
    logger: testLogger(),
    signal: stop.signal,
    environment: {
      ...fakeEnvironment({
        ensure: async () => {
          ensureCount += 1;
        },
        exec: async () => {
          inventoryCount += 1;
          return { exit_code: 0, stdout: "", stderr: "" };
        },
      }),
      close: async () => {
        closeCount += 1;
      },
    },
    fetchFn: async (url) => {
      throw new Error(`unexpected URL ${url}`);
    },
  });

  assert.equal(ensureCount, 0);
  assert.equal(inventoryCount, 0);
  assert.equal(closeCount, 1);
});

test("relay daemon exits backend reconnect after external stop during registration", async () => {
  const stop = new AbortController();
  let registerAttempts = 0;
  let closeCount = 0;
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
    preflight: false,
    environment: {
      ...fakeEnvironment(),
      close: async () => {
        closeCount += 1;
      },
    },
    fetchFn: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/daemon-nodes/register") {
        registerAttempts += 1;
        stop.abort();
        return new Response("backend unavailable", { status: 503 });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await Promise.race([
    daemon,
    new Promise((_, reject) => setTimeout(() => reject(new Error("daemon did not stop")), 500)),
  ]);

  assert.ok(registerAttempts >= 1);
  assert.equal(closeCount, 1);
});

test("relay daemon removes shutdown listeners after external stop", async () => {
  const stop = new AbortController();
  const beforeSigint = process.listenerCount("SIGINT");
  const beforeSigterm = process.listenerCount("SIGTERM");
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
    fetchFn: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/") return jsonResponse({ name: "Relay backend" });
      if (path === "/daemon-nodes/register") return jsonResponse({ ok: true });
      if (path.endsWith("/commands")) {
        stop.abort();
        return jsonResponse({ commands: [] });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await daemon;

  assert.equal(process.listenerCount("SIGINT"), beforeSigint);
  assert.equal(process.listenerCount("SIGTERM"), beforeSigterm);
});

test("relay daemon exits polling sleep after external stop", async () => {
  const stop = new AbortController();
  let closeCount = 0;
  let commandPolls = 0;
  const daemon = runRelayDaemon({
    backendUrl: "http://relay.test",
    sandboxId: "sbx_test",
    employeeId: "alice",
    workspacePath: process.cwd(),
    token: "node_token",
    pollIntervalMs: 10_000,
    shutdownGraceMs: 50,
    logger: testLogger(),
    signal: stop.signal,
    environment: {
      ...fakeEnvironment(),
      close: async () => {
        closeCount += 1;
      },
    },
    fetchFn: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/") return jsonResponse({ name: "Relay backend" });
      if (path === "/daemon-nodes/register") return jsonResponse({ ok: true });
      if (path.endsWith("/commands")) {
        commandPolls += 1;
        stop.abort();
        return jsonResponse({ commands: [] });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await Promise.race([
    daemon,
    new Promise((_, reject) => setTimeout(() => reject(new Error("daemon did not stop")), 500)),
  ]);

  assert.equal(commandPolls, 1);
  assert.equal(closeCount, 1);
});

test("relay daemon bounds stopped registration during shutdown", async () => {
  const stop = new AbortController();
  let closeCount = 0;
  let stoppedRegisterAborted = false;
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
    environment: {
      ...fakeEnvironment(),
      close: async () => {
        closeCount += 1;
      },
    },
    fetchFn: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/") return jsonResponse({ name: "Relay backend" });
      if (path === "/daemon-nodes/register") {
        const registration = await jsonBody<DaemonNodeRegistration>(init);
        if (registration.status !== "stopped") return jsonResponse({ ok: true });
        const signal = init?.signal as AbortSignal | undefined;
        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            stoppedRegisterAborted = true;
            reject(new Error("stopped registration aborted"));
          }, { once: true });
        });
      }
      if (path.endsWith("/commands")) {
        stop.abort();
        return jsonResponse({ commands: [] });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await Promise.race([
    daemon,
    new Promise((_, reject) => setTimeout(() => reject(new Error("daemon did not stop")), 1_500)),
  ]);

  assert.equal(stoppedRegisterAborted, true);
  assert.equal(closeCount, 1);
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
      exec: async (_cmd, args, options) => {
        if (isInventoryProbe(args)) return { exit_code: 0, stdout: "", stderr: "" };
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

test("relay daemon bounds cancellation event retry during shutdown", async () => {
  const stop = new AbortController();
  let closeCount = 0;
  let commandServed = false;
  let cancellationAttempts = 0;
  const command = runCommand("cmd_cancel_retry");
  const daemon = runRelayDaemon({
    backendUrl: "http://relay.test",
    sandboxId: "sbx_test",
    employeeId: "alice",
    workspacePath: process.cwd(),
    token: "node_token",
    pollIntervalMs: 5,
    shutdownGraceMs: 1_000,
    logger: testLogger(),
    signal: stop.signal,
    environment: {
      ...fakeEnvironment({
        exec: async (_cmd, args, options) => {
          if (isInventoryProbe(args)) return { exit_code: 0, stdout: "", stderr: "" };
          stop.abort();
          while (!options?.signal?.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
          return { exit_code: 143, stdout: "", stderr: "", error_message: "cancelled" };
        },
      }),
      close: async () => {
        closeCount += 1;
      },
    },
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
        const event = await jsonBody<DaemonNodeEvent>(init);
        if (event.type === "run.cancelled") {
          cancellationAttempts += 1;
          return jsonResponse({ error: "temporary" }, 500);
        }
        return jsonResponse({ ok: true }, 202);
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await Promise.race([
    daemon,
    new Promise((_, reject) => setTimeout(() => reject(new Error("daemon did not stop")), 1_500)),
  ]);

  assert.ok(cancellationAttempts >= 1);
  assert.equal(closeCount, 1);
});

test("relay daemon retries normal run.cancel terminal event while running", async () => {
  const stop = new AbortController();
  const events: DaemonNodeEvent[] = [];
  let commandServed = false;
  let cancelServed = false;
  let cancellationAttempts = 0;
  const command = runCommand("cmd_user_cancel");
  const cancelCommand = {
    id: "cmd_user_cancel_request",
    type: "run.cancel",
    commandId: command.id,
    sessionId: command.sessionId,
    runId: command.runId,
    agent: command.agent,
    mode: command.mode,
    reason: "Cancelled from UI.",
  } satisfies DaemonNodeCommand;
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
      exec: async (_cmd, args, options) => {
        if (isInventoryProbe(args)) return { exit_code: 0, stdout: "", stderr: "" };
        while (!options?.signal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        return { exit_code: 130, stdout: "", stderr: "", error_message: "cancelled" };
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
        if (!cancelServed) {
          cancelServed = true;
          return jsonResponse({ commands: [cancelCommand] });
        }
        return jsonResponse({ commands: [] });
      }
      if (path.endsWith("/events")) {
        const event = await jsonBody<DaemonNodeEvent>(init);
        events.push(event);
        if (event.type === "run.cancelled") {
          cancellationAttempts += 1;
          if (cancellationAttempts === 1) return jsonResponse({ error: "temporary" }, 500);
          stop.abort();
        }
        return jsonResponse({ ok: true }, 202);
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await Promise.race([
    daemon,
    new Promise((_, reject) => setTimeout(() => reject(new Error("daemon did not stop")), 2_500)),
  ]);

  assert.equal(cancellationAttempts, 2);
  assert.deepEqual(events.flatMap((event) => event.type === "run.cancelled" ? [event.reason] : []), [
    "Cancelled from UI.",
    "Cancelled from UI.",
  ]);
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
      exec: async (_cmd, args, options) => {
        if (isInventoryProbe(args)) return { exit_code: 0, stdout: "", stderr: "" };
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

test("relay daemon runs concurrent ask commands within capacity", async () => {
  const stop = new AbortController();
  const events: DaemonNodeEvent[] = [];
  const started = new Set<string>();
  let commandServed = false;
  const first = { ...runCommand("cmd_ask_1"), mode: "ask" as const };
  const second = { ...runCommand("cmd_ask_2"), mode: "ask" as const, runId: "run_2", sessionId: "ses_2" };
  const daemon = runRelayDaemon({
    backendUrl: "http://relay.test",
    sandboxId: "sbx_test",
    employeeId: "alice",
    workspacePath: process.cwd(),
    token: "node_token",
    pollIntervalMs: 5,
    shutdownGraceMs: 100,
    runCapacityByMode: { ask: 2, action: 1, review: 1 },
    logger: testLogger(),
    signal: stop.signal,
    environment: fakeEnvironment({
      exec: async (_cmd, args, options) => {
        if (isInventoryProbe(args)) return { exit_code: 0, stdout: "", stderr: "" };
        const runId = started.size === 0 ? "run_1" : "run_2";
        started.add(runId);
        while (started.size < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        options?.sink?.(`${runId} done\n`);
        return { exit_code: 0, stdout: `${runId} done\n`, stderr: "" };
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
        if (events.filter((item) => item.type === "run.completed").length === 2) stop.abort();
        return jsonResponse({ ok: true }, 202);
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await daemon;

  assert.deepEqual(
    events.filter((event) => event.type === "run.completed").map((event) => event.commandId).sort(),
    ["cmd_ask_1", "cmd_ask_2"],
  );
  assert.equal(events.some((event) => event.type === "run.failed"), false);
});

test("relay daemon stops while retrying a busy-command rejection event", async () => {
  const stop = new AbortController();
  let closeCount = 0;
  let commandServed = false;
  let busyRejectAttempts = 0;
  const first = runCommand("cmd_busy_stop_1");
  const second = { ...runCommand("cmd_busy_stop_2"), runId: "run_2", sessionId: "ses_2" } satisfies DaemonNodeCommand;
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
    environment: {
      ...fakeEnvironment({
        exec: async (_cmd, args, options) => {
          if (isInventoryProbe(args)) return { exit_code: 0, stdout: "", stderr: "" };
          while (!options?.signal?.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
          return { exit_code: 143, stdout: "", stderr: "", error_message: "cancelled" };
        },
      }),
      close: async () => {
        closeCount += 1;
      },
    },
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
        if (event.type === "run.failed" && event.commandId === "cmd_busy_stop_2") {
          busyRejectAttempts += 1;
          stop.abort();
          return jsonResponse({ error: "temporary" }, 500);
        }
        return jsonResponse({ ok: true }, 202);
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await Promise.race([
    daemon,
    new Promise((_, reject) => setTimeout(() => reject(new Error("daemon did not stop")), 500)),
  ]);

  assert.equal(busyRejectAttempts, 1);
  assert.equal(closeCount, 1);
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

function inventoryLine(kind: "SKILL" | "MCP", agent: string, id: string, content: string): string {
  return [kind, agent, id, Buffer.from(content, "utf8").toString("base64")].join("\t");
}

test("parseInventoryOutput reads skill frontmatter and MCP servers per agent", () => {
  const skillMd = "---\nname: brainstorming\ndescription: Structured brainstorming.\n---\nbody";
  const mcpJson = JSON.stringify({
    mcpServers: {
      codegraph: { command: "codegraph", args: ["serve"] },
      remote: { url: "https://example.com/sse", type: "sse" },
    },
  });
  const stdout = [
    inventoryLine("SKILL", "claude", "superpowers/brainstorming/SKILL.md", skillMd),
    inventoryLine("SKILL", "claude", "frontend-design/SKILL.md", "---\nname: frontend-design\n---\n"),
    inventoryLine("MCP", "claude", ".claude.json", mcpJson),
    inventoryLine("SKILL", "bogus-agent", "x/SKILL.md", skillMd),
    "",
  ].join("\n");

  const inventory = parseInventoryOutput(stdout);
  const claude = inventory.claude;
  assert.ok(claude, "claude inventory present");
  assert.deepEqual(
    claude.skills.map((s) => ({ name: s.name, namespace: s.namespace, description: s.description })),
    [
      { name: "brainstorming", namespace: "superpowers", description: "Structured brainstorming." },
      { name: "frontend-design", namespace: undefined, description: undefined },
    ],
  );
  assert.deepEqual(
    claude.mcpServers.map((m) => ({ name: m.name, transport: m.transport })),
    [
      { name: "codegraph", transport: "stdio" },
      { name: "remote", transport: "sse" },
    ],
  );
  assert.equal(inventory["bogus-agent" as "claude"], undefined);
});

test("discoverAgentInventory returns empty on non-zero exit and never throws", async () => {
  const failing = async (): Promise<StreamExecResult> => ({ exit_code: 1, stdout: "ignored", stderr: "" });
  assert.deepEqual(await discoverAgentInventory(failing), {});
  const throwing = async (): Promise<StreamExecResult> => {
    throw new Error("exec exploded");
  };
  assert.deepEqual(await discoverAgentInventory(throwing), {});
});

test("relay daemon reports generated workspace documents in run.completed", async (t: TestContext) => {
  const { mkdtempSync, rmSync, writeFileSync: writeFile } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join: joinPath } = await import("node:path");
  const workspace = mkdtempSync(joinPath(tmpdir(), "relay-daemon-generated-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  const stop = new AbortController();
  const events: DaemonNodeEvent[] = [];
  const registrations: DaemonNodeRegistration[] = [];
  let commandServed = false;
  const base = runCommand();
  assert.ok(base.type === "run.start");
  const command: DaemonNodeCommand = { ...base, workspacePath: workspace };
  await runRelayDaemon({
    backendUrl: "http://relay.test",
    sandboxId: "sbx_test",
    employeeId: "alice",
    workspacePath: workspace,
    token: "node_token",
    pollIntervalMs: 5,
    shutdownGraceMs: 50,
    logger: testLogger(),
    signal: stop.signal,
    environment: fakeEnvironment({
      exec: async (_cmd, args, options) => {
        if (!isInventoryProbe(args)) {
          writeFile(joinPath(workspace, "quarterly-report.pdf"), "pdf bytes");
          writeFile(joinPath(workspace, "server.key"), "not a document");
        }
        const rendered = options?.stdoutRenderer?.("done\n") ?? "done\n";
        options?.sink?.(rendered);
        return { exit_code: 0, stdout: "done\n", stderr: "" };
      },
    }),
    fetchFn: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/") return jsonResponse({ name: "Relay backend" });
      if (path === "/daemon-nodes/register") {
        registrations.push(await jsonBody<DaemonNodeRegistration>(init));
        return jsonResponse({ ok: true });
      }
      if (path.endsWith("/commands")) {
        if (!commandServed) {
          commandServed = true;
          return jsonResponse({ commands: [command] });
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

  assert.equal(registrations[0]?.capabilities?.includes("generated-files"), true);
  const completed = events.find((event) => event.type === "run.completed");
  assert.ok(completed && completed.type === "run.completed");
  assert.equal(completed.generatedFiles?.length, 1);
  const [file] = completed.generatedFiles ?? [];
  assert.equal(file.relativePath, "quarterly-report.pdf");
  assert.equal(file.contentType, "application/pdf");
  assert.equal(Buffer.from(file.contentBase64 ?? "", "base64").toString("utf-8"), "pdf bytes");
});

test("generated-file diff detects changed files and skips excluded directories", async (t: TestContext) => {
  const { mkdtempSync, mkdirSync: makeDir, rmSync, writeFileSync: writeFile } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join: joinPath } = await import("node:path");
  const { snapshotGeneratedFiles, diffGeneratedFiles } = await import("../src/generated-files.js");
  const workspace = mkdtempSync(joinPath(tmpdir(), "relay-generated-diff-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  writeFile(joinPath(workspace, "data.csv"), "a,b\n");
  makeDir(joinPath(workspace, "node_modules"));
  writeFile(joinPath(workspace, "node_modules", "vendored.pdf"), "ignored");
  const before = snapshotGeneratedFiles(workspace);

  writeFile(joinPath(workspace, "report.html"), "<h1>hi</h1>");
  writeFile(joinPath(workspace, "data.csv"), "a,b\nc,d\n");

  const changed = diffGeneratedFiles(workspace, before);
  assert.deepEqual(changed.map((file) => file.relativePath).sort(), ["data.csv", "report.html"]);
  assert.deepEqual(diffGeneratedFiles(workspace, snapshotGeneratedFiles(workspace)), []);
});
