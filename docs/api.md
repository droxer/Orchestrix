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
| `/api/v1/sandboxes`, `/api/v1/daemon-nodes` | Execution-plane observations and commands |
| `/api/v1/artifacts`, `/api/v1/workspace` | Generated artifacts and workspace reads |
| `/api/v1/admin` | Administrative users, employees, fleet, agents, teams, and integrations |
| `/api/v1/internal/chat` | Chat-service identity and conversation operations |
| `/api/v1/daemon-node-registrations` | Daemon heartbeat registration |
| `/api/v1/daemon-node-enrollments` | Managed and local daemon enrollment |

Persisted media uses `/profile-images/{kind}/{id}` and intentionally stays
outside the JSON version namespace.

## Normalized Mutations

```text
PATCH  /api/v1/threads/{id}                         { title } or { archived: true }
POST   /api/v1/threads/{id}/cancellations
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
