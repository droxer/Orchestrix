# Relay Web Identity Evolution — "Sleek Forest"

_Date: 2026-07-14 · Scope: `web/` frontend visual identity + list-page structure · Status: approved design, pending implementation plan._

## Motivation

The current design language (Graphite Steel — cool charcoal canvas, steel-blue accent) was judged generic/"AI-slop": a safe reskin of the Linear/Vercel lineage that reads as interchangeable with any other dark SaaS dashboard. The palette has been swapped several times (cobalt → teal → Graphite Steel) without the underlying page structure changing — every list page (Backlog, Routine) shares an identical KPI-tile-row-plus-centered-icon-empty-state template, which is a second, structural source of the "generic" feeling independent of color.

Direction was chosen through an iterative visual-companion brainstorm (mockups in `.superpowers/brainstorm/57281-1784030223/content/`). The brief evolved during the session: an initial literal "workforce/dispatch" metaphor (paper work-orders, roster ID-cards) was explored and explicitly rejected as reading dated rather than "modern AI platform." The approved direction keeps the workforce concept only as restrained status language, inside a sleek, chat-native visual register close to Claude.ai's.

| Decision | Choice |
|---|---|
| Visual register | Sleek chat-native (vs. literal workforce/office props, vs. bold gradient-forward) |
| Canvas | Warm near-black dark (vs. warm light, vs. the current cool charcoal) |
| Action color | Forest Green (vs. Ember, Signal Lime, Periwinkle, Copper, Coral, Electric Indigo, Ice Cyan, Magenta, Gold, gradient) |
| Typography | Neutral Grotesk, system sans (vs. serif-headline/sans-body, vs. mono-forward) |
| List-page structure | Inline Stat Bar (vs. Stat Rail, vs. Tiles Merged & Restyled) |
| Workforce metaphor | Kept subtle — quiet status captions only (vs. dropped entirely, vs. literal props) |

## 1. Concept

Relay reads as a sleek, content-first AI chat product first — the workforce/dispatch identity survives only as restrained language ("Claude · active 4m") rather than visual props (badges, clipboards, cork-board texture). Distinctiveness comes from a single unusual action color (forest green, not another blue/teal SaaS accent) on a warm near-black canvas, not from literal metaphor or typographic risk-taking — typography stays deliberately safe (neutral grotesk) so the color and structural changes carry the identity. The three-tier token architecture in `web/src/styles/tokens/` means this lands as a primitives swap plus one structural pattern change to list pages, not a component rewrite.

## 2. Color

All values originate in `web/src/styles/tokens/primitives.css` only; `semantic.css` aliases are unaffected in name, only in resolved value.

### Dark theme (primitives) — now the only fully-specified register

- **Canvas** — cool charcoal → warm near-black:
  - `--color-canvas-base: #141311`
  - `--color-canvas-soft: #1b1a16` (surface-1)
  - `--color-canvas-strong: #211f1a` (surface-2)
  - `--color-canvas-raised: #262420` (surface-3)
  - `--color-hairline-300: #2c2a24`, `--color-hairline-200: #211f1a`
- **Ink** — cool light-gray ramp → warm off-white ramp:
  - `--color-ink-900: #f5f3ec`
  - `--color-ink-700: #d8d4c8`
  - `--color-ink-500: #b8b4a8`
  - `--color-ink-300: #8a8578`
  - `--color-ink-200: #67645b`
- **Accent** — steel blue → Forest Green, single chromatic action color (brand mark, primary CTA, focus ring, link emphasis; never decorative):
  - `--color-accent: #4f9d6e`
  - `--color-accent-active: #63b482` (hover/pressed, lighter step)
  - `--color-accent-disabled: #3d5c4b` (desaturated toward canvas)
  - `--color-accent-tint: #16241c` (selection wash — dark green-tinted surface, not pastel)
  - `--color-on-accent: #0d1410` (near-black text on the mid-bright accent)
- **Status hues** — the only other chroma, dots/borders/text only, never fills or actions. Re-tuned so none collides with the green accent:
  - `--color-green: #2fb355` (success — kept green but a distinctly brighter/more saturated step than the muted forest accent; verify against accent side-by-side, nudge further if they read as "the same green" at small sizes)
  - `--color-red: #ef6f6f` (danger)
  - `--color-yellow: #e0a857` (warning)
  - `--color-slate: #8a8578` (info — neutral)
  - **Agent activity dots are a distinct category from success/danger/warning** and must not reuse `--color-green`: active → `--color-agent-active: #5fa8e0` (blue), idle → `--color-agent-idle: #8a8578` (same neutral as info/ink-300). Add these two as named primitives rather than overloading status colors, since "agent is active" is a different signal from "task succeeded."
- **Rust/syntax accent** (`--color-rust`) — unaffected, orthogonal to this reskin.

### Light theme

Not mocked in this brainstorm. Carry the same warm-neutral-canvas / forest-green-accent recipe into the light register during implementation (warm off-white canvas, deepened forest green for AA contrast — mirror how the current Graphite Steel light theme deepens `#5b87d6` → `#2f5fad`), and re-verify status hues against the lighter canvas. Flag as an explicit implementation task, not assumed identical to dark.

### High-contrast themes

Not covered in this brainstorm. Existing structure (ink hairlines, no grain, kind-accents collapse to ink) should stay; substitute the forest-green family tuned to ≥7:1, same pattern as prior identity passes.

## 3. Typography

- No font changes. `--font-sans` stays the existing neutral system grotesk; no serif or mono is promoted to headline/chrome duty.
- This was a deliberate choice, not a default: two more distinctive pairings (serif-headline/sans-body, mono-forward) were presented and passed over in favor of keeping typography low-risk while color and structure carry the identity change.

## 4. Agent/team status pattern

Replaces the current "No agents available" label and any badge-style agent status treatment with a quiet, consistent pattern used everywhere an agent's state is shown (team rail, thread header, mention picker):

- A small (8px) solid dot using `--color-agent-active` or `--color-agent-idle`, followed by the agent name and a muted caption: `Claude · active 4m`, `Codex · idle`.
- No card chrome, shadow, or badge pill around this — it's inline text with a colored dot, matching the sleek chat-native register.
- This is the full extent of the "workforce" metaphor in the shipped UI — no shift/roster/clock-in language, no ticket or clipboard visuals.

## 5. List-page structure — Inline Stat Bar

Applies to Backlog, Routine, and any future page sharing their current KPI-tile-row + centered-icon-empty-state template.

- **Stats**: the 3–4 KPI numbers (e.g. Total/Active/Blocked/Overdue) collapse from a row of bordered tiles into a single quiet line directly under the page title: `0 tasks · 0 active · 0 blocked · 0 overdue`, each non-zero/non-neutral figure colored with its semantic status hue (active → agent-active blue, blocked → warning amber) rather than boxed.
- **Empty state**: drops the centered icon + heading + subheading + button block entirely. Replaced with left-aligned body text ("No tasks queued yet.") plus an inline quick-add control (text input + small accent button) directly below, matching the page's normal content alignment instead of a separate centered module.
- **Populated state** (not mocked, follows from the pattern): once rows exist, the inline stat bar and quick-add stay in place above the list/table — this spec only changes the chrome around the list, not the list/row rendering itself.
- Search + Filters row (currently present on both pages) is unchanged by this spec.

## 6. Rollout scope

Explicitly out of scope for the mockups produced in this brainstorm, to be scoped during planning:

- Applying the palette to the light theme and high-contrast themes (recipe described above, not pixel-specified).
- Admin console and Agent Workspace pages — same token/status-pattern changes apply, but neither was individually mocked.
- Any component currently hardcoding a status-green that now needs to move to `--color-agent-active`/`--color-agent-idle` instead of `--color-green` — an audit of current agent-status usages (`AgentStateBadge.tsx`, `StatusPill.tsx`, thread/team rail components) is needed to find every spot conflating "agent activity" with "task success," since those were previously the same green and now must diverge.

## 7. Testing

- Visual/manual: re-run the existing login-gated screenshot harness (mocked `/auth/me`, per project memory) across Threads, Backlog, Routine, Workspace, Admin, in both themes, to confirm no page is left on the old palette after the primitives swap.
- No new automated test surface — this is a token + structural-CSS change; existing component tests (`web/tests/*`) should continue to pass unmodified since they don't assert on color/layout pixels.
