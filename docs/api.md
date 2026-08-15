# HTTP API and Web URL Contract

Relay's canonical JSON API base is `/api/v1`. The interactive API documents are
available at `/api/docs`, the OpenAPI document at `/api/openapi.json`, and ReDoc
at `/api/redoc`. `GET /api` returns the current version, base path,
documentation locations, and UI metadata from the backend's shared constants.

## Browser URLs

```text
/login
/threads
/threads/new
/threads/{threadId}
/projects
/projects/{projectId}
/projects/{projectId}/new
/projects/{projectId}/threads/{threadId}
/backlog
/routines
/agents
/agents/{agentId}
/teams
/teams/{teamId}
/channels
/admin
```

Agent lists use `q` and `availability`. Agent details use `tab`, `scope`, `path`,
and `item`; team details use `tab` and `artifact`; create dialogs use
`dialog=create`. IDs are percent-encoded path segments. Navigation to another
route or entity removes query state owned by the previous destination.

Unauthenticated deep links are replaced with `/login?returnTo=...`. Relay
accepts a return path only when it is same-origin and matches a recognized web
route. `/` is replaced with `/threads`.

## API Namespaces

| Namespace | Purpose |
| :- | :- |
| `/api/v1/auth` | Bootstrap, login, logout, current user, preferences |
| `/api/v1/threads` | Session-backed threads, events, artifacts, decisions, handoffs |
| `/api/v1/tasks` | Backlog and routine resources, assignment, pickups, runs |
| `/api/v1/agents`, `/api/v1/teams` | Current-user agents and teams |
| `/api/v1/projects` | Computer-bound project rosters and shared-workspace rooms |
| `/api/v1/sandboxes`, `/api/v1/daemon-nodes` | Execution-plane observations and commands |
| `/api/v1/artifacts`, `/api/v1/workspace` | Generated artifacts and workspace reads |
| `/api/v1/admin` | Administrative users, employees, fleet, agents, teams, and integrations |
| `/api/v1/internal/chat` | Chat-service identity and conversation operations |
| `/api/v1/daemon-node-registrations` | Daemon heartbeat registration |
| `/api/v1/daemon-node-enrollments` | Managed and local daemon enrollment |

Persisted media uses `/profile-images/{kind}/{id}` and intentionally stays
outside the JSON version namespace.

`GET /api/v1/tasks` returns complete task records for compatibility. Browser
list views may request `GET /api/v1/tasks?view=summary`, which omits `events`
and `activity` and returns `eventCount`, `activityCount`, and `lastActivity`
instead. An optional `limit` is clamped to 1–500; omitting it does not silently
truncate either projection.

## Normalized Mutations

```text
PATCH  /api/v1/threads/{id}                         { title } or { archived: true }
POST   /api/v1/threads/{id}/cancellations
POST   /api/v1/threads/{id}/messages               { text, intent, addressAgentId?, userMessageId?, idempotencyKey? }
POST   /api/v1/threads/{id}/recoveries             { kind, targetAgentId, mode, note?, idempotencyKey? }
PUT    /api/v1/tasks/{id}/assignment
POST   /api/v1/tasks/{id}/runs
POST   /api/v1/tasks/{id}/pickups
PUT    /api/v1/admin/daemon-nodes/{id}/assignment
DELETE /api/v1/admin/daemon-nodes/{id}/assignment
POST   /api/v1/admin/chat-integrations/{id}/activations
POST   /api/v1/admin/chat-integrations/{id}/health-checks
POST   /api/v1/admin/chat-integrations/{id}/webhook-secret-rotations
DELETE /api/v1/admin/managed-nodes/{id}/record
```

Thread collaboration inputs are semantic. `intent` is `accomplish`, `discuss`,
or `review`; omitting `addressAgentId` addresses the current room. Recovery
`kind` is `rerun` or `handoff`. The backend resolves membership, executor,
placement, and immutable round assignments; clients do not send those transport
details.

## Projects

`GET /api/v1/projects` returns the current employee's active and archived
projects so historical project threads keep their original grouping. Creating a
project binds an immutable stable Computer identity and creates one shared
workspace subpath for every task conversation in that project:

```text
POST /api/v1/projects
{
  "name": "Relay GA",
  "daemonNodeId": "computer-node-id",
  "leadAgentId": "agent-id",
  "members": [{
    "agentId": "agent-id",
    "role": "planner",
    "functionTitle": "Technical lead",
    "responsibilities": "Plan and accept delivery",
    "instructions": "Optional project-only instructions"
  }]
}

GET    /api/v1/projects/{id}
PATCH  /api/v1/projects/{id}     { expectedVersion, name?, leadAgentId?, members?, enabled? }
DELETE /api/v1/projects/{id}?expectedVersion={version}
```

The selected Computer must advertise `project-workspaces`; every enabled member
must be an enabled agent with an active placement on that Computer. A project
has at most 32 members. Names and function titles are limited to 120
characters, responsibilities to 4,000 characters, and optional project
instructions to 8,000 characters. Updates use optimistic versions; stale writes
return `project_version_conflict`. Duplicate live names return
`project_name_taken`. Archiving is a soft delete: it disables future dispatch
while preserving tasks, threads, events, and workspace files.

Task/thread creation accepts `projectId`. Project dispatch rejects Computer,
team, or non-member overrides; the backend resolves the fixed roster and the
current daemon instance for the project's stable Computer identity.

Daemon runtimes renew their backend-advertised liveness lease independently of
command polling:

```text
POST /api/v1/daemon-nodes/{id}/heartbeat
```

The request is authenticated with the daemon node token and may include
`activeCommandLeases` so liveness and delivery ownership renew together.

Managed-node retry creates an attempt with `replaceActive: true`; draining
patches `desiredState` to `stopped`. `tasks/claim-next` is retired and has no v1
operation.

Resource creation returns `201`. Runs, cancellations, and provisioning that are
queued return `202`. A synchronous deletion returns `200` when it returns a
representation and `204` otherwise.

## Cutover Policy

Only the canonical paths documented here are mounted. Relay is under active
development, so unversioned JSON routes, `/sessions`, `/cp`, old action routes,
and hash-based browser URLs do not have compatibility aliases or redirects.
