# Relay Web Stack Audit — 2026 Modern Frontend Alignment

_Audit date: 2026-06-16 · Scope: `web/` (Next.js control-panel UI) · Branch: `claude/web-stack-audit-wgnsff`_

## 1. Executive summary

Relay's web UI is **modern at the framework and styling layers** and **dated at the data,
state, testing, and observability layers**. The core stack (React 19, Next 16, TypeScript,
Tailwind v4, Radix + shadcn/ui) matches the 2026 reference almost exactly. The gaps are in the
"plumbing" that a production AI control plane leans on hardest: server-state caching, a state
store, streaming transport, test depth, and production telemetry.

Two architectural constraints shape every recommendation below and must be stated up front,
because they invalidate some otherwise-default 2026 advice:

- **The web app is a static export.** `next.config.ts` sets `output: "export"` and the FastAPI
  backend serves the bundle at `/web`. This is deliberate (the backend is the only runtime;
  see ADR-009). **Server Components, Server Actions, and Streaming SSR are therefore off the
  table** — they require a Node server Relay intentionally does not run. The UI is effectively a
  SPA hosted inside the Next App Router shell (`app/page.tsx` → `<App />`).
- **The backend is Python/FastAPI, not Node.** So **tRPC does not apply.** The type-safe-API
  goal is still reachable, but via **OpenAPI client generation** from FastAPI's schema, not tRPC.

Verdict: **No framework migration is warranted.** The high-value work is adopting TanStack Query
(to replace hand-rolled polling), a lightweight store (Zustand/Jotai) to dissolve the 1,005-line
`App.tsx`, real component/E2E testing, and error/perf telemetry.

## 2. Current stack inventory

| Layer | What Relay uses today | Source |
| --- | --- | --- |
| Framework | **Next.js 16.1.6**, App Router, static export | `web/package.json`, `next.config.ts` |
| UI runtime | **React 19.2.7** | `web/package.json` |
| Language | **TypeScript 5.9**, `target: ES2017`, `moduleResolution: Bundler` | `web/tsconfig.json` |
| Bundler | **webpack** (`next build --webpack`) — opts out of Next 16's default Turbopack | `web/package.json` |
| Package mgr / monorepo | **npm workspaces** (root `package.json`), no Turborepo/Nx | root `package.json` |
| Styling | **Tailwind CSS v4** + `@tailwindcss/postcss` + `tw-animate-css`, plus ~20 hand-written CSS modules under `src/styles/` | `styles.css`, `src/styles/*` |
| Components | **shadcn/ui** (`new-york`, `components.json`) over **Radix UI**, `cva` + `clsx` + `tailwind-merge` | `components.json`, `src/components/ui/*` |
| Icons | **lucide-react** | `web/package.json` |
| i18n | **i18next / react-i18next** (en, zh-CN, zh-TW) | `src/i18n/*` |
| State | **Raw hooks only** — `App.tsx` is 1,005 lines with 56 `useState/useEffect/useCallback/useMemo` calls; no Context, no store, prop-drilled | `src/App.tsx` |
| Server state | **Hand-rolled `fetch` + `setInterval` polling** (1s / 2s / 3s loops); `Promise.allSettled` fan-out | `src/api.ts`, `src/hooks/useRelayData.ts`, `AdminConsole.tsx` |
| Streaming | **None at the transport layer** — agent JSONL is parsed (`lib/agentStream.ts`) but delivered by polling, not SSE/WebSocket | `src/lib/agentStream.ts` |
| Forms | **None** — manual controlled inputs, no schema validation | `src/components/*` |
| Auth | Custom cookie/session via backend (`/auth/*`) | `src/api.ts` |
| Testing | **`node:test` only**, 2 unit files (`status.test.ts`, `adminHelpers.test.ts`); no component or E2E tests | `web/tests/*` |
| Observability | **None** — no error tracking, RUM, or tracing | — |
| AI SDK | **None** — bespoke JSONL parser instead of a streaming UI SDK | `src/lib/agentStream.ts` |

## 3. Layer-by-layer audit

Legend: ✅ aligned · 🟡 partial / caveated · 🔴 gap · ⚪ N/A for this architecture

| Reference layer (2026) | Relay today | Verdict | Notes |
| --- | --- | --- | --- |
| React 19 | 19.2.7 | ✅ | Current. |
| Next.js 16 + RSC / Server Actions / Streaming SSR | Next 16, **static export SPA** | 🟡 | Framework current; RSC/Actions ⚪ unusable under `output: export`. Fine — by design. |
| TypeScript ES2024+ | TS 5.9, **`target: ES2017`** | 🟡 | Compiler current; raise `target`/`lib` to `ES2022`+ (already shipping to evergreen browsers). |
| Vite / fast bundler | **webpack** via `--webpack` | 🔴 | Next 16 defaults to **Turbopack**; the build explicitly opts out. Drop `--webpack` (or justify it) to regain fast builds/HMR. Vite itself doesn't apply inside Next. |
| pnpm | **npm** workspaces | 🟡 | Works; pnpm would speed installs and tighten the monorepo. Low urgency. |
| Turborepo / Nx | npm workspaces only | 🟡 | No task graph/caching. Turborepo is a drop-in win for the 4-package workspace. Low urgency. |
| Tailwind + tokens | Tailwind v4 + CSS-var token tiers | ✅ | Token architecture in `styles.css` is genuinely good. |
| shadcn/ui + Radix | shadcn (`new-york`) + Radix | ✅ | Exactly the reference pattern. **But** ~20 bespoke CSS modules sit alongside it — design-system drift risk (see §5). |
| Zustand / Jotai (global state) | **none** | 🔴 | 56 hooks in one component, prop-drilled. Highest-leverage refactor. |
| TanStack Query (server state) | **`setInterval` polling** | 🔴 | No caching, dedup, retries, backoff, or optimistic updates. Biggest functional gap. |
| OpenAPI / tRPC (type-safe API) | hand-written `api.ts` + manual types | 🟡 | tRPC ⚪ (Python backend). Generate a client from FastAPI's OpenAPI schema instead. |
| React Hook Form + Zod | manual inputs, no validation | 🔴 | Onboarding/credentials/login forms would benefit; Zod also validates API payloads. |
| Vitest | `node:test` | 🟡 | Works and matches repo convention; Vitest adds jsdom + watch + coverage for the web package. |
| Testing Library (component) | **none** | 🔴 | No component tests for a UI this size. |
| Playwright (E2E) | **none** | 🔴 | No smoke/E2E coverage of login → run → approve flows. |
| Sentry / Datadog RUM | **none** | 🔴 | No production error or performance visibility. |
| OpenTelemetry | **none** | 🔴 | No frontend traces correlating UI → backend → daemon. |
| Streaming UI (SSE/WS) + Vercel AI SDK | polling + custom JSONL parser | 🔴 | Relay is an **agent platform** — streaming is core, not optional. Polling adds latency and load. |
| Auth.js / Clerk | custom backend auth | ✅/⚪ | Self-hosted control plane; custom OIDC-free auth is a reasonable choice. No change needed. |

## 4. Prioritized recommendations

### P0 — High value, contained blast radius

1. **Adopt TanStack Query** for all reads (`/sessions`, `/sandboxes`, `/daemon-nodes`, `/cp/*`).
   Replace the 1s/2s/3s `setInterval` loops in `useRelayData.ts`, `App.tsx`, and
   `AdminConsole.tsx` with queries (`refetchInterval` where polling is still wanted) plus
   mutations with optimistic updates for decisions/handoffs/runs. Removes hand-rolled
   `AbortController`/`Promise.allSettled` plumbing and gives caching, dedup, retry, and backoff
   for free. Keep `api.ts` as the typed fetch layer underneath.
2. **Introduce a store (Zustand or Jotai)** for cross-cutting client state (auth/user, active
   session id, selected employee, theme/language, status banner). Target: shrink `App.tsx` from
   1,005 lines and eliminate prop-drilling through `DecisionBar`/`MentionPopover`/drawers.
3. **Stream agent output over SSE** instead of polling. The backend already event-sources
   sessions; expose an `EventSource`/`text/event-stream` (or WebSocket) endpoint and feed
   `parseAgentStream` incrementally. Largest UX win for an agent product and cuts redundant
   request volume.

### P1 — Production readiness

4. **Add Sentry** (browser SDK) for error + performance monitoring; wire release/source-maps
   into the export build.
5. **Stand up real tests:** Vitest + Testing Library for components, Playwright for the core
   login → assign → run → approve E2E path. Keep existing `node:test` unit files or migrate them
   under Vitest for one runner.
6. **Generate a typed API client from FastAPI's OpenAPI schema** (e.g. `openapi-typescript` +
   a fetch client) so `web/src/types.ts` and `api.ts` stay in lockstep with the backend instead
   of being maintained by hand.

### P2 — Tooling & polish

7. **Re-enable Turbopack** — drop `--webpack` (or document why webpack is pinned).
8. **Raise the TS target** to `ES2022`+ and align `lib`.
9. **Add React Hook Form + Zod** to the onboarding, credentials, and login forms; reuse the Zod
   schemas to validate API responses.
10. **Evaluate Turborepo + pnpm** for the workspace (install speed, task caching). Optional.
11. **Consolidate the ~20 bespoke CSS modules** toward Tailwind utilities + the existing token
    layer to reduce design-system drift (see §5).

### Explicitly _not_ recommended

- **No framework change** (Vue/Svelte/Solid/Qwik) — React+Next is correct and current.
- **No RSC / Server Actions / Streaming SSR** — incompatible with the deliberate static-export +
  FastAPI architecture (ADR-009). Don't reintroduce a Node server to chase them.
- **No tRPC** — the backend is Python; use OpenAPI codegen instead.
- **No auth platform swap** — custom control-plane auth is appropriate here.

## 5. Notes & caveats

- **Styling duality.** Tailwind v4 + shadcn is modern, but `src/styles/*` carries ~20
  hand-authored CSS modules (shell, thread, composer, admin-v2-*, etc.). The token tiers in
  `styles.css` are well-designed, yet the volume of bespoke CSS is the main place the design
  system can drift from the utility/component model the reference assumes. Treat consolidation as
  ongoing hygiene, not a rewrite.
- **`AGENT_REGISTRY` mirroring.** Per `CLAUDE.md`, the web app cannot import the node-only agent
  registry, so agents are mirrored as literals in `App.tsx`/`MessageBlock.tsx` and `agent.<name>`
  i18n keys. Any data-layer refactor must preserve that mirror — it's enforced by
  `Record<AgentName, …>` types but easy to overlook during a move to a store.
- **Polling cost.** Three independent intervals (1s/2s/3s) run concurrently while the UI is open.
  TanStack Query (P0-1) plus SSE (P0-3) would cut this to event-driven updates with a single
  cached source of truth.

## 6. Suggested sequencing

1. TanStack Query over existing `api.ts` (P0-1) — unlocks the rest, low risk.
2. Zustand/Jotai store + `App.tsx` decomposition (P0-2).
3. SSE streaming endpoint + incremental `parseAgentStream` wiring (P0-3).
4. Sentry + Vitest/Testing Library/Playwright (P1-4, P1-5) in parallel.
5. OpenAPI client generation (P1-6), then P2 tooling polish.
