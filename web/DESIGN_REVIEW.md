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
2. ~~Authenticated visual pass across all gated surfaces~~ — **closed in the Warm Precision pass below** with local admin screenshots across chat, backlog, routine, admin dashboard, and drawer states.

## Admin console elevation (2026-07-03)

Scoped visual pass on the v2 `adm-*` admin console — dashboard signature moment, operational continuity, fleet accents, activity timeline. No font or palette changes; stays within the precision design language.

**Shipped:**

- **KPI band atmosphere** — `.relay-atmosphere` on the full `.adm-dash-kpis` row with hairline grid overlay; hero tile no longer double-grains.
- **Choreographed dashboard load** — staggered `relay-enter-delay-5` through `-9` on belt cards and activity feed (KPIs keep `-1`–`-4`).
- **Activity chart anchor** — primary-token gradient fill plus stroke draw-in and area fade-in; `prefers-reduced-motion` noop.
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

## Warm Precision identity pass (2026-07-05)

Evolved the web identity from cold precision to Warm Precision while preserving the existing three-tier token architecture and product layout. Build and tests are green: `npm run build -w web` ✓, `make web-test` ✓, `npm test` ✓ (TypeScript 368 pass / 1 environment skip; Python 194 pass / 1 warning).

**Shipped:**

- **Typography** — Geist Sans removed from the app font stack; Instrument Sans now drives UI/display text through `--font-app-sans`. Geist Mono remains the mono identity signal. CJK stacks now lead with Instrument Sans before Noto Sans SC/TC.
- **Palette** — light primitives moved to ecru/stone surfaces, warm stone text, and deep teal action. Dark and high-contrast themes now use the teal family; dark CTA text flips to near-black on luminous teal.
- **Geometry and rhythm** — radii softened one step, `--leading-loose` relaxed to 1.65, thread row padding moved to `--space-row-y`, and backlog/admin roots opt into `data-density="compact"`.
- **Signature moments** — light atmosphere wash warmed; `.relay-bleed-mark` extends the login "R" treatment to transcript empty states and the admin KPI band, hidden in high-contrast themes.
- **Theme previews** — preview swatches now depict the Warm Precision palette rather than the old cobalt/zinc set.

**Contrast audit:**

- Dark theme CTA: `#04201c` on `#2dd4bf` = 9.18:1.
- Dark disabled CTA: `#04201c` on the 68% teal disabled mix (`#239485`) = 4.60:1. This intentionally lifts the plan's initial 30% mix after screenshot review; 30% made the disabled sign-in label read too low-contrast.
- Light CTA: `#ffffff` on `#115e59` = 7.58:1.
- Light active CTA: `#ffffff` on `#0f766e` = 5.47:1.
- High-contrast light CTA: `#ffffff` on `#0f4c47` = 9.79:1.
- High-contrast dark CTA: `#000000` on `#5eead4` = 14.20:1.
- Teal link/action text on ecru: `#115e59` on `#fdfcfa` = 7.40:1.
- Success text on ecru: `#15803d` on `#fdfcfa` = 4.89:1.
- Warning text on ecru: `#92400e` on `#fdfcfa` = 6.91:1.
- Danger text on ecru: `#c2161c` on `#fdfcfa` = 5.98:1.

**Screenshot findings:**

- Captured login at 1440 / 1024 / 390 px in light, dark, and high-contrast via headless Chrome against `http://127.0.0.1:3000`.
- Evidence paths: `/tmp/relay-warm-precision-shots/login-light-desktop-1440x900.png`, `/tmp/relay-warm-precision-shots/login-light-tablet-1024x768.png`, `/tmp/relay-warm-precision-shots/login-light-mobile-390x900.png`, plus matching `dark` and `contrast` files in the same directory.
- Light reads as warm ecru rather than white/zinc; teal disabled CTA is visibly tinted, not grey. Dark reads as warm charcoal with luminous teal; the adjusted disabled CTA label remains readable. Mobile login fits without text overlap at 390 px. High-contrast removes the subtle atmosphere/grain dependency and keeps solid hairlines.
- Captured authenticated chat, backlog, routine, admin dashboard, and admin onboard drawer at 1440 / 1024 / 390 px in light, dark, and high-contrast via a local admin session. Evidence paths are under `/tmp/relay-warm-precision-auth-shots/`, for example `main-light-desktop-1440x900.png`, `backlog-dark-mobile-390x900.png`, `admin-light-desktop-1440x900.png`, and `admin-drawer-contrast-mobile-390x900.png`.
- Authenticated visual fixes from review: light active CTA now matches the specified `#0f766e`; mobile authenticated shells now override `[data-sidenav="open"]` at `max-width: 820px`, so chat, backlog, routine, admin, and drawers occupy the 390px viewport instead of rendering after the hidden sidenav column.
- Gated-surface result: backlog/admin retain compact operational density; the admin bled "R" is subtle in light/dark and hidden in high-contrast; drawer headers, tabs, fields, and footer actions stay legible at 390px without text overlap.

**Deferred / carried forward:**

- None for Warm Precision alignment. Future review can use seeded task/session data for richer content states, but the specified login and gated surfaces are captured.

## Mobile experience pass (2026-07-05)

Full implementation of the mobile UX review plan — P1 blockers, P2 polish, and P3 bottom-nav refinement. Build ✓ (`npm run build -w web`), web tests ✓ (`make web-test`).

### Shipped

**P1 — blockers**

- **Logout on mobile** — `PreferencesPanel` footer with logout button; wired through `PreferencesDialog` → `App.tsx` `handleLogout`. Replaces the desktop-only sidenav settings flyout hidden at ≤820px.
- **Route-aware mobile topbar** — `mobile-topbar--chat` keeps Chats ↔ conversation pivot on `main`; `mobile-topbar--route` shows centered mono eyebrow + route title on backlog, routine, workspace, channels, admin. Settings stays top-right.
- **Admin attention FAB offset** — `.adm-rail-fab` lifts above the 58px bottom tab bar + safe-area at `max-width: 820px`.

**P2 — polish**

- **Chat header density** — hide token count and active-agent pill below 820px; title wraps cleanly.
- **Composer padding** — `composer-input-wrap` uses `--space-base` inline padding on mobile; softer shadow.
- **Artifact library drawer** — vertical stack at 820px; opens with expanded index list on mobile (`ArtifactLibraryDrawer` + `artifact.css`).
- **Dynamic skip link** — `#thread-panel` / `#chat-panel` / work-route panel ids (`#backlog-panel`, etc.) with `tabIndex={-1}` on targets; i18n `skip_to_content`.
- **Task board create** — icon-only create button below 820px (visually hidden label, `aria-label` preserved).

**P3 — bottom nav refinement**

- Teal 2px top-edge accent on active `.sidenav-btn` in the bottom tab bar.
- Horizontal scroll edge fade via `mask-image` on `.sidenav-panel`.
- Staggered `relay-rise` entrance on tab items (`prefers-reduced-motion` noop).
- `.relay-bleed-mark` scaled down on mobile empty states.
- Breakpoint reference block documented in `tokens.css` (820 / 1040 / 879 / 768 / 640 / 600 / 560).

**Touch targets (extended)**

- `@media (pointer: coarse)` bumps for `.sidenav-btn`, `.artifact-index-btn`, `.backlog-view-btn`.

### Verify manually

| Viewport | Surfaces |
|----------|----------|
| 390×844 | Login, chat thread↔chat toggle, route topbar titles, bottom nav accent, preferences logout, artifact drawer stack, admin FAB clearance |
| 820×1180 | Tablet shell, backlog board scroll, admin KPI 2×2 |
| 1024×768 | Desktop-narrow thread pane (1040 breakpoint) |

**Screenshot evidence (login, post-pass):**

- `/tmp/relay-mobile-pass-shots/login-light-mobile-390x844.png`
- `/tmp/relay-mobile-pass-shots/login-light-tablet-820x1180.png`

Prior authenticated gated-surface shots remain under `/tmp/relay-warm-precision-auth-shots/`. Re-capture authenticated mobile flows after login with seeded task data if richer content states are needed.

### Mobile polish pass 2 (2026-07-05)

Second review targeted remaining chrome duplication and density issues visible at 390px.

**Fixed:**

- **Duplicate headers on work routes** — mobile topbar already shows the route name; in-page `PageHeader` title/count are visually hidden below 820px, leaving a compact actions toolbar only.
- **Chat triple chrome** — mobile topbar is contextual per view: threads shows only “Chats”, chat shows only the conversation title (non-interactive; back button navigates). Duplicate `h2` in chat header is sr-only on chat view; thread list “Messages” heading hidden.
- **Topbar active pills** — switched from filled teal to quiet surface-strong (navigation, not CTA).
- **Bottom tab bar** — removed aggressive scroll mask that clipped tab labels; active tab uses teal top accent + transparent fill instead of desktop surface fill.
- **Composer** — `mode-chip` min-width relaxed; footer wraps on narrow widths.
- **Admin** — pulse/KPI/content padding tightened at 820px (not only 768px).
- **Login mobile** — safe-area padding on pane; create-admin row stacks below 480px; toggle button meets 44px touch target.

**Verify manually:** chat thread↔chat flow (topbar + back button), backlog/admin with single title band, login footer at 390px.

### Mobile popups pass (2026-07-05)

Audit of every overlay surface at ≤820px — drawers, modals, sheets, and composer popovers. New module: [`web/src/styles/mobile-overlays.css`](web/src/styles/mobile-overlays.css).

| Surface | Mobile treatment |
|---------|------------------|
| **Admin/task drawers** (`Drawer.tsx`) | Full `100dvh` takeover; tighter head/body padding; sticky form footer with safe-area; 44px close; action buttons stack/wrap |
| **Preferences** (`PreferencesDialog`) | Bottom-anchored sheet (`92dvh`); horizontal nav at 820px; theme cards single-column |
| **Confirm/prompt** (`DialogProvider`) | Full-width card; stacked action buttons (destructive/primary last); 44px inputs |
| **Attention rail** (`AttentionRail`) | Full-width bottom sheet; `78dvh` max; safe-area padding |
| **Agent picker / @mention** | Fixed lower panel above bottom nav + composer (no longer clipped off-screen) |
| **Handoff panel** | Full-width; stacked action buttons |
| **Artifact library drawer** | Inherits drawer takeover + existing vertical index stack |

**Verify manually:** open task drawer, preferences, rename confirm dialog, @mention popover, admin attention sheet, artifact drawer at 390px with keyboard up.
