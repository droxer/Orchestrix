# Relay Web — Design Review

## New-thread running environment (2026-07-26)

New-thread initialization now uses a compact setup rail above the composer,
referencing the supplied Codex new-task screenshot's clear hierarchy without
copying its visual system. The rail shows “New thread” and a single computer
selector; it stays attached to the larger prompt surface so runtime choice
reads as setup for the conversation rather than a global preference.

- Only online, non-stale computers owned by the employee are selectable.
- Selecting a computer immediately filters the agent picker to active
  placements on that node.
- Send remains disabled until a computer is selected.
- Once the first run creates the thread, the setup rail disappears and the
  persisted thread runtime becomes immutable routing affinity.
- The treatment uses Graphite surfaces, hairlines, type roles, and existing
  select primitives; at 640px the redundant “New thread” label collapses while
  the computer selector remains available.

## Graphite — new identity + token system rebuild (2026-07-19)

Replaced the Sleek Forest identity (warm near-black + forest green + Instrument Serif) and its bloated 4-tier token system with **Graphite**: true-neutral canvas, one steel-blue action color, status-only chroma, two registers designed side by side. Spec: `docs/superpowers/specs/2026-07-19-graphite-tokens-design.md`; living specimen: `docs/design-system-preview.html`; reference: `docs/design-system.md` (fully rewritten).

- **New tiers.** `tokens/primitives.css` + `semantic.css` → `tokens/palette.css` (raw values, both registers side by side — dual-first, neither derived) + `roles.css` (10 `--type-*` roles, 2 shadows, focus rings, `--info` alias). `shadcn-bridge.css`/`base.css` rewired; Tailwind utility names kept stable so TSX never tracked the rename.
- **New names, collapsed scales.** `--surface-0..3`, `--ink-1..4`, `--line-1/2`, `--action*`/`--on-action` (not `--accent` — shadcn reserves `--accent`/`--ring`), `--ok/--warn/--err/--info`, `--r-1..3+full` (9 radii → 4), `--sp-1..9`, `--fs-1..6` (11 sizes → 6), `--track-tight/0/caps` (8 → 3), one `--ease` + `--t-fast/--t-slow` (3 eases × 4 durations → 1 × 2), z 7 → 5 layers, one `--scrim` (3-layer stack deleted; stacked backdrops composite). ~3.4k mechanical replacements across 36 files; zero old names survive outside the bridge.
- **Chroma cuts.** Artifact kind rainbow (7 hues) → monochrome chips (icon + mono label carry kind); `--color-rust` code numerals → ink; dot-vs-text dual status ramps → one AA-safe value per hue per register; info = ink. Status is dot/border/text only, never fills; disabled is opacity, not a hex.
- **Serif deleted.** Instrument Serif removed from `layout.tsx` (font payload gone); login/empty heroes are Geist 600 with tight tracking. Body 17px → 15px (deliberate — denser console read).
- **Rebranded assets.** favicon/relay-mark/relay-logo SVGs, theme-color metas, `appStorage` chrome colors, login `--lg-*` pinned ramp, preferences theme swatches — all retuned to graphite + steel (#6ba1d4 dark / #33689e light on #101214 / #f7f8f9).

**Verify:** stylelint clean (hex-only-in-palette now points at `palette.css`), tsc clean, full web suite passing except pre-existing `adminChannels` failure (fails at clean HEAD). Screenshots light+dark 1440: login, chat, backlog, and admin dashboard all verified on the Graphite registers. Harness gotcha reconfirmed: `/\/sessions$/` swallows `/cp/dashboard/sessions` — anchor list-endpoint regexes to the URL root.

The redesigned agent-instructions card read as too heavy against the app's monochrome, hairline-driven spec. Stripped the decoration to bring it in line:

- **Flat card, no accent chrome.** `.agent-instruction-card` dropped the 135° action-tinted gradient, the `inset 3px` action left-bar, and the `is-editing` drop shadow. It's now a plain `surface-soft` panel with a `hairline-soft` border; editing just firms the border to `hairline` and lifts the fill to `surface-strong`.
- **Dropped the icon tile.** Removed the bordered, action-tinted `StreamThinking` mark (`.agent-instruction-card-mark`) and its 3-column grid head; the head is a simple flex row (heading + edit button). Title/state/help stand on their own.
- **Prose sits inline.** `.agent-instruction-prose` and `.agent-instruction-empty` lost the 38px left indent and their nested bordered/ dashed boxes — now plain text separated from the head by a single `hairline-soft` top rule. State pill kept (monochrome default, action tint only when custom).

**Verify:** agent workspace profile + admin agent drawer, light + dark — instruction card is a quiet hairline card, no gradient/left-bar/icon-tile, prose flows directly under a thin divider. tsc clean, stylelint clean.

## Chat speaker identity + Ask/Handoff mode design (2026-07-19)

Gave the two chat voices a designed, matched-but-distinct identity, moved the Relay product mark onto the generic agent-phase marker, and gave the Ask/Handoff modes their own visual language.

**Shipped:**

- **Speaker avatars — circle vs square.** The human "You" turn is now a **round** solid action-green avatar (`.rail-node.rail-node-user`, `radius-full`, `UserRound` glyph at the app's 1.75 stroke); the agent turn keeps its **square** light product tile (`radius-sm`, raised surface, faint action-tinted border) carrying the **specific** executor's vendor glyph (`AgentMark` — Claude/Kimi/etc.). Circle-vs-square, not colour, is the fast human-vs-machine tell. Selectors are scoped one level deep (`.msg-user .rail-node.rail-node-user`) so the fill wins over atelier's `html[data-theme="dark"] .rail-node` background override (specificity 0,3,0 > 0,2,1) in both themes.
- **Product mark on the agent-phase divider.** The generic `AGENT` phase eyebrow swapped its lucide `Bot` for the `RelayMark` chevron (`ThreadsView`) — "the agent" as one product. Ask/Review/Handoff phase icons keep their semantic lucide glyphs. Per-turn headers deliberately keep the vendor mark + agent name (the "which agent ran" signal).
- **Compact user bubble.** `.msg-user .turn-body` went from a full-width soft card that dwarfed short messages to a `fit-content`, `max-width: 42rem` bubble with a hairline, tighter padding, `leading-normal`, and a subtle top-left notch (`radius-xs`) pointing at the avatar. The redundant `YOU` eyebrow was dropped (the green avatar already attributes it; preserved as an `aria-label` on the article). `.msg-user .turn-who` deleted.
- **Ask mode = quiet slate outline.** `.mode-chip[data-mode="ask"]` now carries a slate (`--color-semantic-info`) icon + inset slate ring on a neutral raised surface, vs the Agent chip's green fill — the filled-vs-outlined asymmetry reads as "does work" vs "just asks" (respects the palette rule: status colours as icon/border, never fills).
- **Handoff panel header.** Added an action-tinted route-icon chip (`ActionRoute` = `ArrowRightLeft`, new in `icons.tsx`) + "Hand off this turn" title + hairline divider (`.handoff-panel-head`), so the drawer reads as a deliberate affordance. New i18n `handoff.title` in en/zh-CN/zh-TW.

**Verify:** chat `#/chat/*` light + dark 1280 — You is a round green avatar + tight single-line bubble; Agent is a square tile + Claude mark + name; `» AGENT` divider shows the Relay chevron; composer Ask chip is slate-outlined; the waiting-for-human decision bar's Handoff opens a panel with the route-chip header. tsc clean, stylelint clean, full web suite 241 pass.

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

- **P1 — Dead v1 admin stylesheet (~755 lines).** `src/styles/admin.css` is still `@import`ed (`src/styles.css:51`) but the app runs entirely on the v2 `adm-*` system. Its `.ac-*` selectors (the whole v1 admin page) have **zero references** in any component. Only three rules are still live — `.messenger-shell[data-route="admin"]` (`admin.css:7,11`) and the `.admin-console` base (`admin.css:16`). **Action:** relocate those three live rules into `shell.css` / `admin-v2-shell.css`, then delete `admin.css` and its import. Removes ~16 raw `font-size` + 17 `font:` declarations and a large dead surface. _(Touches the admin route — verify visually after.)_
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

## Admin page elevation (2026-07-03)

Scoped visual pass on the v2 `adm-*` admin page — dashboard signature moment, operational continuity, node accents, activity timeline. No font or palette changes; stays within the precision design language.

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

## Unified Geist type pass (2026-07-05)

Rethought the font families for both English and Chinese. Latin identity moves from Instrument Sans to a unified Geist superfamily — Geist Sans for UI/display, Geist Mono unchanged as the identity signal — giving the product a cooler, terminal-grade instrument-panel character.

**Shipped:**

- **Latin** — `--font-app-sans` now loads Geist Sans (`layout.tsx`); base `--font-sans` fallback updated. Display tracking softened for Geist's tighter grotesk letterforms (`--letter-display`/`--letter-display-strong` → -0.25px, `--letter-body` → 0).
- **CJK strategy** — `html:lang(zh-*)` stacks are now system-first (PingFang, HarmonyOS Sans / MiSans, Microsoft YaHei/JhengHei) with the Noto Sans SC/TC webfonts demoted to last-resort fallback; their chunks only download when every system font misses a Han glyph.
- **CJK typographic corrections** — a shared `html:lang(zh-CN/zh-TW)` block neutralizes negative/caps tracking on Han text, loosens `--leading-normal`/`--leading-loose` to 1.7/1.8, and restates the reading-heavy `--type-body-*`/`--type-caption` roles with CJK-appropriate leading.

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
- **Artifacts drawer** — vertical stack at 820px; opens with expanded index list on mobile (`ArtifactsDrawer` + `artifact.css`).
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
| **Composer agent picker** | Opens above the composer and bottom navigation without clipping |
| **Handoff panel** | Full-width; stacked action buttons |
| **Artifact library drawer** | Inherits drawer takeover + existing vertical index stack |

**Verify manually:** open task drawer, preferences, rename confirm dialog, composer agent picker, admin attention sheet, artifact drawer at 390px with keyboard up.

## Clarity pass (2026-07-12)

Whole-frontend visual cleanup toward the design system's hairline-first restraint: less glow, less decoration, clearer hierarchy. No layout or product-flow changes.

**Shipped:**

- **Empty states** — removed animated `atelier-orbit` rings/dots; transcript empty uses a plain agent avatar. Dropped bled "R" watermarks from transcript, agents, and admin KPI band (login keeps its signature moment).
- **Chrome noise** — removed sidenav brand glow, active-nav drop shadow, conversation "new" rotate/ink-plate override, empty-avatar radial halo, chat artifact-count soft shadow, composer running glow pulse, mode-chip icon tilt, login lane glow, workspace preview radial wash.
- **Surfaces** — backlog/admin/workspace metric strips stay flush (border-bottom only, not nested cards). Backlog page drops gradient wash + lane grid wallpaper. Admin KPI band drops the decorative `::after` grid overlay (tile borders already divide). Transcript empty no longer sits in a bordered paper card.
- **Geometry** — login submit returns to `--radius-md` (pill retired per design system). Empty-state titles keep base `--type-title-md` instead of oversized display clamp.

**Verify:** chat empty + thread list, backlog list/board, agents roster, admin dashboard KPIs, login CTA, composer while an agent is running — light/dark, 1440 / 390.

## Clarity pass 2 (2026-07-12)

Second pass focused on cascade bugs and hierarchy quieting.

**Shipped:**

- **Segmented cascade fix** — atelier no longer forces chip-group chrome onto full-width filter bars, underline admin tabs, fleet chip rows, or workspace tab strips. Segmented grammar stays on `.segmented` / view toggles / header agent tabs only.
- **Eyebrows muted** — page/chat/mobile/conversation kickers use muted ink (design-system default) instead of action teal, so cyan stays reserved for true actions.
- **Pane vs card** — agents detail is a split pane again (no raised card border). Login backdrop owned solely by `login.css`.
- **Composer geometry** — mode chip and send button leave the pill/circle + scale bounce; both use `--radius-md`.
- **Solid sticky chrome** — backlog lane/list heads, workspace pane heads, and message turn actions drop frosted blur mixes for solid canvas/raised fills.

**Verify:** backlog filters + board/list toggle, admin People/Fleet tabs, agents roster/detail split, composer send/mode, sticky lane headers while scrolling.

## Graphite Steel identity pass (2026-07-12)

Reskin from Signal Cyan to **Graphite Steel** — cool charcoal surfaces + restrained steel-blue action — for a calmer, more professional read. Palette-only: four-tier token architecture and component CSS stay intact; hex changes live in Tier 1 plus synced consumers.

**Locked ramps:**

| Role | Dark | Light |
|------|------|-------|
| Canvas | `#0b0d10` | `#f7f8fa` |
| Soft / strong / raised | `#14171c` / `#1a1e25` / `#1f242c` | `#ffffff` / `#eef0f3` / `#ffffff` |
| Hairline 300 / 200 | `#262b33` / `#1a1e25` | `#e2e5ea` / `#eef0f3` |
| Ink 900 / 700 / 500 | `#f3f5f7` / `#c5ccd6` / `#8b93a0` | `#12141a` / `#3f4550` / `#6b7280` |
| Action / active / disabled | `#5b87d6` / `#7aa0e0` / `#6a7a94` | `#2f5fad` / `#274f91` / `#7a8aa3` |
| Accent tint | `#152033` | `#dce6f5` |
| On-action | `#0a1220` | `#ffffff` |

**Shipped:**

- **Primitives** — `tokens/primitives.css` dark + light registers rewritten; headers renamed Signal Cyan → Graphite Steel.
- **Synced hex** — `appStorage.ts` / `layout.tsx` theme-color, preferences swatches, login `--lg-*` (renamed `--lg-steel*`), `appStorage` tests.
- **Brand assets** — `assets/brand/*`, `web/public/favicon.svg` + `web/public/brand/*` retargeted to Graphite Steel; `RelayMark` lead chevron uses `--color-semantic-action`.
- **Docs** — `docs/design-system.md` frontmatter + narrative; this review entry.

**Out of scope:** leftover clarity-pass surface cleanup (muted kickers, sidenav plates, mobile blur).

**Verify:** login CTA, preferences theme picker, chat shell, backlog, admin dashboard — light/dark, 1440 / 390. `npm run lint:css -w web`, `make web-test`.


## Anti-slop pass (2026-07-17)

Targeted removal of remaining templated-AI patterns. Build ✓, full web suite ✓ (241 pass).

**Shipped:**

- **Dashboard card eyebrows removed** — every belt card carried an uppercase eyebrow that near-duplicated its own title ("Node health"/"Node status", "Tokens"/"Token usage", "Employees"/"Most active employees", "Recent"/"Recent activity"). Cards now lead with the title alone; the Threads chart folds the removed "14d" range into its title ("Threads · last 14 days"). KPI tile eyebrows stay — there the label IS the metric name, not decoration. `.adm-dash-card-eyebrow` CSS deleted.
- **Rank numbering** — Top-employees list drops the zero-padded "01 02 03" editorial mono numbering for plain ranks.
- **Copy** — visible em-dash removed (`chat_provider_coming_soon` → "(coming soon)" across en/zh-CN/zh-TW); artifact "Copied!" loses the exclamation; channels surface no longer says "coming soon" three ways (route subtitle → "Telegram channels.", stage hint rewritten as a plain requirement sentence; the disabled Discord option keeps the single mention).
- **Test** — `adminChannels.test.ts` copy assertion updated to the new subtitle.

**Audited and intentionally kept:** login grid/wash (signature), skeleton shimmer + chart hatch gradients (functional), status dots (semantic state only), drawer/page kickers (navigation context), "—" as missing-data placeholder.

**Screenshot verification (mocked-API Playwright pass, light/dark at 1440/390):** dashboard cards render with single titles and plain ranks in both themes; channels stage reads cleanly as the two-up intro + form.

**Follow-ups from the screenshot pass:**

- **Channels stage hint removed** — the `RelayEmptyState` hint slot renders uppercase micro-caps, so the rewritten hint sentence read as shouting, and the adjacent form already states the requirements. `chat_stage_hint` deleted from all locales.
- **Theme preference clobber fixed (real bug)** — `App.tsx`'s `[theme]` effect ran on first render with the default `"system"` and `writeTheme`-clobbered the stored preference before the `[mounted]` effect read it, resetting every user's saved theme on every load (and defeating dark-mode screenshots). The apply/persist effect now waits for `mounted`; pre-paint theming stays with the `layout.tsx` inline script.

**Verify:** theme choice survives reload (pick Dark, reload, still dark); channels stage on desktop; artifact copy toast.

## SideNav "More" duplication fix (2026-07-18)

User report: the admin "More" overflow appeared on desktop alongside the primary Channels/Admin rail items, so its menu duplicated visible destinations.

**Root cause:** `.sidenav-more-btn { display: none }` (2-class specificity, mid-file) lost to the later `.sidenav-panel[data-expanded="true"] .sidenav-btn { display: flex }` (3-class). The mobile-only trigger therefore rendered at every width.

**Shipped:**

- **Hide rule moved to end of `sidenav.css`** at matching 3-class specificity (`.sidenav-panel .sidenav-btn.sidenav-more-btn`); the mobile bottom-tab media query in `responsive.css` re-shows it at equal specificity (later stylesheet wins) with `display: flex` to match the column tab layout.
- **More menu portaled to `<body>`** (`SideNav.tsx`) — the mobile bottom bar's `backdrop-filter` made the panel the containing block for the `position: fixed` menu, so the viewport-based coordinates landed inside the scrollable tab strip: the menu rendered clipped below the fold and focusing its first item scrolled the tab row out of view.
- **Right-edge clamp** in `toggleMoreMenu` — More is the rightmost tab; the 180px-min menu at `rect.left` overflowed the 390px viewport. `x` now clamps to `innerWidth - 188 - 8`.

**Verify:** desktop 1440 (expanded + collapsed), 1000, 860 — Channels/Admin in rail, no More; mobile 390 — More tab opens the menu fully on-screen above the tab bar. Full web suite 241 pass.

## Admin page Channels tab removed (2026-07-18)

The admin page's fourth segment ("Channels") rendered the exact same `ChannelsView` as the top-level `#/channels` route in the sidebar Manage group — a leftover from before channels config was promoted to its own route. Duplicate entry point removed; the page tightens to Dashboard / Employees / Nodes.

**Shipped:**

- `AdminPageView` (store) and `ADMIN_VIEWS` drop `"integrations"`; old `?adminView=integrations` deep links fall back to Dashboard via `parseAdminView`.
- `AdminViewToggle` drops the fourth segment (and the now-unused `AdminChannel` icon import); `AdminPage` drops the `ChannelsView` import/branch.
- `admin.v2.nav_integrations` removed from en/zh-CN/zh-TW (`title_integrations`/`sub_integrations` stay — `ChannelsPage` uses them).
- `adminChannels.test.ts` inverted: it now pins that the admin page does NOT embed the channels view and that `#/channels` is the only home.

**Verify:** admin toggle shows 3 segments; `#/admin?adminView=integrations` lands on Dashboard with hash normalized to `#/admin`; `#/channels` still renders the Telegram setup stage. Full web suite 241 pass.

## Admin Employees/Nodes aligned + card/list views (2026-07-18)

The Employees view was list-only (department-grouped rows) and Nodes was card-only; the two admin surfaces read as different systems. Both now share one chrome language and each supports **card** and **list** layouts via a segmented toggle mirroring the Backlog/Routine `backlog-view-toggle` geometry.

**Shipped:**

- `AdminLayoutToggle` (new) — `card`/`list` switch reusing `backlog-view-toggle`/`backlog-view-btn` (ViewGrid / ViewList icons). Layout state is lifted to `AdminPage`, URL-persisted as `?adminLayout` (default `card`, omitted when card) and shared across both views so the preference is consistent.
- Both views gain a `.adm-view-controls` row: filters (Nodes) / search (Employees) on the left, layout toggle on the right.
- **Employees card view** (`EmployeeCard`, new) reuses the `.adm-node-card` frame — avatar initials, name, `@handle`, a status pill (`emp_state_running|ready|idle|no_nodes`), department eyebrow, email, agent chips, and a running / ready·total metric footer with delete. Flat responsive grid (`.adm-fleet-grid`), no department sections — matching Nodes. List view keeps the grouped rows.
- **Nodes list view** (`NodeRow`, new) — column header (`.adm-node-cols`) + `.adm-node-list` rows sharing the employee-list table language: avatar + identity, agent chips, status pill, last-seen, action icons. Card view unchanged.
- New i18n keys in en/zh-CN/zh-TW: `admin.v2.{layout_label,view_card,view_list,col_status,col_last_seen,col_actions,emp_state_*}`.

**Verify:** dark 1280×900 — Employees card (5 cards, dept eyebrow + IDLE pills), Employees list (grouped), Nodes list (5-col table), Nodes card (unchanged) all render; toggle top-right of each view switches layout and the URL carries `adminLayout=list`. tsc clean, stylelint clean, translation JSON valid.

### Node card: managed/local visual cues + "This host" removed (2026-07-18)

The node card's execution profile was a bare mono label with a 5px color dot — too weak to distinguish managed from local at a glance. Turned it into an icon-led tinted chip, and dropped the redundant "This host" locality from the card.

**Shipped:**

- `NodeProfileBadges` renders a per-kind glyph before the label (`icons.tsx`: `NodeManaged` = Container/box for BoxLite VM, `NodeLocal` = Terminal for direct execution, `NodePending` = CircleDashed for awaiting daemon), driven by an `EXECUTION_ICON` map keyed on `NodeExecutionProfile`.
- `.adm-node-profile-kind` is now a tinted chip (padding + border + `color-mix` background) toned per `data-kind`: managed → info/blue, local → success/green, pending → muted outline. Icon inherits `currentColor`. Replaces the old `::before` dot.
- Cue is triple-encoded (icon + tone + label) so it doesn't rely on color alone.
- `NodeProfileBadges` gained `hideThisHost`; `NodeCard` passes it so the card drops the "This host" locality (the status pill already conveys liveness). CredentialsDrawer keeps the full locality set.

**Verify:** dark 1280×900 nodes card — managed nodes show a boxed blue "Managed" chip, local nodes a green terminal "Local" chip, pending a dashed "Awaiting daemon" chip; no "This host" on cards. tsc + stylelint clean.

## Whole-app visual pass — consistency cleanup (2026-07-18)

Authenticated screenshot pass (mocked-API Playwright, light/dark/mobile) across login, chat, backlog, routine, channels, admin dashboard, and admin Employees/Nodes (card + list). System is strong and cohesive — Graphite Steel holds in both themes, the dashboard reads as one rhythm, the managed/local chips land. Findings were consistency nits, now fixed. Build ✓ (tsc), stylelint ✓, full web suite ✓ (241 pass).

**Shipped:**

- **Employees ↔ Nodes list alignment.** The Employees list carried a **red-at-rest** trash crammed into the metrics cell with no `ACTIONS` column, while the Nodes list used quiet neutral action icons in a dedicated column. Employees list now has its own `ACTIONS` column (4-col grid) with the same `icon-button--sm --tinted danger` glyph (neutral, tints red only on hover) the card and Nodes list already use. `.adm-emp-delete` deleted.
- **List status parity.** Card views showed state (employee `IDLE` pill, node managed/local chip) that the list views dropped. Employees list rows now carry the `adm-status-pill` beside the name (via exported `summaryTone`); Nodes list rows render the standalone run-mode chip under the handle (`NodeRow` gains `storedTokens`/`colocated`, threaded from `NodesView`).
- **Node card profile box.** With locality hidden on the card, the tinted execution chip sat alone inside a full-width bordered box (large dead space). Dropped the wrapper chrome on `.adm-node-card > .adm-node-profile` (and the list's `.adm-node-row-identity .adm-node-profile`); the drawer usage with locality text keeps its box.
- **Channels stat tiles → flush strip.** The `Channels / Active / Links` counters were raised white cards (number-over-label) — the one surface still using a boxier grammar than the flush hairline metric strips on Backlog/Routine. Re-cast `.adm-chat-metrics` as an inline `eyebrow · value` strip mirroring `.backlog-stats` (markup reordered label-first).
- **Mobile KPI sparkline collision.** On the ≤900px 2-col dashboard KPI grid the Nodes tile's sparkline drew a diagonal line across the wrapped "N ready · N failed" caption. Hidden `.adm-dash-spark` at that breakpoint.
- **Robustness (not design, found while fixturing).** `visibleConversationArtifacts` and `BacklogPage.linkedSession` assumed `session.artifacts` / `task.linkedSessionIds` always present and threw a full-page dev overlay otherwise — hardened with `?? []` / `?.at(-1)`.

**Verify:** admin Employees list (neutral trash in ACTIONS col + IDLE pill), Nodes list (profile chip under handle), Nodes card (chip stands alone), Channels toolbar once ≥1 channel exists (inline stat strip), mobile admin dashboard (no sparkline over the Nodes caption) — light/dark, 1440 / 390.

### Ownership badges: identity, not status (2026-07-19)

The graphite token migration silently broke the managed/local chips: `--info` is now neutral ink, so "Managed node" rendered as a washed-out gray chip (read as disabled), while "Local computer" kept `--ok` green — colliding with online/healthy status semantics. Worse, the drawer's execution-profile picker dots used the opposite mapping (managed = action blue, local = gray).

**Shipped:**

- **Ownership badge family** (`.adm-node-profile-kind`): micro-caps (`--type-micro` + `--track-caps` + uppercase), 20px, icon-led — a form visibly distinct from status pills (tone dot + word) and agent chips (vendor mark + lowercase name). Ownership is identity, never status.
- **Managed node** → `--action` tint (text/border/bg via `color-mix`): the brand color says "Relay runs this". **Local computer** → neutral filled (`--ink-2` on `--surface-2`, `--line-1` border): a person's machine, deliberately un-tinted so green/red stay reserved for health. **Ownership pending** → dashed hairline, `--ink-4`.
- **Picker dots aligned** (`.adm-profile-segment-dot`): managed = `--action`, local = `--ink-3` — same mapping as the badges; no more contradiction between the fleet view and the Add/Assign drawers.
- **Agent chips joined the chip family**: `.adm-agent-chip` gains a soft `--line-2` hairline so the executor chips sitting next to the ownership badge read as one system instead of borderless fills; tone still lives only in the dot.

**Verify:** nodes card + list, light/dark 1280×900 (mocked-API Playwright) — blue MANAGED NODE, neutral LOCAL COMPUTER, dashed OWNERSHIP PENDING, bordered executor chips. stylelint clean.

### Rename: "Managed node" → "Cloud computer" (2026-07-19)

Copy-only rename across en / zh-CN (云端电脑) / zh-TW (雲端電腦): `node_ownership_managed` (+hint) and the legacy `node_execution_managed`. "Cloud computer" pairs symmetrically with "Local computer" and says where the machine lives instead of who administers it. Keys and code identifiers keep the `managed` slug.

### Badge review fixes (2026-07-19)

Guidelines pass over the ownership badges + executor chips. Fixed: Agents-page `.agent-placement-badge` still carried the pre-graphite mapping (managed border tinted `--info` → invisible; local tinted `--ok` → status collision) — remapped to managed = `--action` mix, local = plain hairline; pending badge text `--ink-4` → `--ink-3` (11px caps was ~3.5:1, below AA; now 6.7:1 dark / 5.5:1 light); two uses of undefined `--track-1` → `--track-caps` (`.adm-agents-label`, `.agent-placement-badge-rank`). Noted, not changed: list-row executor chips signal status by dot color alone (no title); hints are title-only (aria-label covers SR). stylelint clean, dark card re-verified.

### Agents roster placement badges — collapse fix (2026-07-19)

The roster's placement badges broke under width pressure: every element except the node name was `flex: none`, so a badge with a rank chip collapsed the *name* to zero width (orphaned "·" separator, ownership icon crushed too — the svg had no `flex: none`), while "PREFERRED ROUTE" rendered at full mono badge size, louder than the identity it annotates.

**Shipped:**

- `.agent-placement-badge > svg` pinned `flex: none`; name gets a `min-width: 6ch` floor — it ellipsizes, never vanishes.
- Ownership/runtime text (`-kind`/`-sandbox`) recast in the fleet badge voice — sans micro-caps (`--type-micro` + `--track-caps`), shrinkable with ellipsis after the name so a tight row truncates the annotation, not the panel edge. Rank chip dropped to micro-caps too.
- Rank copy shortened: "Preferred route/Alternate route" → "Preferred/Alternate" (en; zh-CN 首选/备用, zh-TW 首選/備援) — keys only used in this badge.
- Compact badges with a rank chip hide the ownership *text* (`:has()` guard) — the rank is the information there; ownership stays on the icon and the `title`.

**Verify:** #/agents dark 1440×900, agent with two placements (managed preferred + local alternate) — full node names, no panel overflow, no orphaned separators; single-placement badges keep "· CLOUD COMPUTER". stylelint clean, agentPlacements tests pass.

### Placements are peer infra — rank chips removed (2026-07-19)

Cloud computer and local computer are both infrastructure an agent runs on, not a primary/fallback pair — but the placement badges said "PREFERRED"/"ALTERNATE", framing the local machine as second-class. Removed the rank display entirely (`AgentPlacementBadge` drops `showRank`; roster + PlacementList callers updated; `placement_preference_*` keys deleted from all three locales; rank CSS removed). A placement badge is now just where the agent runs: icon + node name + ownership term, a flat set of peers. Routing priority still exists in the data (`describeAgentPlacements` keeps `preference` for the scheduler-facing logic/tests); the UI just no longer editorializes it. Ownership term now stays whole under pressure (name carries the shrink with a 6ch floor; badge gets an overflow guard).

**Verify:** #/agents dark+light — "Fleet box 01 · CLOUD COMPUTER" and "Alice's Mac… · LOCAL COMPUTER" render as symmetric peer badges, no rank chips, no overflow. tsc clean, stylelint clean, agentPlacements tests pass.

### Computers host agents — shared root + personal homes (2026-07-20)

Model decision, full-stack: a **computer (daemon node) is infrastructure for agents** — it hosts them; an employee can have several computers and several agents; and **agents on the same computer collaborate through the shared node workspace root**, each keeping a private home (`agents/agent-<b64>/`) for personal state. Runs now intentionally execute at the shared root (they already did de facto — the daemon's `runAsAgent` cd wins over the exec cwd), the agent prompt gains a `[Workspace]` prelude naming its private directory, generated-file scanning covers the shared root while excluding sibling homes (a concurrent sibling's private output is never cross-attributed; root-level files are shared-attribution, bounded by the per-run mtime/bytes diff), and team assembly plus multi-agent routing require every participating agent to be placed on the same computer.

**Shipped (web):**

- **Fleet cards/rows lead with hosted agents.** `NodeCard`/`NodeRow` show the logical agents placed on the computer (name + vendor mark + status dot, via new `lib/nodeAgents.ts`); executor readiness chips demoted to a secondary "Runtimes" line (`.adm-agents--runtimes`, 82% opacity). Rows fall back to runtime chips when no agents are placed.
- **Workspace page splits Shared / Personal.** The Files tab gains a scope toggle (`workspace-scope-toggle`): "Personal home" (existing behavior incl. snapshot fallback) vs "Shared workspace" (live-only via `scope=shared`; a 503 renders "the computer is offline" instead of a raw error — the shared root has no snapshot history).
- **`primaryNode` removed** from the workspace brief (backend + types) — the employee-level "primary computer" was the last primary/secondary vestige.
- New admin `/cp/daemon-nodes/{id}/workspace/*` shared-browse endpoints + `api.ts` fetchers land with this change; an admin-side browser drawer is a follow-up (admins can already browse any agent's shared scope from the agent page).
- i18n: `workspace.scope_*`, `workspace.shared_unavailable`, `admin.v2.node_hosted_agents(_empty)`, `admin.v2.node_runtimes` in en / zh-CN / zh-TW.

**Verify:** backend pytest suite green (routing co-location, multi-computer scheduling, shared-scope + node workspace APIs); relay-core 81 / relay-daemon 45 / web 239 node-test pass; web tsc + stylelint clean. Manual: two agents on one computer see each other's files at the root; the workspace Files tab toggles Personal/Shared; fleet cards list hosted agents.

### One agent = one computer (2026-07-21)

Model correction from the user: an agent belongs to **exactly one computer**, and a computer hosts **many** agents (one-to-many, not many-to-many). This reverses the earlier multi-placement direction — the shared-workspace collaboration story is now purely *within* a computer (its team of agents share the root).

**Shipped:**

- **Placement invariant** (`agent_placement_store.create_placement`): an agent has at most one active placement; assigning a different computer **moves** it (supersedes the prior placement). Same-computer re-assign still rejects.
- **Per-computer compatibility agents** (`ensure_compatibility_agent` keyed `employee:node:executor`): each computer materializes its own auto-agents — previously one per-employee agent got placed on every matching computer, the one path that made an agent span computers.
- **Roster shows one computer.** `AgentsPage` drops the "N/M ready" count and the badge *list*; each agent shows a single `AgentPlacementBadge` (or "Not placed"). The badge gained a status tone dot (`--tone` on the dot, name stays identity-colored) — resolving the earlier "count implies health the badges don't show" gap, now that there's exactly one.
- Routing co-location preference removed (dead once an agent has ≤1 placement); `placementStatusTone` consolidated into `lib/agentPlacements` (shared by roster badge, PlacementList, fleet hosted-agent chips).

**Pre-invariant data** is healed by `reconcile_single_active_placement` (agent_placement_store.py), run in `create_app` at startup: it collapses any agent holding 2+ active placements to its top-priority one (idempotent, tolerant of a not-yet-migrated DB). Covers file and DB stores at boot, so no separate Alembic migration was needed.

**Verify:** backend pytest 323 pass (placement move, per-computer compat agents, two-agents-one-computer routing); web 245 + core suites pass; web tsc + stylelint clean.
