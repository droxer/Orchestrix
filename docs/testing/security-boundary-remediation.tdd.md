# Security Boundary Remediation — TDD Evidence

Date: 2026-08-17

## Scope

This change set closes the project-review findings around daemon/control-plane
trust boundaries, browser request defenses, event-store growth, artifact data
loss prevention, deployment hardening, and vulnerable dependencies.

## RED → GREEN journeys

| Journey | RED assertion | GREEN implementation |
| --- | --- | --- |
| Anonymous inventory and provisioning | Anonymous sandbox/node listing and cross-employee provisioning must return `401`/`403` | Authenticated inventory routes and owner/admin provisioning checks |
| Token separation | A daemon runtime token must not authorize browser/session mutations | UI tokens are the only sandbox tokens accepted by the user-facing mutation boundary |
| Private daemon state | Credentials and logs must not appear below the agent workspace | `RELAY_DAEMON_STATE_DIR`, defaulting to `~/.relay/daemon-nodes/<sandbox-id>`, with `0700` directories and `0600` tokens |
| Thread filesystem isolation | A BoxLite guest must see only its active thread at `/workspace` | Per-thread host mounts and serialized guest remounts |
| Host execution consent | `sandbox: none` must fail without explicit operator consent | `--allow-host-agent-execution` / `RELAY_ALLOW_HOST_AGENT_EXECUTION=1`, propagated by generated launch commands |
| Browser mutation defenses | Cross-site cookie mutations and simple non-JSON request bodies must be rejected | Origin/Sec-Fetch-Site cookie guard plus JSON content-type enforcement |
| Password abuse resistance | Repeated login failures must stop reaching password verification | Bounded in-process login/bootstrap rate limiter with `429` and `Retry-After` |
| Local session secrecy | Raw local session tokens must not be persisted | SHA-256 token digests, constant-time matching, and legacy plaintext migration |
| Task history growth | Database snapshots must not duplicate authoritative event/activity arrays | Compact task snapshots and event-table replay on reads and transactional writes |
| Artifact DLP | Generated-file discovery must skip credentials, secret-bearing text, and opaque archives | Sensitive-name/content filtering and archive exclusion |
| Deployment hardening | Responses need browser security headers and the backend image must not run as root | FastAPI/Vercel security headers and an unprivileged container user |
| Dependency advisories | Production audits must contain no known advisories | Next.js/PostCSS/Nanoid/Sharp/Cryptography upgrades and lockfile refreshes |

## Verification

- Production build: passed (`npm run build`).
- TypeScript and web tests: 1,012 passed, 1 skipped because local listening is
  blocked by the sandbox.
- Python tests: 955 passed, 1 PostgreSQL-only test skipped.
- Focused Ruff check for changed Python surfaces: passed.
- CSS lint: passed.
- `git diff --check`: passed.
- Production npm audit: 0 vulnerabilities.
- Python advisory audit: no known vulnerabilities; the local `relay` package
  is not published on PyPI and is therefore not independently auditable.
