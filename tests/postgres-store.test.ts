import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import pg from "pg";

import {
  PostgresDaemonStore,
  PostgresStorage,
  PostgresSessionStore,
  PostgresTaskStore,
  bootstrapPostgresStorage,
  createRelayDaemonRuntime,
  requireDatabaseUrl,
  relayEvent,
  relayTaskEvent,
  shouldUsePostgresDefaults,
} from "../packages/relay-backend/src/index.js";

const { Pool } = pg;

class FakePool {
  readonly queries: Array<{ text: string; values?: unknown[] }> = [];

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });
    return { rows: [] };
  }
}

describe("Relay Postgres storage startup", () => {
  it("requires DATABASE_URL for default Postgres storage", async () => {
    assert.equal(requireDatabaseUrl({ DATABASE_URL: " postgresql://relay:test@localhost/relay " }), "postgresql://relay:test@localhost/relay");
    assert.throws(() => requireDatabaseUrl({}), /DATABASE_URL is required/);
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      assert.throws(() => new PostgresStorage(), /DATABASE_URL is required/);
    } finally {
      if (previous === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previous;
      }
    }
  });

  it("bootstraps the Relay schema idempotently", async () => {
    const pool = new FakePool();

    await bootstrapPostgresStorage(pool as any);

    const sql = pool.queries.map((query) => query.text).join("\n");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS relay_schema_migrations/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS relay_sessions/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS relay_session_events/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS relay_artifacts/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS relay_tasks/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS relay_task_events/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS relay_daemon_nodes/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS relay_daemon_commands/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS relay_daemon_runs/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS relay_daemon_events/);
    assert.deepEqual(pool.queries.at(-1)?.values, ["20260613_postgres_storage"]);
  });

  it("accepts an injected pool without DATABASE_URL", async () => {
    const pool = new FakePool();
    const storage = new PostgresStorage({ pool: pool as any, artifactRoot: "/tmp/relay-artifacts" });

    await storage.ready;

    assert.equal(storage.pool, pool);
    assert.equal(storage.artifactRoot, "/tmp/relay-artifacts");
    assert.ok(pool.queries.length > 0);
  });

  it("does not require Postgres defaults for local daemon mode", async () => {
    assert.equal(shouldUsePostgresDefaults({ daemonNodeMode: "local" }), false);
    assert.equal(shouldUsePostgresDefaults({ daemonNodeMode: "server" }), true);
    assert.equal(shouldUsePostgresDefaults({}), true);
  });

  it("constructs local daemon mode without DATABASE_URL but rejects default daemon mode", async () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const runtime = createRelayDaemonRuntime({ daemonNodeMode: "local" });
      await runtime.ready;

      assert.equal((await runtime.backend.list()).length, 0);
      assert.throws(() => createRelayDaemonRuntime({}), /DATABASE_URL is required/);
    } finally {
      if (previous === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previous;
      }
    }
  });
});

const postgresTestUrl = process.env.RELAY_POSTGRES_TEST_DATABASE_URL;
const describePostgres = postgresTestUrl ? describe : describe.skip;

describePostgres("Relay Postgres store contracts", () => {
  let adminPool: pg.Pool;
  let storage: PostgresStorage;
  let schemaName: string;

  beforeEach(async () => {
    schemaName = `relay_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    adminPool = new Pool({ connectionString: postgresTestUrl });
    await adminPool.query(`CREATE SCHEMA ${schemaName}`);
    storage = new PostgresStorage({
      pool: new Pool({
        connectionString: postgresTestUrl,
        options: `-c search_path=${schemaName}`,
      }),
      artifactRoot: mkdtempSync(join(tmpdir(), "relay-postgres-artifacts-")),
    });
    await storage.ready;
  });

  afterEach(async () => {
    await storage?.pool.end();
    await adminPool?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await adminPool?.end();
  });

  it("persists sessions, event logs, and filesystem-backed artifacts", async () => {
    const store = new PostgresSessionStore(storage);
    const session = await store.createSession({ workspacePath: "/workspace", taskGoal: "ship storage", participants: ["human", "codex"] });
    const updated = await store.appendEvent(session.id, relayEvent("session.status", session.id, { status: "completed", phase: "done" }));
    const artifact = await store.writeArtifact(session.id, {
      kind: "agent_output",
      title: "Codex output",
      body: "stored on disk",
      extension: "txt",
    });

    assert.equal(updated.status, "completed");
    assert.equal((await store.getSession(session.id)).status, "completed");
    assert.equal((await store.listSessions())[0].id, session.id);
    assert.equal(await store.readArtifact(session.id, artifact.id), "stored on disk");
  });

  it("persists tasks, assignments, linked sessions, and activity", async () => {
    const store = new PostgresTaskStore(storage);
    const task = await store.createTask({ title: "Postgres storage", priority: "high" });

    await store.assignTask(task.id, "codex");
    await store.linkSession(task.id, "ses_contract");
    await store.appendEvent(task.id, relayTaskEvent("task.status", task.id, { status: "done" }));

    const updated = await store.getTask(task.id);
    assert.equal(updated.assignedAgent, "codex");
    assert.deepEqual(updated.linkedSessionIds, ["ses_contract"]);
    assert.equal(updated.status, "done");
    assert.equal((await store.listTasks())[0].id, task.id);
  });

  it("persists daemon nodes, command dispatch, active runs, completion, cancellation, and invalid records", async () => {
    const store = new PostgresDaemonStore(storage);
    await store.registerNode({
      id: "sbx_contract",
      employeeId: "contract",
      workspacePath: "/workspace/contract",
      status: "ready",
      agents: { claude: "ready", pi: "unknown", codex: "ready" },
      token: undefined,
      tokenHash: "sha256:test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await storage.pool.query(
      "INSERT INTO relay_daemon_nodes(id, record, employee_id, status, updated_at) VALUES ($1, $2::jsonb, $3, $4, now())",
      ["bad_node", "{}", "bad", "ready"],
    );

    await store.enqueueCommand("sbx_contract", {
      id: "cmd_complete",
      type: "run.start",
      sessionId: "ses_complete",
      runId: "run_complete",
      taskGoal: "complete run",
      agent: "codex",
      mode: "review",
    });
    assert.equal(await store.queuedCommandCount("sbx_contract"), 1);
    const [completeCommand] = await store.takeQueuedCommands("sbx_contract");
    assert.equal(completeCommand.command.type, "run.start");
    assert.equal((await store.listActiveRuns("sbx_contract")).length, 1);
    await store.markCommandCompleted("sbx_contract", {
      type: "run.completed",
      commandId: "cmd_complete",
      sessionId: "ses_complete",
      runId: "run_complete",
      agent: "codex",
      mode: "review",
      exitCode: 0,
      agentLog: "approved",
    });

    await store.enqueueCommand("sbx_contract", {
      id: "cmd_cancel",
      type: "run.start",
      sessionId: "ses_cancel",
      runId: "run_cancel",
      taskGoal: "cancel run",
      agent: "claude",
      mode: "implement",
    });
    await store.takeQueuedCommands("sbx_contract");
    await store.markCommandCancelled("sbx_contract", {
      type: "run.cancelled",
      commandId: "cmd_cancel",
      sessionId: "ses_cancel",
      runId: "run_cancel",
      agent: "claude",
      mode: "implement",
      reason: "cancelled",
    });

    assert.equal((await store.listNodes()).some((node) => node.id === "bad_node"), false);
    assert.deepEqual(await store.listActiveRuns("sbx_contract"), []);
  });
});
