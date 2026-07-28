# ADR-012: Canonical Web Paths and Versioned API URLs

## Status

Accepted.

Relay uses clean browser paths and a versioned HTTP API boundary. Browser URLs
use the product term **thread**, while internal models, events, and serialized
fields retain the established `Session` and `sessionId` names.

Canonical browser navigation is rooted at `/threads`, `/backlog`, `/routines`,
`/agents`, `/teams`, `/channels`, and `/admin`. Entity details use path segments,
and route-scoped view state uses query parameters. The browser router owns the
History API; `/` is replaced with `/threads`, protected deep links pass through
`/login?returnTo=...`, and unknown locations do not silently select a thread.

All JSON operations are rooted at `/api/v1`. Administration is under
`/api/v1/admin`, chat-service operations are under `/api/v1/internal/chat`, and
OpenAPI remains at the unversioned discovery paths under `/api`. Persisted
profile images retain `/profile-images/{kind}/{id}` because those URLs are data,
not JSON API operations.

## Decision Drivers

- Browser locations must be shareable, inspectable, and compatible with normal
  back/forward navigation.
- API clients need one explicit version boundary and a stable namespace split
  between user, administrator, and internal-service authority.
- Product terminology should not force a database, event, or payload migration.
- Static export must remain deployable behind both Next development rewrites and
  FastAPI's allowlisted SPA fallback.

## Cutover

Relay is still under active development, so the canonical contract replaces the
previous URL shapes without a compatibility window. Unversioned JSON paths,
`/sessions`, `/cp`, old action routes, and hash-based browser locations are not
mounted or migrated. First-party clients and tests move with the contract.

## Consequences

- First-party clients build URLs through the shared `relay-core/api-url` helper.
- FastAPI mounts and publishes only canonical operations.
- Unknown API paths and missing assets return 404 instead of SPA HTML.
- Navigation must discard query parameters that do not belong to the next
  route; entity and tab changes push history, while filters and dialogs replace
  it.
- Future breaking API changes require a new version namespace rather than
  repurposing `/api/v1`.
