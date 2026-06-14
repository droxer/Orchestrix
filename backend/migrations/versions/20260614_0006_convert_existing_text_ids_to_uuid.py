"""convert existing text ids to uuid primary keys

Revision ID: 20260614_0006
Revises: 20260613_0005
Create Date: 2026-06-14 00:00:00.000000

"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260614_0006"
down_revision = "20260613_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "daemon_nodes" not in inspector.get_table_names():
        return
    if "public_id" in {column["name"] for column in inspector.get_columns("daemon_nodes")}:
        return

    op.execute("create extension if not exists pgcrypto")
    _rename_current_tables_to_legacy()
    _create_uuid_tables()
    _copy_legacy_data()
    _drop_legacy_tables()


def downgrade() -> None:
    raise NotImplementedError("Downgrading UUID primary key conversion is not supported.")


def _rename_current_tables_to_legacy() -> None:
    tables = [
        "daemon_events",
        "daemon_runs",
        "daemon_commands",
        "daemon_nodes",
        "task_sessions",
        "task_events",
        "tasks",
        "session_artifacts",
        "session_events",
        "sessions",
        "auth_sessions",
        "auth_users",
        "employees",
        "departments",
    ]
    for table in tables:
        op.execute(sa.text(f'ALTER TABLE IF EXISTS "{table}" RENAME TO "{table}_legacy_0006"'))
    op.execute(
        """
        DO $$
        DECLARE
            item record;
        BEGIN
            FOR item IN
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = current_schema()
                  AND tablename LIKE '%\\_legacy\\_0006'
            LOOP
                EXECUTE format('ALTER INDEX %I RENAME TO %I', item.indexname, 'legacy_0006_' || item.indexname);
            END LOOP;
        END $$;
        """
    )


def _create_uuid_tables() -> None:
    op.execute(
        """
        CREATE TABLE sessions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            public_id text NOT NULL UNIQUE,
            workspace_path text NOT NULL,
            owner_employee_id text,
            task_goal text NOT NULL,
            participants jsonb NOT NULL DEFAULT '[]'::jsonb,
            status text NOT NULL,
            phase text NOT NULL,
            pending_decision text,
            current_agent text,
            review_verdict text,
            final_outcome jsonb,
            snapshot jsonb NOT NULL,
            version bigint NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL,
            updated_at timestamptz NOT NULL
        );
        CREATE INDEX ix_sessions_updated_at ON sessions (updated_at);
        CREATE INDEX ix_sessions_owner_employee_id ON sessions (owner_employee_id);
        CREATE INDEX ix_sessions_status ON sessions (status);

        CREATE TABLE session_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            public_id text NOT NULL UNIQUE,
            session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            sequence bigint NOT NULL,
            type text NOT NULL,
            timestamp timestamptz NOT NULL,
            payload jsonb NOT NULL,
            CONSTRAINT uq_session_events_session_sequence UNIQUE (session_id, sequence)
        );
        CREATE INDEX ix_session_events_session_id ON session_events (session_id);
        CREATE INDEX ix_session_events_timestamp ON session_events (timestamp);

        CREATE TABLE session_artifacts (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            public_id text NOT NULL UNIQUE,
            session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            agent_run_id text,
            kind text NOT NULL,
            title text NOT NULL,
            path text,
            content_type text,
            byte_size bigint NOT NULL DEFAULT 0,
            metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at timestamptz NOT NULL
        );
        CREATE INDEX ix_session_artifacts_session_id ON session_artifacts (session_id);

        CREATE TABLE tasks (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            public_id text NOT NULL UNIQUE,
            title text NOT NULL,
            description text NOT NULL DEFAULT '',
            priority text NOT NULL,
            status text NOT NULL,
            assigned_agent text,
            owner_employee_id text,
            snapshot jsonb NOT NULL,
            version bigint NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL,
            updated_at timestamptz NOT NULL
        );
        CREATE INDEX ix_tasks_updated_at ON tasks (updated_at);
        CREATE INDEX ix_tasks_status ON tasks (status);
        CREATE INDEX ix_tasks_assigned_agent ON tasks (assigned_agent);
        CREATE INDEX ix_tasks_owner_employee_id ON tasks (owner_employee_id);

        CREATE TABLE task_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            public_id text NOT NULL UNIQUE,
            task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            sequence bigint NOT NULL,
            type text NOT NULL,
            timestamp timestamptz NOT NULL,
            payload jsonb NOT NULL,
            CONSTRAINT uq_task_events_task_sequence UNIQUE (task_id, sequence)
        );
        CREATE INDEX ix_task_events_task_id ON task_events (task_id);
        CREATE INDEX ix_task_events_timestamp ON task_events (timestamp);

        CREATE TABLE task_sessions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            session_public_id text NOT NULL,
            created_at timestamptz NOT NULL,
            CONSTRAINT uq_task_sessions_task_session_public UNIQUE (task_id, session_public_id)
        );

        CREATE TABLE daemon_nodes (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            public_id text NOT NULL UNIQUE,
            employee_id text NOT NULL,
            workspace_path text,
            status text NOT NULL,
            agents jsonb NOT NULL DEFAULT '{}'::jsonb,
            ui_token_hash text,
            node_token_hash text,
            token_hash text,
            last_error text,
            created_at timestamptz NOT NULL,
            updated_at timestamptz NOT NULL,
            last_seen_at timestamptz
        );
        CREATE INDEX ix_daemon_nodes_employee_id ON daemon_nodes (employee_id);
        CREATE INDEX ix_daemon_nodes_updated_at ON daemon_nodes (updated_at);
        CREATE INDEX ix_daemon_nodes_last_seen_at ON daemon_nodes (last_seen_at);

        CREATE TABLE daemon_commands (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            public_id text NOT NULL UNIQUE,
            node_id uuid NOT NULL REFERENCES daemon_nodes(id) ON DELETE CASCADE,
            node_public_id text NOT NULL,
            type text NOT NULL,
            status text NOT NULL,
            command jsonb NOT NULL,
            exit_code integer,
            error text,
            created_at timestamptz NOT NULL,
            updated_at timestamptz NOT NULL,
            dispatched_at timestamptz,
            completed_at timestamptz
        );
        CREATE INDEX ix_daemon_commands_node_status ON daemon_commands (node_id, status);
        CREATE INDEX ix_daemon_commands_created_at ON daemon_commands (created_at);

        CREATE TABLE daemon_runs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            public_id text NOT NULL UNIQUE,
            node_id uuid NOT NULL REFERENCES daemon_nodes(id) ON DELETE CASCADE,
            node_public_id text NOT NULL,
            command_id uuid REFERENCES daemon_commands(id) ON DELETE SET NULL,
            command_public_id text,
            session_public_id text NOT NULL,
            agent text NOT NULL,
            mode text NOT NULL,
            task_goal text NOT NULL,
            workspace_path text,
            status text NOT NULL,
            exit_code integer,
            error text,
            started_at timestamptz NOT NULL,
            completed_at timestamptz
        );
        CREATE INDEX ix_daemon_runs_node_status ON daemon_runs (node_id, status);
        CREATE INDEX ix_daemon_runs_session_public_id ON daemon_runs (session_public_id);

        CREATE TABLE daemon_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            public_id text NOT NULL UNIQUE,
            node_id uuid,
            node_public_id text,
            command_id uuid,
            command_public_id text,
            run_id uuid,
            run_public_id text,
            type text NOT NULL,
            timestamp timestamptz NOT NULL,
            payload jsonb NOT NULL
        );
        CREATE INDEX ix_daemon_events_timestamp ON daemon_events (timestamp);
        CREATE INDEX ix_daemon_events_node_id ON daemon_events (node_id);

        CREATE TABLE departments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            public_id text NOT NULL UNIQUE,
            name text NOT NULL,
            parent_department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
            parent_department_public_id text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX ix_departments_parent_department_id ON departments (parent_department_id);

        CREATE TABLE employees (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            public_id text NOT NULL UNIQUE,
            display_name text NOT NULL,
            email text,
            department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
            department_public_id text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX ix_employees_department_id ON employees (department_id);

        CREATE TABLE auth_users (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            public_id text NOT NULL UNIQUE,
            username text NOT NULL,
            email text,
            role text NOT NULL,
            employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
            employee_public_id text,
            password_hash text NOT NULL,
            created_at timestamptz NOT NULL,
            updated_at timestamptz NOT NULL,
            CONSTRAINT ck_auth_users_role CHECK (role in ('admin', 'user')),
            CONSTRAINT uq_auth_users_username UNIQUE (username)
        );
        CREATE INDEX ix_auth_users_role ON auth_users (role);
        CREATE INDEX ix_auth_users_employee_id ON auth_users (employee_id);

        CREATE TABLE auth_sessions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            public_id text NOT NULL UNIQUE,
            token_hash text NOT NULL,
            user_id uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
            user_public_id text NOT NULL,
            created_at timestamptz NOT NULL,
            expires_at timestamptz NOT NULL,
            CONSTRAINT uq_auth_sessions_token_hash UNIQUE (token_hash)
        );
        CREATE INDEX ix_auth_sessions_user_id ON auth_sessions (user_id);
        CREATE INDEX ix_auth_sessions_expires_at ON auth_sessions (expires_at);
        """
    )


def _copy_legacy_data() -> None:
    op.execute(
        """
        INSERT INTO sessions (
            public_id, workspace_path, owner_employee_id, task_goal, participants, status, phase,
            pending_decision, current_agent, review_verdict, final_outcome, snapshot, version,
            created_at, updated_at
        )
        SELECT id, workspace_path, owner_employee_id, task_goal, participants, status, phase,
            pending_decision, current_agent, review_verdict, final_outcome, snapshot, version,
            created_at, updated_at
        FROM sessions_legacy_0006;

        INSERT INTO tasks (
            public_id, title, description, priority, status, assigned_agent, owner_employee_id,
            snapshot, version, created_at, updated_at
        )
        SELECT id, title, description, priority, status, assigned_agent, owner_employee_id,
            snapshot, version, created_at, updated_at
        FROM tasks_legacy_0006;

        INSERT INTO departments (public_id, name, parent_department_public_id, created_at, updated_at)
        SELECT id, name, parent_department_id, created_at, updated_at
        FROM departments_legacy_0006;

        UPDATE departments child
        SET parent_department_id = parent.id
        FROM departments parent
        WHERE child.parent_department_public_id = parent.public_id;

        INSERT INTO employees (public_id, display_name, email, department_public_id, created_at, updated_at)
        SELECT id, display_name, email, department_id, created_at, updated_at
        FROM employees_legacy_0006;

        UPDATE employees employee
        SET department_id = department.id
        FROM departments department
        WHERE employee.department_public_id = department.public_id;

        INSERT INTO auth_users (
            public_id, username, email, role, employee_id, employee_public_id,
            password_hash, created_at, updated_at
        )
        SELECT auth_users_legacy_0006.id, auth_users_legacy_0006.username, auth_users_legacy_0006.email,
            auth_users_legacy_0006.role, employees.id, auth_users_legacy_0006.employee_id,
            auth_users_legacy_0006.password_hash, auth_users_legacy_0006.created_at,
            auth_users_legacy_0006.updated_at
        FROM auth_users_legacy_0006
        LEFT JOIN employees ON employees.public_id = auth_users_legacy_0006.employee_id;

        INSERT INTO auth_sessions (public_id, token_hash, user_id, user_public_id, created_at, expires_at)
        SELECT auth_sessions_legacy_0006.id, auth_sessions_legacy_0006.token_hash,
            auth_users.id, auth_sessions_legacy_0006.user_id,
            auth_sessions_legacy_0006.created_at, auth_sessions_legacy_0006.expires_at
        FROM auth_sessions_legacy_0006
        JOIN auth_users ON auth_users.public_id = auth_sessions_legacy_0006.user_id;

        INSERT INTO session_events (public_id, session_id, sequence, type, timestamp, payload)
        SELECT session_events_legacy_0006.id, sessions.id, session_events_legacy_0006.sequence,
            session_events_legacy_0006.type, session_events_legacy_0006.timestamp,
            session_events_legacy_0006.payload
        FROM session_events_legacy_0006
        JOIN sessions ON sessions.public_id = session_events_legacy_0006.session_id;

        INSERT INTO session_artifacts (
            public_id, session_id, agent_run_id, kind, title, path, content_type,
            byte_size, metadata, created_at
        )
        SELECT session_artifacts_legacy_0006.id, sessions.id,
            session_artifacts_legacy_0006.agent_run_id, session_artifacts_legacy_0006.kind,
            session_artifacts_legacy_0006.title, session_artifacts_legacy_0006.path,
            session_artifacts_legacy_0006.content_type, session_artifacts_legacy_0006.byte_size,
            session_artifacts_legacy_0006.metadata, session_artifacts_legacy_0006.created_at
        FROM session_artifacts_legacy_0006
        JOIN sessions ON sessions.public_id = session_artifacts_legacy_0006.session_id;

        INSERT INTO task_events (public_id, task_id, sequence, type, timestamp, payload)
        SELECT task_events_legacy_0006.id, tasks.id, task_events_legacy_0006.sequence,
            task_events_legacy_0006.type, task_events_legacy_0006.timestamp,
            task_events_legacy_0006.payload
        FROM task_events_legacy_0006
        JOIN tasks ON tasks.public_id = task_events_legacy_0006.task_id;

        INSERT INTO task_sessions (task_id, session_public_id, created_at)
        SELECT tasks.id, task_sessions_legacy_0006.session_id, task_sessions_legacy_0006.created_at
        FROM task_sessions_legacy_0006
        JOIN tasks ON tasks.public_id = task_sessions_legacy_0006.task_id;

        INSERT INTO daemon_nodes (
            public_id, employee_id, workspace_path, status, agents, ui_token_hash, node_token_hash,
            token_hash, last_error, created_at, updated_at, last_seen_at
        )
        SELECT id, employee_id, workspace_path, status, agents, ui_token_hash, node_token_hash,
            token_hash, last_error, created_at, updated_at, last_seen_at
        FROM daemon_nodes_legacy_0006;

        INSERT INTO daemon_commands (
            public_id, node_id, node_public_id, type, status, command, exit_code, error,
            created_at, updated_at, dispatched_at, completed_at
        )
        SELECT daemon_commands_legacy_0006.id, daemon_nodes.id, daemon_commands_legacy_0006.node_id,
            daemon_commands_legacy_0006.type, daemon_commands_legacy_0006.status,
            daemon_commands_legacy_0006.command, daemon_commands_legacy_0006.exit_code,
            daemon_commands_legacy_0006.error, daemon_commands_legacy_0006.created_at,
            daemon_commands_legacy_0006.updated_at, daemon_commands_legacy_0006.dispatched_at,
            daemon_commands_legacy_0006.completed_at
        FROM daemon_commands_legacy_0006
        JOIN daemon_nodes ON daemon_nodes.public_id = daemon_commands_legacy_0006.node_id;

        INSERT INTO daemon_runs (
            public_id, node_id, node_public_id, command_id, command_public_id, session_public_id,
            agent, mode, task_goal, workspace_path, status, exit_code, error, started_at, completed_at
        )
        SELECT daemon_runs_legacy_0006.run_id, daemon_nodes.id, daemon_runs_legacy_0006.node_id,
            daemon_commands.id, daemon_runs_legacy_0006.command_id, daemon_runs_legacy_0006.session_id,
            daemon_runs_legacy_0006.agent, daemon_runs_legacy_0006.mode,
            daemon_runs_legacy_0006.task_goal, daemon_runs_legacy_0006.workspace_path,
            daemon_runs_legacy_0006.status, daemon_runs_legacy_0006.exit_code,
            daemon_runs_legacy_0006.error, daemon_runs_legacy_0006.started_at,
            daemon_runs_legacy_0006.completed_at
        FROM daemon_runs_legacy_0006
        JOIN daemon_nodes ON daemon_nodes.public_id = daemon_runs_legacy_0006.node_id
        LEFT JOIN daemon_commands ON daemon_commands.public_id = daemon_runs_legacy_0006.command_id;

        INSERT INTO daemon_events (
            public_id, node_id, node_public_id, command_id, command_public_id, run_id, run_public_id,
            type, timestamp, payload
        )
        SELECT daemon_events_legacy_0006.id, daemon_nodes.id, daemon_events_legacy_0006.node_id,
            daemon_commands.id, daemon_events_legacy_0006.command_id,
            daemon_runs.id, daemon_events_legacy_0006.run_id,
            daemon_events_legacy_0006.type, daemon_events_legacy_0006.timestamp,
            daemon_events_legacy_0006.payload
        FROM daemon_events_legacy_0006
        LEFT JOIN daemon_nodes ON daemon_nodes.public_id = daemon_events_legacy_0006.node_id
        LEFT JOIN daemon_commands ON daemon_commands.public_id = daemon_events_legacy_0006.command_id
        LEFT JOIN daemon_runs ON daemon_runs.public_id = daemon_events_legacy_0006.run_id;
        """
    )


def _drop_legacy_tables() -> None:
    tables = [
        "daemon_events_legacy_0006",
        "daemon_runs_legacy_0006",
        "daemon_commands_legacy_0006",
        "daemon_nodes_legacy_0006",
        "task_sessions_legacy_0006",
        "task_events_legacy_0006",
        "tasks_legacy_0006",
        "session_artifacts_legacy_0006",
        "session_events_legacy_0006",
        "sessions_legacy_0006",
        "auth_sessions_legacy_0006",
        "auth_users_legacy_0006",
        "employees_legacy_0006",
        "departments_legacy_0006",
    ]
    for table in tables:
        op.execute(sa.text(f'DROP TABLE IF EXISTS "{table}" CASCADE'))
