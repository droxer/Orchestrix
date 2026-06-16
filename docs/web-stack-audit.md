# Relay Web Stack Audit — Solid-Stack Review (Performance & Maintainability)

_Audit date: 2026-06-16 · Scope: `web/` (Next.js control-panel UI) · Branch: `claude/web-stack-audit-wgnsff`_

## 1. Framing: what "solid" means here

This review evaluates the web stack against **performance** and **maintainability**, not against a
trend checklist. A solid stack is defined by:

- **Fewer, stable, well-fitted dependencies.** Every library is a long-term maintenance liability
  (upgrades, CVEs, breaking changes, onboarding cost). The bar to add one is "removes more code
  and risk than it introduces," not "appears on a 2026 list."
- **Runtime performance that matches the workload.** Relay's UI is a long-lived operational
  console that polls a control plane and streams agent output. Its real costs are redundant
  network traffic, re-render fan-out, and bundle weight — not cold-start SSR.
- **Longevity and low cognitive load.** Boring, battle-tested tools that the existing team
  conventions already support beat novel ones that fragment the toolchain.

Under this lens several items from a pure trend audit get **dropped or downgraded** (Vercel AI SDK,
pnpm, Turborepo, Vitest-as-second-runner, React Hook Form, Sentry-by-default). The performance and
maintenance core tightens to a short, high-conviction list.

Two hard constraints still hold and remove whole categories of "default" advice:

- **Static export** (`output: "export"`, served by FastAPI per ADR-009) → no Server Components,
  Server Actions, or Streaming SSR. The UI is a SPA in the App Router shell.
- **Python/FastAPI backend** → tRPC does not apply; type safety comes from OpenAPI codegen.

## 2. Current stack inventory

| Layer | Today | Source |
| --- | --- | --- |
| Framework | Next.js 16.1.6, App Router, static export | `web/package.json`, `next.config.ts` |
| UI runtime | React 19.2.7 | `web/package.json` |
| Language | TypeScript 5.9, `target: ES2017` | `web/tsconfig.json` |
| Bundler | webpack (`next build --webpack`) | `web/package.json` |
| Pkg mgr / monorepo | npm workspaces | root `package.json` |
| Styling | Tailwind v4 + token tiers, plus ~20 hand-written CSS modules | `styles.css`, `src/styles/*` |
| Components | shadcn/ui (`new-york`) + Radix, `cva`/`clsx`/`tailwind-merge` | `components.json`, `src/components/ui/*` |
| i18n | i18next / react-i18next (en, zh-CN, zh-TW) | `src/i18n/*` |
| State | Raw hooks; `App.tsx` 1,005 lines, 56 hook calls, no store, prop-drilled | `src/App.tsx` |
| Server state | Hand-rolled `fetch` + `setInterval` (1s/2s/3s) + `Promise.allSettled` | `api.ts`, `useRelayData.ts`, `AdminConsole.tsx` |
| Streaming | Custom JSONL parser, delivered by polling (no SSE/WS) | `src/lib/agentStream.ts` |
| Forms / validation | Manual controlled inputs, no schema validation | `src/components/*` |
| Testing | `node:test`, 2 unit files; no component/E2E | `web/tests/*` |
| Observability | None | — |

## 3. Where the stack is already solid (leave it alone)

These are correct on both axes; adding the "modern alternative" would be churn, not improvement.

- **React 19 + Next 16 (static export).** Current, stable, and the export model is a *performance
  and maintenance asset* — no Node server to run, scale, or patch. Do **not** chase RSC/Server
  Actions; they'd reintroduce a runtime Relay deliberately removed.
- **Tailwind v4 + CSS-variable token tiers + shadcn/Radix.** Mainstream, low-churn, accessible
  primitives you own in-tree. No reason to touch.
- **npm workspaces.** Fine for a 4-package repo. Switching to pnpm/Turborepo adds tooling and a
  migration for marginal install/CI gains — **not** justified unless CI time is a measured pain.
- **Custom backend auth.** Appropriate for a self-hosted control plane; an auth SaaS would add a
  dependency and a network hop for no benefit here.
- **i18next.** Established and stable. Keep.

## 4. The performance & maintenance gaps that matter

Each item below earns its place by improving **both** axes or removing more code/risk than it adds.

### P0 — Net-negative code _and_ net-positive performance

**1. Replace hand-rolled polling with TanStack Query.**
- _Performance:_ kills three concurrent `setInterval` loops (1s/2s/3s) and their redundant
  refetches; adds request dedup, caching, cancellation, and backoff. Fewer requests, less main-
  thread churn.
- _Maintenance:_ deletes the bespoke `AbortController` + `Promise.allSettled` + `isRefreshing`
  plumbing in `useRelayData.ts`/`AdminConsole.tsx` and centralizes invalidation. One stable,
  boring dependency that *removes* code. Keep `api.ts` as the typed fetch layer underneath.
- _Net:_ highest-leverage change on the board. This is the keystone.

**2. Stream agent output over native SSE (`EventSource`), not polling — and skip the AI SDK.**
- _Performance:_ event-driven updates replace tight polling of session events; lower latency, far
  less traffic for the product's hottest surface.
- _Maintenance:_ an `EventSource` wired into the *existing* `parseAgentStream` is **less** code
  than the polling loop it replaces. The backend already event-sources sessions, so the server
  side is a natural fit.
- _Anti-bloat:_ **do not adopt the Vercel AI SDK.** It targets Node/serverless + OpenAI-style
  protocols and would sit awkwardly on a static export + FastAPI + custom-agent-JSONL stack. The
  native browser API plus the parser you already maintain is the solid choice.

**3. Decompose `App.tsx`; let TanStack Query own server state; add a *small* store only for what
remains.**
- _Maintenance:_ a 1,005-line component with 56 hooks is the single biggest maintainability risk
  in the UI. Most of that "state" is **server state** that item 1 removes outright. Split the rest
  into focused components/hooks.
- _Performance:_ for the genuinely-global client state that's left (auth/user, active session id,
  selected employee, theme/language, status banner), prefer **Zustand with selectors** over React
  Context. Context broadcasts every change to all consumers (re-render fan-out); Zustand subscribes
  by slice. The store should stay *small* — if Context suffices after decomposition, skip the
  dependency entirely. Add the library for a measured reason, not by default.

### P1 — Maintainability you'll feel within a release

**4. Generate the API client from FastAPI's OpenAPI schema.**
- _Maintenance:_ `types.ts` and `api.ts` are hand-maintained against a Python backend — guaranteed
  drift. Codegen (`openapi-typescript` + a thin fetch wrapper) makes the backend schema the single
  source of truth and turns contract breaks into compile errors.
- _Note:_ this is the *correct* substitute for tRPC given the Python backend; it pairs naturally
  with item 1.

**5. Adopt Zod for runtime validation at the boundary.**
- _Maintenance:_ validates API responses and form input where TypeScript's compile-time types
  can't reach; one schema both validates and infers types. Pairs with item 4 (validate generated
  payloads at the edge).
- _Scope discipline:_ Zod is the keeper. **React Hook Form is optional** — the forms here (login,
  onboard, credentials) are small enough that controlled inputs + a Zod parse are sufficient.
  Don't add RHF unless a genuinely complex form appears.

**6. Add testing that respects the existing runner — don't fragment the toolchain.**
- _Maintenance:_ the repo's canonical runner is `node:test` (per `CLAUDE.md`). Keep it for logic
  and add a DOM env (`happy-dom`/`jsdom`) + **Testing Library** for component tests under the same
  runner. Add **Playwright** for a *thin* critical-path E2E (login → assign → run → approve).
- _Anti-bloat:_ **do not introduce Vitest** just to match a list — a second unit runner splits CI,
  config, and mental model. One unit runner + one E2E tool is the solid shape.

### P2 — Cheap, safe polish

**7. Raise TS `target`/`lib` to `ES2022`+.** Less downleveling → marginally smaller, faster
   bundle. Zero risk on evergreen targets.

**8. Decide Turbopack deliberately — don't blindly flip.** Next 16 defaults dev to Turbopack;
   `build --webpack` is an *explicit opt-out*. Faster builds are nice, but production bundler
   stability outranks build speed for a solid stack. Confirm why `--webpack` is pinned before
   changing it; if there's no reason, drop the flag.

**9. Govern CSS drift instead of rewriting.** The ~20 bespoke modules in `src/styles/*` are the
   main maintainability smell, but a Tailwind rewrite is high-churn/high-regression. The token
   tiers are good — keep modules that encode real design decisions, prevent *new* drift, and
   migrate opportunistically. Not a project in itself.

### Explicitly not worth it (anti-bloat ledger)

| Candidate | Why it's dropped under perf/maintenance |
| --- | --- |
| Vercel AI SDK | Heavy, Node/serverless + OpenAI-shaped; native `EventSource` + existing parser is less code and fits the architecture. |
| Vitest | Second unit runner fragments a toolchain already standardized on `node:test`. |
| pnpm / Turborepo | Migration churn + extra tooling for marginal gains on a 4-package workspace. |
| React Hook Form | Forms are too simple to justify it; Zod covers validation. |
| Sentry/Datadog by default | SaaS dependency + bundle weight; revisit only if production error visibility becomes a real need (and consider self-hosted/lightweight first). |
| RSC / Server Actions / SSR | Incompatible with the deliberate static-export architecture. |
| tRPC | Backend is Python; OpenAPI codegen is the right substitute. |
| Framework swap (Vue/Svelte/Solid/Qwik) | No performance or maintenance case over current React+Next. |

## 5. Suggested sequencing

1. **TanStack Query** over the existing `api.ts` (P0-1) — keystone; removes polling, lowers traffic.
2. **SSE streaming** into `parseAgentStream` (P0-2) — biggest runtime win, *less* code.
3. **Decompose `App.tsx`**; add a small Zustand store only for leftover global client state (P0-3).
4. **OpenAPI codegen + Zod at the boundary** (P1-4, P1-5) — kills backend/frontend drift.
5. **Testing Library under `node:test` + a thin Playwright path** (P1-6).
6. **TS target bump, Turbopack decision, CSS-drift governance** (P2) as low-risk follow-ups.

Each P0 item is chosen because it makes the app **both** faster and smaller-to-maintain; nothing on
this list is added for coverage's sake.
