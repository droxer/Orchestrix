# Deploying Relay on Vercel + Railway

This guide deploys Relay as a hosted product: the **web UI on Vercel** and the
**backend control plane on Railway** with Railway Postgres. It covers the two
origin models, the settings each one needs, and what deliberately stays off both
platforms.

## What goes where

Relay splits into a control plane and an execution plane, and that split decides
the hosting:

| Component | Host | Why |
| --- | --- | --- |
| `web/` (Next.js UI) | **Vercel** | Static/edge-friendly client app; no server state. |
| `backend/` (FastAPI) | **Railway** | Long-lived process: SSE streams, daemon command queue, background task scheduler. |
| Postgres | **Railway** | Sessions, tasks, events, auth, daemon registry. |
| `relay-daemon` | **Neither** | Runs where the sandbox lives — see below. |

**Daemons do not belong on Vercel or Railway.** The backend never executes
agents; it queues commands that daemons poll for. A daemon in its default mode
boots a BoxLite microVM, which needs hardware virtualization that neither
platform's containers provide. Daemons run on employee machines (`SANDBOX_MODE=none`)
or on a VM host you control, and they connect *out* to the Railway backend URL —
so the backend needs a public URL, but daemons never need inbound ports.

You *can* run a daemon in a plain container with `--sandbox none`, where agents
are host processes rather than VM guests. That trades the sandbox boundary for
container isolation only, and you must supply each agent CLI's credentials in
the image. Treat it as a deliberate choice, not the default.

```
   browser
      │
      ▼
┌───────────────┐   /api/*  ┌──────────────────┐      ┌────────────┐
│ Vercel (web)  │──────────▶│ Railway (backend)│─────▶│  Postgres  │
└───────────────┘           └──────────────────┘      └────────────┘
                                     ▲
                          poll commands │ post run events
                                     │
                      ┌──────────────────────────────┐
                      │ daemons: laptops / VM hosts   │
                      │ (BoxLite sandbox + agent CLIs)│
                      └──────────────────────────────┘
```

## Pick an origin model first

Relay authenticates with an HTTP-only session cookie. Where the browser sends
that cookie is the only real decision in this deployment, and everything else
follows from it.

### Option A — Proxied (recommended; no custom domain needed)

Vercel rewrites `/api/*` and `/profile-images/*` to the Railway backend. The
browser only ever talks to the Vercel origin, so the cookie stays same-origin:
default `SameSite=Lax`, no CORS, nothing to configure on the cookie at all.

Use this to get running on `*.vercel.app` and `*.up.railway.app` without owning
a domain. The cost is that every API call takes an extra network hop, and
long-lived SSE streams pass through Vercel's proxy — cap them (see
[SSE through a proxy](#sse-through-a-proxy)).

### Option B — Direct, on sibling subdomains

Point `app.example.com` at Vercel and `api.example.com` at Railway. The browser
calls the backend directly: no proxy hop, and SSE streams go straight to Railway.
Sibling subdomains of one registrable domain are *same-site*, so the cookie stays
`SameSite=Lax` — it just needs `Domain=.example.com`. The backend needs CORS
because the origins differ.

This is the better steady state once you have a domain. Requires DNS.

> **Not recommended: direct across unrelated domains.** `relay.vercel.app` →
> `relay.up.railway.app` is *cross-site* (both are public suffixes), so the
> cookie needs `SameSite=None; Secure`, which browser tracking-prevention modes
> increasingly block outright. Relay supports it
> (`RELAY_SESSION_COOKIE_SAMESITE=none`), but expect Safari and hardened Chrome
> profiles to drop the session. Use Option A instead.

## 1. Railway: Postgres + backend

1. **Create the project and database.** New project → *Provision Postgres*.
   Railway exposes `DATABASE_URL` on the database service.

2. **Add the backend service** from this repo. `railway.json` at the repo root
   already selects the build and deploy settings:
   - builds `backend/Dockerfile` (backend only — no agent CLIs, no BoxLite);
   - runs `alembic -c backend/alembic.ini upgrade head` as the pre-deploy
     command, so migrations land before the new container takes traffic;
   - health-checks `/healthz`;
   - pins `numReplicas: 1` — see [Run one replica](#run-one-replica).

3. **Reference the database.** In the backend service's variables, add
   `DATABASE_URL` as a reference to the Postgres service
   (`${{Postgres.DATABASE_URL}}`). Railway issues a bare `postgresql://` URL;
   Relay pins the psycopg 3 driver on it automatically
   (`relay.core.storage_config.normalize_database_url`), so paste it unedited.

4. **Set the backend variables.** The image already sets `RELAY_STORAGE`,
   `RELAY_AUTH_STORE`, `RELAY_DAEMON_STORE`, `RELAY_CHAT_STORE`, `HOST`, and
   `RELAY_DATA_DIR`; `PORT` comes from Railway. Add:

   | Variable | Value | Notes |
   | --- | --- | --- |
   | `RELAY_ADMIN_TOKEN` | a long random string | Bootstraps the first admin, once. Remove it afterwards. |
   | `RELAY_CORS_ALLOW_ORIGINS` | `https://app.example.com` | **Option B only.** Exact origins, comma-separated. `*` is rejected. |
   | `RELAY_CORS_ALLOW_ORIGIN_REGEX` | `https://relay-web-[a-z0-9-]+\.vercel\.app` | **Option B only**, if you want Vercel preview deployments to reach the API. |
   | `RELAY_SESSION_COOKIE_DOMAIN` | `.example.com` | **Option B only.** Shares the cookie across `app.` and `api.`. |
   | `RELAY_SESSION_COOKIE_SAMESITE` | `lax` | Default. Only set to `none` for the unrelated-domains case. |
   | `RELAY_STREAM_MAX_SECONDS` | `240` | **Option A only.** See [SSE through a proxy](#sse-through-a-proxy). |
   | `RELAY_LOG_LEVEL` | `INFO` | |

   TLS terminates at Railway's edge, so the app sees plain HTTP. Relay trusts
   `X-Forwarded-Proto` by default (`RELAY_TRUST_PROXY_HEADERS=1`) and marks
   session cookies `Secure` from it. If you front the backend with something
   that does not send that header, set `RELAY_FORCE_SECURE_COOKIES=1`.

5. **Attach a volume at `/data`.** Profile images and managed-node records are
   the operational state that does not live in Postgres, and a container
   filesystem is wiped on every deploy. Railway → service → *Volumes* → mount
   path `/data` (the image already points `RELAY_DATA_DIR` there).

6. **Generate a domain.** Service → *Settings* → *Networking* → *Generate
   Domain*, or attach `api.example.com` for Option B. This URL is what both the
   web app and every daemon will use.

## 2. Vercel: the web UI

Create a Vercel project from the same repo with **Root Directory = `web`**.
Vercel detects Next.js and installs the npm workspace from the repo root, so
`relay-core` builds via the `prebuild` script. `web/vercel.json` supplies the
build command and response headers.

Then set environment variables for **Production, Preview, and Development**:

**Option A (proxied):**

| Variable | Value |
| --- | --- |
| `RELAY_WEB_HOST` | `proxy` |
| `RELAY_BACKEND_URL` | `https://relay-backend.up.railway.app` |
| `NEXT_PUBLIC_RELAY_BACKEND_ORIGIN` | `https://relay-backend.up.railway.app` |

`RELAY_WEB_HOST=proxy` switches the build from a static export to a Node build
whose rewrites forward `/api/*` and `/profile-images/*` to `RELAY_BACKEND_URL`.
`NEXT_PUBLIC_RELAY_BACKEND_ORIGIN` does not affect request routing — it is the
origin printed in values a human copies out of the UI (daemon start commands,
chat webhook base URLs), which must address the backend directly rather than
going through the proxy.

**Option B (direct):**

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_RELAY_API_ORIGIN` | `https://api.example.com` |

Leave `RELAY_WEB_HOST` unset: the build stays a static export and the client
calls the backend origin directly with `credentials: "include"`.

> Both are build-time values. Changing either requires a redeploy, not just a
> restart.

## 3. First run

1. **Bootstrap the admin.** With `RELAY_ADMIN_TOKEN` set on the backend:

   ```bash
   curl -X POST https://<backend>/api/v1/auth/bootstrap \
     -H 'Content-Type: application/json' \
     -d '{"token":"<RELAY_ADMIN_TOKEN>","username":"admin","password":"<password>"}'
   ```

   Then delete `RELAY_ADMIN_TOKEN` from the service variables and redeploy. It
   is a bootstrap credential, not a runtime one — the route refuses to run once
   a user exists, but there is no reason to keep it deployed.

2. **Sign in** at the Vercel URL and confirm the admin dashboard loads.

3. **Connect a computer.** Admin → *Computers* → add a node, then run the
   generated command on the target machine. Confirm the copied
   `--backend-url` points at the Railway domain — if it shows the Vercel URL,
   `NEXT_PUBLIC_RELAY_BACKEND_ORIGIN` (Option A) or `NEXT_PUBLIC_RELAY_API_ORIGIN`
   (Option B) is missing from the Vercel build.

## Operational notes

### Run one replica

The backend runs a background `TaskScheduler` that promotes due routines and
dispatches assigned tasks. It is not leader-elected: a second replica would
promote and dispatch the same work twice. Keep `numReplicas: 1` (as
`railway.json` sets), and scale up only after giving the scheduler a lock — or
by running extra replicas with `RELAY_TASK_SCHEDULER_ENABLED=0` and keeping
exactly one scheduler instance.

### SSE through a proxy

Thread streaming is Server-Sent Events. The backend caps a single connection at
`RELAY_STREAM_MAX_SECONDS` (default 1800) and the client reconnects with
`Last-Event-ID`, so a capped connection costs a reconnect and nothing else.

Under Option A the stream crosses Vercel's proxy, which enforces its own
duration limit. Set `RELAY_STREAM_MAX_SECONDS` *below* that limit (240 is a safe
starting point) so the server closes the stream cleanly with a resumable `done`
frame instead of the proxy cutting it mid-frame. Option B streams directly from
Railway and can keep the default.

### Cold starts and sleeping

If the Railway service is allowed to sleep, the first request after idle pays
the container start. That also stops the task scheduler while asleep, so due
routines fire late. Keep the backend always-on for any deployment where routines
matter.

### Secrets

`RELAY_ADMIN_TOKEN`, `DATABASE_URL`, and chat integration credentials belong in
the platform's variable store, never in `backend/.env` — that file is
git-ignored and is a local-development convenience only. Daemon tokens are
issued per computer by the backend and are never set as service variables.

### Local development is unchanged

None of these settings apply locally. With no deployment variables set, the
backend binds `127.0.0.1:8790`, issues host-only `SameSite=Lax` cookies, adds no
CORS headers, and `npm run build -w web` still produces the static export that
the backend serves at `/`. See [local-development.md](local-development.md).

## Environment variable reference

**Backend (Railway)**

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `BACKEND_PORT` | `8790` | Listen port; Railway injects `PORT`. `BACKEND_PORT` wins if both are set. |
| `HOST` / `BACKEND_HOST` | `127.0.0.1` | Listen interface; the image sets `0.0.0.0`. |
| `DATABASE_URL` / `RELAY_DATABASE_URL` | — | Postgres URL. Bare `postgres://` and `postgresql://` are normalized to psycopg 3. |
| `RELAY_CORS_ALLOW_ORIGINS` | unset | Exact browser origins allowed to send credentials. |
| `RELAY_CORS_ALLOW_ORIGIN_REGEX` | unset | Anchored origin pattern for preview deployments. |
| `RELAY_SESSION_COOKIE_DOMAIN` | unset (host-only) | Cookie `Domain`, e.g. `.example.com`. |
| `RELAY_SESSION_COOKIE_SAMESITE` | `lax` | `lax`, `strict`, or `none`. `none` forces `Secure`. |
| `RELAY_FORCE_SECURE_COOKIES` | `0` | Mark cookies `Secure` regardless of request scheme. |
| `RELAY_TRUST_PROXY_HEADERS` | `1` | Honor `X-Forwarded-Proto`/`X-Forwarded-For`. |
| `RELAY_STREAM_MAX_SECONDS` | `1800` | Cap on one SSE connection. |
| `RELAY_ADMIN_TOKEN` | unset | One-time admin bootstrap token. |
| `RELAY_DATA_DIR` | `.relay` | Non-Postgres operational state; `/data` in the image. |

**Web (Vercel)**

| Variable | Default | Purpose |
| --- | --- | --- |
| `RELAY_WEB_HOST` | unset (static export) | `proxy` builds a Node app that rewrites `/api` to the backend. |
| `RELAY_BACKEND_URL` | `http://127.0.0.1:8790` | Proxy target for `RELAY_WEB_HOST=proxy` and for `next dev`. |
| `NEXT_PUBLIC_RELAY_API_ORIGIN` | unset (same-origin) | Backend origin the browser calls directly. |
| `NEXT_PUBLIC_RELAY_BACKEND_ORIGIN` | unset | Backend origin shown in copy-out values under proxied mode. |
