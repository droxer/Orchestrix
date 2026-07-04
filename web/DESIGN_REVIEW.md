# Relay Web — Design Review

_Date: 2026-06-26 · Scope: entire `web/` frontend · Method: code/CSS audit + live screenshots of public screens (gated surfaces pending an authenticated pass)._

## Verdict

This is a **strong, deliberate design system** — not generic AI output. It reads as Linear/Vercel/Resend lineage executed with real discipline: a three-tier token architecture, a monochrome action philosophy, status-only hues, a Geist + Geist Mono identity, three coherent themes (light / dark / high-contrast), grain/atmosphere texture, and a restrained motion vocabulary. The token layer is genuinely well-governed. The work here is **refinement and consistency cleanup**, not a redesign.

Findings are grouped by the four review axes and tagged **P1 (do soon) / P2 / P3 (nice-to-have)**. File refs are `path:line`.

---

## Strengths (keep these)

- **Token system is real, not decorative.** `src/styles/tokens.css` defines primitives → semantic aliases → a shadcn `@theme inline` bridge. Colors, type roles (`--type-*`), spacing (4px base), radii, motion curves, and durations are all centralized and consumed widely.
- **Accessibility foundations are above average.** `prefers-reduced-motion` has a global safety-net reset *and* per-surface neutralization (`src/styles/a11y.css:34`), `prefers-contrast: more` boosts hairlines/body (`a11y.css:47`), there's a dedicated high-contrast theme, a skip link, `text-wrap: balance` on headings, and WCAG-tuned `--color-warning-text` / `--color-danger-text` variants for small text.
- **Distinctive identity.** Geist Mono as a deliberate "data/metadata/label" signal (eyebrows, timestamps, agent labels, numbers), tight 2–10px radii instead of pill shapes, monochrome actions, and status-only color. Hard to confuse with a template.
- **Motion is intentional.** Three named easing curves + four duration tiers; staggered thread-row reveals (`thread.css`) are a cheap, tasteful delight rather than scattered micro-animations.
- **Login screen (verified live).** Editorial split layout, large "R" watermark, mono system-status readout (backend/daemon/sandbox · boxlite), strong type hierarchy. Responsive: the right editorial pane drops cleanly and the form stacks at 390px. Light + dark both hold up.

---

## Consistency & tokens

- **P1 — Dead v1 admin stylesheet (~755 lines).** `src/styles/admin.css` is still `@import`ed (`src/styles.css:51`) but the app runs entirely on the v2 `adm-*` system. Its `.ac-*` selectors (the whole v1 admin console) have **zero references** in any component. Only three rules are still live — `.messenger-shell[data-route="admin"]` (`admin.css:7,11`) and the `.admin-console` base (`admin.css:16`). **Action:** relocate those three live rules into `shell.css` / `admin-v2-shell.css`, then delete `admin.css` and its import. Removes ~16 raw `font-size` + 17 `font:` declarations and a large dead surface. _(Touches the admin route — verify visually after.)_
- **~~P2 — Raw `font-size` drift in admin.~~ RETRACTED — false finding.** On inspection the `font-size:` declarations in `admin-v2-views/drawers/dashboard.css` and `agent-stream.css` are already `font-size: var(--text-*)`; the earlier "29/22/16/13" counts were tokenized usages miscounted by a raw grep. The only non-token `font-size` values in the whole stylesheet are 8 intentional `clamp()` fluid-type rules and one relative `1.6em` — all legitimate. **Token discipline for typography is effectively complete; no action needed.**
- **P3 — Redundant rule.** `.header-agent-tabs { display: none }` is set at both the 900px and 820px breakpoints (`responsive.css:22` and `responsive.css:138`); the 820px copy is dead since the element is already hidden by 900px. Collapse. _(Zero visual risk.)_

## Accessibility

- **P1 — Touch targets below 44px.** Interactive controls sit at `min-height: 40px` in several places, including mobile chrome that only renders on touch: mobile topbar buttons (`responsive.css:52`), mobile back button (`responsive.css:114`), composer send affordances (`composer.css:52`), handoff controls (`handoff.css:19`), inputs (`inputs.css:8`), and an admin control (`admin-v2-views.css:1072`). WCAG 2.5.5 / Apple HIG want ≥44px. **Action:** bump the mobile-scoped targets to ≥44px (they're already inside the `max-width: 820px` block), and consider a `@media (pointer: coarse)` bump for the global controls so desktop density is untouched. _(Composer/topbar are gated — verify on the live mobile chat view.)_
- **P3 — Dense default button heights.** `button.tsx`: `default` h-9 (36px), `sm` 32, `xs` 28. Fine for a desktop operator tool; only raise if a primary CTA ever appears as the main mobile action.
- **P3 — Disabled "Sign in" legibility.** With empty fields the button uses `--color-primary-disabled` (#d4d4d8) with white text — visually weak (WCAG exempts disabled controls, so not a violation). Optional: darken the disabled label or use an outline-disabled treatment.

## Responsive & layout

- **Login verified** at 1440 / 390 — clean. **Pending live pass:** the 3-pane shell (sidenav 96/260 + thread 296 + chat) at the 1040 / 900 / 820 breakpoints, the single-column mobile thread↔chat toggle, backlog board/list reflow, and the admin dashboard grid (KPI tiles + charts) on narrow widths. These are the most likely places for overflow/truncation and need authenticated screenshots.
- **Dev-environment note (resolved, not a code bug):** the `:3000` dev server was returning `000` for every request (including `GET /`) — a **stale/wedged dev-server process** that had degraded during a long session, not a config problem. `web/next.config.ts` rewrites are correct; verified after a clean restart that `GET /` → 200 and `/auth/*` proxies to the backend (401 on bad creds). Fix = restart `make web`. This is why an earlier in-browser login at `:3000` never persisted a session.

## Visual & aesthetic

- The system is cohesive and confident; resist broad restyling. The biggest "is it memorable?" lever is already present (mono eyebrows + grain + the "R" watermark on login). If more distinctiveness is wanted, the highest-leverage move is extending that one signature moment (brand mark / empty states / first-run) rather than adding decoration elsewhere.
- Concrete per-surface visual nits (spacing rhythm, alignment, contrast on data-dense admin tables/charts) require the authenticated screenshot pass to call out responsibly — deferred rather than guessed.

---

## Applied in this pass (build + tests green)

- ✅ **P1 — Dead `admin.css` removed.** Confirmed the `.ac-*` block has zero references in `src`/`tests`; the base `.admin-console` rule is fully shadowed by `.adm-shell`/`.adm-bare`. Relocated the only live rules (`.messenger-shell[data-route="admin"]` grid, desktop + open + 820px) verbatim into `admin-v2-shell.css` (attribute selector out-specifies the default grid regardless of load order), then deleted `admin.css` and its `@import` (`styles.css`). ~755 lines of dead CSS gone.
- ✅ **P1 — Touch targets (partial).** Mobile-scoped controls bumped 40→44px (`responsive.css` mobile-topbar + back-button). Added a `@media (pointer: coarse)` block in `a11y.css` raising `.decision-bar`/`.handoff-actions`/`.agent-picker` controls and `.people-search` to 44px on touch only — desktop mouse density untouched.
- ✅ **P3 — Redundant breakpoint rule removed** (`responsive.css`).

Verification: `npm run build -w web` ✓, `make web-test` ✓ (11/11), login re-render ✓ (no regression from the CSS removal).

## Still open

1. ~~P2 admin font-size → tokens~~ — **closed: retracted as a false finding** (see Consistency & tokens above; typography is already fully tokenized).
2. **Authenticated visual pass** across all gated surfaces (3-pane shell breakpoints, backlog reflow, admin dashboard grid, drawers) — blocked on a login session. Fold concrete per-surface nits back into this doc once captured.

## Admin console elevation (2026-07-03)

Scoped visual pass on the v2 `adm-*` admin console — dashboard signature moment, operational continuity, fleet accents, activity timeline. No font or palette changes; stays within the precision design language.

**Shipped:**

- **KPI band atmosphere** — `.relay-atmosphere` on the full `.adm-dash-kpis` row with hairline grid overlay; hero tile no longer double-grains.
- **Choreographed dashboard load** — staggered `relay-enter-delay-5` through `-9` on belt cards and activity feed (KPIs keep `-1`–`-4`).
- **Activity chart anchor** — cobalt gradient fill (existing) plus stroke draw-in and area fade-in; `prefers-reduced-motion` noop.
- **Dashboard pulse strip** — running / failed / queued metrics visible on dashboard (same geometry as fleet).
- **Fleet card accent** — tone-colored 2px left bar on `.adm-node-card` (mirrors attention rail; no fill tint).
- **Activity feed timeline** — vertical spine, icon nodes on canvas, mono timestamps in dedicated column.

**Verify manually:** dashboard / people / fleet at 1440 / 1024 / 390px; dark + high-contrast themes; `prefers-reduced-motion`.

_Live screenshots captured: login light/dark desktop + light/dark mobile + post-change verify (`/tmp/relay-shots/login-*.png`). Gated-surface screenshots pending a session at `http://127.0.0.1:8790/`._

## Token consistency pass (2026-07-05)

Full drift audit of component CSS against the `tokens.css` shelf; ~150 declarations consolidated. Build ✓, web tests 167/167 ✓.

**Motion — the biggest drift, now closed.** Component CSS had grown a de-facto 100/120/150/160/180/200/240ms duration scale plus ~60 bare `ease` keywords alongside the published shelf. All transitions and entrance animations now use `var(--duration-fast|base)` + a named curve (100–160ms → fast, 180–240ms → base; deltas ≤40ms, imperceptible). Two unregistered cubic-beziers folded into the shelf: the drawer/sheet slide-in `(0.22,0.61,0.36,1)` → `--ease-emphasized`, the composer spring `(0.5,1.4,0.4,1)` → `--ease-spring`. Intentionally untouched: stagger `animation-delay` rhythms (thread rows, login, empty-state, sidenav labels), pulse/blink/caret keyframe cycles, and bespoke chart-draw choreography (durations kept; curves moved onto the shelf).

**Tracking — three new intent tokens.** The raw `letter-spacing` clusters were real intents missing from the shelf, now registered and consumed: `--letter-body` (−0.005em, prose optical tightening), `--letter-open` (0.02em, compact chips / mono metadata — the 0.01em sites were unified into it), `--letter-caps` (0.04em) and `--letter-caps-wide` (0.06em) for uppercase chrome labels. Exact-value strays mapped to existing tokens (0.08em → `--letter-eyebrow`, 0.12em → `--letter-eyebrow-wide`, −0.2px → `--letter-tight`). Left alone: em-based `−0.02em` on clamp() fluid display type (em tracking is correct there).

**Z-index — ladder extended and fully tokenized.** The named scale (20/30/40) now continues through the tiers that already existed as magic numbers: `--z-sheet: 50` (mobile bottom sheets), `--z-float: 120` (sidenav flyouts/tooltips; the tooltip's 100 joined the menu at 120 — pointer-events: none, no conflict), `--z-overlay: 200` (preferences), `--z-dialog: 300` (confirm dialogs, topmost). The composer mention-popover dropped from 30 to `--z-popover` to match the agent-picker.

**Focus rings.** Drifted 14%/16% halos snapped to `--ring-focus`; new `--ring-focus-danger` token (same 3px/28% recipe on the status red) consumed by the composer cancel-send and admin destructive rows, with solid overrides in both high-contrast themes.

**Point fixes.** Chat unread badge: raw `10px/700` → `--text-micro`/600 (system caps emphasis at 600). Artifact library active index button: literal `#fff` → `var(--color-canvas)` — fixes white-on-white in contrast-dark, where kind accents collapse to white ink. Artifact iframe preview keeps literal white with an intent comment (document paper is white in every theme). `tokens.css` skip-link transition now uses its own shelf.

**Verify manually:** hover/focus transitions across admin views + backlog (timing snaps), composer mode-chip spring, drawer/sheet entrances, preferences-over-sidenav and dialog-over-preferences stacking, contrast-dark artifact library.
