import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";
import type { DaemonNodeCommand, DaemonNodeEvent } from "relay-core";
import {
  DEFAULT_RELAY_DATA_DIR,
  materializeEvents,
  newRelayId,
  nowIso,
  relayEvent,
  type RelayArtifact,
  type RelayArtifactKind,
  type RelayEvent,
  type RelaySession,
  type SessionStore,
  type SessionStatus,
} from "./session.js";
import {
  materializeTaskEvents,
  relayTaskEvent,
  type RelayTask,
  type RelayTaskEvent,
  type TaskPriority,
  type TaskStatus,
  type TaskStore,
} from "./task.js";
import type {
  DaemonCommandRecord,
  DaemonEvent,
  DaemonRunRecord,
  DaemonStore,
  SandboxRecord,
} from "./daemon-types.js";
import {
  daemonCommandRecord,
  daemonEvent,
  daemonRunFromEvent,
  daemonRunRecord,
  hashDaemonNodeToken,
  sandboxRecord,
} from "./daemon-registry.js";
import type { AgentName } from "relay-core";

const { Pool } = pg;

type Queryable = pg.Pool | pg.PoolClient;

export interface PostgresStorageOptions {
  connectionString?: string;
  pool?: pg.Pool;
  artifactRoot?: string;
}

export class PostgresStorage {
  readonly pool: pg.Pool;
  readonly artifactRoot: string;
  readonly ready: Promise<void>;

  constructor(options: PostgresStorageOptions = {}) {
    this.pool = options.pool ?? new Pool({ connectionString: options.connectionString ?? requireDatabaseUrl() });
    this.artifactRoot = options.artifactRoot ?? process.env.RELAY_ARTIFACT_DIR ?? join(DEFAULT_RELAY_DATA_DIR, "artifacts");
    this.ready = bootstrapPostgresStorage(this.pool);
  }
}

export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Relay Postgres storage.");
  }
  return databaseUrl;
}

export async function bootstrapPostgresStorage(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_sessions (
      id text PRIMARY KEY,
      snapshot jsonb NOT NULL,
      workspace_path text NOT NULL,
      status text NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_session_events (
      sequence bigserial PRIMARY KEY,
      event_id text UNIQUE NOT NULL,
      session_id text NOT NULL REFERENCES relay_sessions(id) ON DELETE CASCADE,
      event jsonb NOT NULL,
      event_type text NOT NULL,
      event_timestamp timestamptz NOT NULL
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS relay_session_events_session_idx ON relay_session_events(session_id, sequence)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_artifacts (
      id text PRIMARY KEY,
      session_id text NOT NULL REFERENCES relay_sessions(id) ON DELETE CASCADE,
      metadata jsonb NOT NULL,
      body_path text NOT NULL,
      created_at timestamptz NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_tasks (
      id text PRIMARY KEY,
      snapshot jsonb NOT NULL,
      status text NOT NULL,
      priority text NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_task_events (
      sequence bigserial PRIMARY KEY,
      event_id text UNIQUE NOT NULL,
      task_id text NOT NULL REFERENCES relay_tasks(id) ON DELETE CASCADE,
      event jsonb NOT NULL,
      event_type text NOT NULL,
      event_timestamp timestamptz NOT NULL
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS relay_task_events_task_idx ON relay_task_events(task_id, sequence)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_daemon_nodes (
      id text PRIMARY KEY,
      record jsonb NOT NULL,
      employee_id text NOT NULL,
      status text NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS relay_daemon_nodes_employee_idx ON relay_daemon_nodes(employee_id)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_daemon_commands (
      id text PRIMARY KEY,
      node_id text NOT NULL,
      status text NOT NULL,
      record jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS relay_daemon_commands_queue_idx ON relay_daemon_commands(node_id, status, created_at)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_daemon_runs (
      run_id text PRIMARY KEY,
      node_id text NOT NULL,
      command_id text NOT NULL,
      status text NOT NULL,
      record jsonb NOT NULL,
      started_at timestamptz NOT NULL,
      completed_at timestamptz
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS relay_daemon_runs_active_idx ON relay_daemon_runs(node_id, status)");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relay_daemon_events (
      sequence bigserial PRIMARY KEY,
      event_id text UNIQUE NOT NULL,
      event jsonb NOT NULL,
      event_type text NOT NULL,
      event_timestamp timestamptz NOT NULL
    )
  `);
  await pool.query(
    "INSERT INTO relay_schema_migrations(version) VALUES ($1) ON CONFLICT (version) DO NOTHING",
    ["20260613_postgres_storage"],
  );
}

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly storage = new PostgresStorage()) {}

  async createSession(input: {
    workspacePath: string;
    taskGoal: string;
    participants?: string[];
    status?: SessionStatus;
    pendingDecision?: RelaySession["pendingDecision"];
  }): Promise<RelaySession> {
    await this.storage.ready;
    const sessionId = newRelayId("ses");
    const event = relayEvent("session.created", sessionId, {
      workspacePath: input.workspacePath,
      taskGoal: input.taskGoal,
      participants: input.participants ?? ["human"],
    });
    const events: RelayEvent[] = [event];
    if (input.status || input.pendingDecision) {
      events.push(relayEvent("session.status", sessionId, {
        status: input.status ?? "running",
        phase: input.pendingDecision ? `waiting:${input.pendingDecision}` : "created",
        pendingDecision: input.pendingDecision,
      }));
    }
    const session = materializeEvents(events);
    await withTransaction(this.storage.pool, async (client) => {
      await upsertSession(client, session);
      for (const item of events) await insertSessionEvent(client, item);
    });
    return session;
  }

  async appendEvent(sessionId: string, event: RelayEvent): Promise<RelaySession> {
    await this.storage.ready;
    const session = materializeEvents([...(await this.readEvents(sessionId)), event]);
    await withTransaction(this.storage.pool, async (client) => {
      await insertSessionEvent(client, event);
      await upsertSession(client, session);
    });
    return session;
  }

  async getSession(sessionId: string): Promise<RelaySession> {
    await this.storage.ready;
    const result = await this.storage.pool.query("SELECT snapshot FROM relay_sessions WHERE id = $1", [sessionId]);
    if (!result.rows[0]) return materializeEvents(await this.readEvents(sessionId));
    return result.rows[0].snapshot as RelaySession;
  }

  async listSessions(): Promise<RelaySession[]> {
    await this.storage.ready;
    const result = await this.storage.pool.query("SELECT snapshot FROM relay_sessions ORDER BY updated_at DESC");
    return result.rows.map((row) => row.snapshot as RelaySession);
  }

  async writeArtifact(sessionId: string, input: {
    kind: RelayArtifactKind;
    title: string;
    body: string;
    extension?: string;
    agentRunId?: string;
  }): Promise<RelayArtifact> {
    await this.storage.ready;
    const artifactId = newRelayId("art");
    const extension = input.extension ?? "txt";
    const artifactDir = join(this.storage.artifactRoot, sessionId);
    mkdirSync(artifactDir, { recursive: true });
    const path = join(artifactDir, `${artifactId}.${extension}`);
    writeFileSync(path, input.body);
    const artifact: RelayArtifact = {
      id: artifactId,
      kind: input.kind,
      title: input.title,
      path,
      createdAt: nowIso(),
      agentRunId: input.agentRunId,
      bytes: Buffer.byteLength(input.body),
    };
    await this.storage.pool.query(
      `INSERT INTO relay_artifacts(id, session_id, metadata, body_path, created_at)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (id) DO UPDATE SET metadata = EXCLUDED.metadata, body_path = EXCLUDED.body_path`,
      [artifact.id, sessionId, JSON.stringify(artifact), path, artifact.createdAt],
    );
    return artifact;
  }

  async artifactPath(sessionId: string, artifactId: string): Promise<string> {
    await this.storage.ready;
    const result = await this.storage.pool.query(
      "SELECT body_path FROM relay_artifacts WHERE session_id = $1 AND id = $2",
      [sessionId, artifactId],
    );
    const path = result.rows[0]?.body_path;
    if (!path) throw new Error(`Unknown artifact ${artifactId} in session ${sessionId}.`);
    return path;
  }

  async readArtifact(sessionId: string, artifactId: string): Promise<string> {
    return readFileSync(await this.artifactPath(sessionId, artifactId), "utf8");
  }

  private async readEvents(sessionId: string): Promise<RelayEvent[]> {
    const result = await this.storage.pool.query(
      "SELECT event FROM relay_session_events WHERE session_id = $1 ORDER BY sequence",
      [sessionId],
    );
    if (result.rows.length === 0) throw new Error(`Unknown Relay session ${sessionId}.`);
    return result.rows.map((row) => row.event as RelayEvent);
  }
}

export class PostgresTaskStore implements TaskStore {
  constructor(private readonly storage = new PostgresStorage()) {}

  async createTask(input: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    assignedAgent?: AgentName;
  }): Promise<RelayTask> {
    await this.storage.ready;
    const taskId = newRelayId("task");
    const events: RelayTaskEvent[] = [
      relayTaskEvent("task.created", taskId, {
        title: input.title,
        description: input.description ?? "",
        priority: input.priority ?? "normal",
      }),
    ];
    if (input.assignedAgent) events.push(relayTaskEvent("task.assigned", taskId, { agent: input.assignedAgent }));
    if (input.status && input.status !== "backlog") events.push(relayTaskEvent("task.status", taskId, { status: input.status }));
    const task = materializeTaskEvents(events);
    await withTransaction(this.storage.pool, async (client) => {
      await upsertTask(client, task);
      for (const item of events) await insertTaskEvent(client, item);
    });
    return task;
  }

  async appendEvent(taskId: string, event: RelayTaskEvent): Promise<RelayTask> {
    await this.storage.ready;
    const task = materializeTaskEvents([...(await this.readEvents(taskId)), event]);
    await withTransaction(this.storage.pool, async (client) => {
      await insertTaskEvent(client, event);
      await upsertTask(client, task);
    });
    return task;
  }

  async getTask(taskId: string): Promise<RelayTask> {
    await this.storage.ready;
    const result = await this.storage.pool.query("SELECT snapshot FROM relay_tasks WHERE id = $1", [taskId]);
    if (!result.rows[0]) return materializeTaskEvents(await this.readEvents(taskId));
    return result.rows[0].snapshot as RelayTask;
  }

  async listTasks(): Promise<RelayTask[]> {
    await this.storage.ready;
    const result = await this.storage.pool.query("SELECT snapshot FROM relay_tasks ORDER BY updated_at DESC");
    return result.rows.map((row) => row.snapshot as RelayTask);
  }

  async updateTask(taskId: string, input: { title?: string; description?: string; priority?: TaskPriority; status?: TaskStatus }): Promise<RelayTask> {
    let task = await this.appendEvent(taskId, relayTaskEvent("task.updated", taskId, {
      title: input.title,
      description: input.description,
      priority: input.priority,
    }));
    if (input.status) task = await this.appendEvent(taskId, relayTaskEvent("task.status", taskId, { status: input.status }));
    return task;
  }

  async assignTask(taskId: string, agent: AgentName): Promise<RelayTask> {
    await this.appendEvent(taskId, relayTaskEvent("task.assigned", taskId, { agent }));
    await this.appendEvent(taskId, relayTaskEvent("task.status", taskId, { status: "assigned" }));
    return this.recordActivity(taskId, `Assigned to ${agent}.`, { agent });
  }

  async linkSession(taskId: string, sessionId: string): Promise<RelayTask> {
    const task = await this.appendEvent(taskId, relayTaskEvent("task.session_linked", taskId, { sessionId }));
    return this.recordActivity(task.id, `Linked session ${sessionId}.`, { sessionId });
  }

  async recordActivity(taskId: string, message: string, input: { agent?: AgentName; sessionId?: string } = {}): Promise<RelayTask> {
    return this.appendEvent(taskId, relayTaskEvent("task.activity", taskId, {
      activity: {
        id: newRelayId("act"),
        createdAt: nowIso(),
        message,
        agent: input.agent,
        sessionId: input.sessionId,
      },
    }));
  }

  private async readEvents(taskId: string): Promise<RelayTaskEvent[]> {
    const result = await this.storage.pool.query(
      "SELECT event FROM relay_task_events WHERE task_id = $1 ORDER BY sequence",
      [taskId],
    );
    if (result.rows.length === 0) throw new Error(`Unknown Relay task ${taskId}.`);
    return result.rows.map((row) => row.event as RelayTaskEvent);
  }
}

export class PostgresDaemonStore implements DaemonStore {
  constructor(private readonly storage = new PostgresStorage()) {}

  async registerNode(input: SandboxRecord): Promise<SandboxRecord> {
    await this.storage.ready;
    const uiTokenHash = input.uiTokenHash ?? input.tokenHash ?? hashDaemonNodeToken(input.token ?? "");
    const node = {
      ...input,
      token: undefined,
      tokenHash: uiTokenHash,
      uiTokenHash,
      nodeTokenHash: input.nodeTokenHash,
    };
    await upsertNode(this.storage.pool, node);
    await this.appendDaemonEvent(daemonEvent("daemon.node.registered", { node }));
    return node;
  }

  async markNodeSeen(nodeId: string, patch: Pick<Partial<SandboxRecord>, "status" | "lastError"> = {}): Promise<SandboxRecord | undefined> {
    await this.storage.ready;
    const node = await this.getNode(nodeId);
    if (!node) return undefined;
    const now = nowIso();
    const updated = { ...node, ...patch, updatedAt: now, lastSeenAt: now };
    await upsertNode(this.storage.pool, updated);
    await this.appendDaemonEvent(daemonEvent("daemon.node.seen", {
      nodeId,
      patch: { status: patch.status, lastError: patch.lastError, lastSeenAt: now },
    }));
    return updated;
  }

  async getNode(nodeId: string): Promise<SandboxRecord | undefined> {
    await this.storage.ready;
    const result = await this.storage.pool.query("SELECT record FROM relay_daemon_nodes WHERE id = $1", [nodeId]);
    return sandboxRecord(result.rows[0]?.record);
  }

  async listNodes(): Promise<SandboxRecord[]> {
    await this.storage.ready;
    const result = await this.storage.pool.query("SELECT record FROM relay_daemon_nodes ORDER BY updated_at DESC");
    return result.rows.flatMap((row) => {
      const node = sandboxRecord(row.record);
      return node ? [node] : [];
    });
  }

  async enqueueCommand(nodeId: string, command: DaemonNodeCommand): Promise<DaemonCommandRecord> {
    await this.storage.ready;
    const now = nowIso();
    const record: DaemonCommandRecord = {
      id: command.id,
      nodeId,
      command,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    await withTransaction(this.storage.pool, async (client) => {
      await upsertCommand(client, record);
      if (command.type === "run.start") {
        await upsertRun(client, {
          nodeId,
          commandId: command.id,
          sessionId: command.sessionId,
          runId: command.runId,
          agent: command.agent,
          mode: command.mode,
          taskGoal: command.taskGoal,
          workspacePath: command.workspacePath,
          status: "running",
          startedAt: now,
        });
      }
    });
    await this.appendDaemonEvent(daemonEvent("daemon.command.queued", { nodeId, commandId: command.id }));
    return record;
  }

  async takeQueuedCommands(nodeId: string, limit = Number.MAX_SAFE_INTEGER): Promise<DaemonCommandRecord[]> {
    await this.storage.ready;
    const now = nowIso();
    const records = await withTransaction(this.storage.pool, async (client) => {
      const selected = await client.query(
        `SELECT record FROM relay_daemon_commands
         WHERE node_id = $1 AND status = 'queued'
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [nodeId, limit],
      );
      const dispatched: DaemonCommandRecord[] = [];
      for (const row of selected.rows) {
        const record = daemonCommandRecord(row.record);
        if (!record) continue;
        const next: DaemonCommandRecord = {
          ...record,
          status: record.command.type === "run.start" ? "dispatched" : "completed",
          updatedAt: now,
          dispatchedAt: now,
          completedAt: record.command.type === "run.start" ? undefined : now,
        };
        await upsertCommand(client, next);
        if (record.command.type === "run.start") {
          await upsertRun(client, {
            ...runForCommand(record),
            status: "running",
            startedAt: now,
          });
        }
        dispatched.push({ ...next, status: "dispatched", completedAt: undefined });
      }
      return dispatched;
    });
    for (const record of records) {
      await this.appendDaemonEvent(daemonEvent("daemon.command.dispatched", { nodeId, commandId: record.id }));
    }
    return records;
  }

  async queuedCommandCount(nodeId: string): Promise<number> {
    await this.storage.ready;
    const result = await this.storage.pool.query(
      "SELECT count(*)::int AS count FROM relay_daemon_commands WHERE node_id = $1 AND status = 'queued'",
      [nodeId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async listActiveRuns(nodeId?: string): Promise<DaemonRunRecord[]> {
    await this.storage.ready;
    const result = nodeId
      ? await this.storage.pool.query("SELECT record FROM relay_daemon_runs WHERE node_id = $1 AND status = 'running'", [nodeId])
      : await this.storage.pool.query("SELECT record FROM relay_daemon_runs WHERE status = 'running'");
    return result.rows.flatMap((row) => {
      const run = daemonRunRecord(row.record);
      return run ? [run] : [];
    });
  }

  async markCommandCompleted(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.completed" }>): Promise<void> {
    const now = nowIso();
    await this.markCompletion(nodeId, event, {
      commandStatus: "completed",
      runStatus: "completed",
      completedAt: now,
      exitCode: event.exitCode,
    });
    await this.appendDaemonEvent(daemonEvent("daemon.command.completed", {
      nodeId,
      commandId: event.commandId,
      runId: event.runId,
      exitCode: event.exitCode,
    }));
  }

  async markCommandFailed(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.failed" }>): Promise<void> {
    const now = nowIso();
    await this.markCompletion(nodeId, event, {
      commandStatus: "failed",
      runStatus: "failed",
      completedAt: now,
      error: event.error,
    });
    await this.appendDaemonEvent(daemonEvent("daemon.command.failed", {
      nodeId,
      commandId: event.commandId,
      runId: event.runId,
      error: event.error,
    }));
  }

  async markCommandCancelled(nodeId: string, event: Extract<DaemonNodeEvent, { type: "run.cancelled" }>): Promise<void> {
    const now = nowIso();
    await this.markCompletion(nodeId, event, {
      commandStatus: "cancelled",
      runStatus: "cancelled",
      completedAt: now,
      error: event.reason,
    });
    await this.appendDaemonEvent(daemonEvent("daemon.command.cancelled", {
      nodeId,
      commandId: event.commandId,
      runId: event.runId,
      error: event.reason,
    }));
  }

  async appendDaemonEvent(event: DaemonEvent): Promise<void> {
    await this.storage.ready;
    await this.storage.pool.query(
      `INSERT INTO relay_daemon_events(event_id, event, event_type, event_timestamp)
       VALUES ($1, $2::jsonb, $3, $4)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.id, JSON.stringify(event), event.type, event.timestamp],
    );
  }

  private async getCommand(commandId: string, client: Queryable = this.storage.pool): Promise<DaemonCommandRecord | undefined> {
    const result = await client.query("SELECT record FROM relay_daemon_commands WHERE id = $1", [commandId]);
    return daemonCommandRecord(result.rows[0]?.record);
  }

  private async getRun(runId: string, client: Queryable = this.storage.pool): Promise<DaemonRunRecord | undefined> {
    const result = await client.query("SELECT record FROM relay_daemon_runs WHERE run_id = $1", [runId]);
    return daemonRunRecord(result.rows[0]?.record);
  }

  private async markCompletion(
    nodeId: string,
    event: Extract<DaemonNodeEvent, { type: "run.completed" | "run.failed" | "run.cancelled" }>,
    patch: {
      commandStatus: DaemonCommandRecord["status"];
      runStatus: DaemonRunRecord["status"];
      completedAt: string;
      exitCode?: number;
      error?: string;
    },
  ): Promise<void> {
    await this.storage.ready;
    await withTransaction(this.storage.pool, async (client) => {
      const command = await this.getCommand(event.commandId, client);
      if (command) {
        await upsertCommand(client, {
          ...command,
          status: patch.commandStatus,
          updatedAt: patch.completedAt,
          completedAt: patch.completedAt,
          error: patch.error,
        });
      }
      const run = await this.getRun(event.runId, client) ?? daemonRunFromEvent(nodeId, event, patch.runStatus);
      await upsertRun(client, {
        ...run,
        status: patch.runStatus,
        completedAt: patch.completedAt,
        exitCode: patch.exitCode,
        error: patch.error,
      });
    });
  }
}

function createStorage(): PostgresStorage {
  return new PostgresStorage();
}

export function createPostgresSessionStore(storage = createStorage()): PostgresSessionStore {
  return new PostgresSessionStore(storage);
}

export function createPostgresTaskStore(storage = createStorage()): PostgresTaskStore {
  return new PostgresTaskStore(storage);
}

export function createPostgresDaemonStore(storage = createStorage()): PostgresDaemonStore {
  return new PostgresDaemonStore(storage);
}

export function createPostgresStoreSet(storage = createStorage()): {
  storage: PostgresStorage;
  sessionStore: PostgresSessionStore;
  taskStore: PostgresTaskStore;
  daemonStore: PostgresDaemonStore;
} {
  return {
    storage,
    sessionStore: new PostgresSessionStore(storage),
    taskStore: new PostgresTaskStore(storage),
    daemonStore: new PostgresDaemonStore(storage),
  };
}

async function withTransaction<T>(pool: pg.Pool, action: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertSession(client: Queryable, session: RelaySession): Promise<void> {
  await client.query(
    `INSERT INTO relay_sessions(id, snapshot, workspace_path, status, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       snapshot = EXCLUDED.snapshot,
       workspace_path = EXCLUDED.workspace_path,
       status = EXCLUDED.status,
       updated_at = EXCLUDED.updated_at`,
    [session.id, JSON.stringify(session), session.workspacePath, session.status, session.updatedAt],
  );
}

async function insertSessionEvent(client: Queryable, event: RelayEvent): Promise<void> {
  await client.query(
    `INSERT INTO relay_session_events(event_id, session_id, event, event_type, event_timestamp)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (event_id) DO NOTHING`,
    [event.id, event.sessionId, JSON.stringify(event), event.type, event.timestamp],
  );
}

async function upsertTask(client: Queryable, task: RelayTask): Promise<void> {
  await client.query(
    `INSERT INTO relay_tasks(id, snapshot, status, priority, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       snapshot = EXCLUDED.snapshot,
       status = EXCLUDED.status,
       priority = EXCLUDED.priority,
       updated_at = EXCLUDED.updated_at`,
    [task.id, JSON.stringify(task), task.status, task.priority, task.updatedAt],
  );
}

async function insertTaskEvent(client: Queryable, event: RelayTaskEvent): Promise<void> {
  await client.query(
    `INSERT INTO relay_task_events(event_id, task_id, event, event_type, event_timestamp)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     ON CONFLICT (event_id) DO NOTHING`,
    [event.id, event.taskId, JSON.stringify(event), event.type, event.timestamp],
  );
}

async function upsertNode(client: Queryable, node: SandboxRecord): Promise<void> {
  await client.query(
    `INSERT INTO relay_daemon_nodes(id, record, employee_id, status, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       record = EXCLUDED.record,
       employee_id = EXCLUDED.employee_id,
       status = EXCLUDED.status,
       updated_at = EXCLUDED.updated_at`,
    [node.id, JSON.stringify(node), node.employeeId, node.status, node.updatedAt],
  );
}

async function upsertCommand(client: Queryable, record: DaemonCommandRecord): Promise<void> {
  await client.query(
    `INSERT INTO relay_daemon_commands(id, node_id, status, record, created_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (id) DO UPDATE SET
       node_id = EXCLUDED.node_id,
       status = EXCLUDED.status,
       record = EXCLUDED.record,
       updated_at = EXCLUDED.updated_at`,
    [record.id, record.nodeId, record.status, JSON.stringify(record), record.createdAt, record.updatedAt],
  );
}

async function upsertRun(client: Queryable, record: DaemonRunRecord): Promise<void> {
  await client.query(
    `INSERT INTO relay_daemon_runs(run_id, node_id, command_id, status, record, started_at, completed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     ON CONFLICT (run_id) DO UPDATE SET
       node_id = EXCLUDED.node_id,
       command_id = EXCLUDED.command_id,
       status = EXCLUDED.status,
       record = EXCLUDED.record,
       completed_at = EXCLUDED.completed_at`,
    [record.runId, record.nodeId, record.commandId, record.status, JSON.stringify(record), record.startedAt, record.completedAt],
  );
}

function runForCommand(record: DaemonCommandRecord): DaemonRunRecord {
  if (record.command.type === "run.start") {
    return {
      nodeId: record.nodeId,
      commandId: record.command.id,
      sessionId: record.command.sessionId,
      runId: record.command.runId,
      agent: record.command.agent,
      mode: record.command.mode,
      taskGoal: record.command.taskGoal,
      workspacePath: record.command.workspacePath,
      status: "running",
      startedAt: record.dispatchedAt ?? record.createdAt,
    };
  }
  throw new Error(`Unsupported daemon command ${record.id}.`);
}
