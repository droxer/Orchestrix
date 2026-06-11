# Relay web — design system

Relay web is a **Slack-style collaboration surface for working with AI agents**:
a three-pane shell (nav rail → conversation list → chat) where each
"employee" sandbox is a contact and each agent run renders as a message
thread. The visual language follows the Relay brand (`docs/Design.md`) —
white canvas, ink text, a single Relay Blue accent — but this document is
the source of truth for the **product UI**; `docs/Design.md` covers
marketing surfaces only.

All tokens live at the top of `src/styles.css` in three tiers.
**Never write a hex value, rgba(), or px font size in component CSS —
reference a token.**

## Tier 1 — primitives

### Color

| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#0052ff` | The only action color: send, primary buttons, active markers, focus rings |
| `--color-primary-active` | `#003ecc` | Hover/press on primary |
| `--color-primary-disabled` | `#a8b8cc` | Disabled primary fills |
| `--color-ink` | `#18232d` | Headings, primary copy, dark fills (active tabs) |
| `--color-body` | `#5b616e` | Running text |
| `--color-muted` | `#7c828a` | Secondary labels, placeholder, icons |
| `--color-muted-soft` | `#a8acb3` | Timestamps, disabled text |
| `--color-on-primary` / `--color-on-dark` | `#ffffff` | Text on blue / ink fills |
| `--color-canvas` | `#ffffff` | Page and panel floor |
| `--color-surface-soft` | `#f7f6f1` | Warm tint: quoted messages, code blocks, row hover |
| `--color-surface-strong` | `#eef0f3` | Cool tint: search fields, avatars, segmented controls |
| `--color-hairline` | `#dee1e6` | Default 1px dividers and input borders |
| `--color-hairline-soft` | `#eef0f3` | Lighter dividers (list rows) |
| `--color-semantic-up` | `#05b169` | Success — text, dots, borders only; never a fill |
| `--color-semantic-down` | `#cf202f` | Failure/danger — text, dots, borders only; never a fill |
| `--color-accent-yellow` | `#f4b000` | "Agent running" attention dot only; not an action color |

### Type scale — seven steps, nothing in between

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 12px | Badges, timestamps, meta rows, kickers |
| `--text-sm` | 13px | Captions, conversation previews, secondary UI |
| `--text-base` | 14px | Default UI chrome: names, buttons, labels |
| `--text-md` | 16px | Message bodies and **all inputs** (≥16px prevents iOS focus zoom) |
| `--text-lg` | 18px | Chat header title, brand mark |
| `--text-xl` | 22px | Panel headings (conversation list, settings drawer) |
| `--text-2xl` | 28px | Empty-state display heading |

Weights: **400** for display headings (editorial calm, per brand), **500**
for mono/metadata, **600** for emphasis and buttons. Nothing heavier.
Numbers, IDs, and code always render in `--font-number` (JetBrains Mono)
via the `.mono` utility or `font-family: var(--font-number)`.

### Radii and spacing

- Radii: `xs` 4 (inline code) · `sm` 8 (rows, buttons) · `md` 12 (inputs,
  popovers, panels) · `xl` 24 (attachment cards) · `pill` (search, badges,
  thinking summary) · `full` (avatars, dots).
- Spacing: 4px base unit, `--space-xxs` (4) through `--space-xxl` (48).

## Tier 2 — semantic aliases

| Token | Use |
|---|---|
| `--border-success` / `--border-danger` / `--border-info` | Tinted borders on outlined status pills and danger buttons (28–32% mixes of the status colors) |
| `--shadow-lift` | Hovered cards. The lower of exactly two elevation tiers |
| `--shadow-overlay` | Floating layers: popovers, mention list, settings drawer |

Every status surface (toasts, pills, dots, agent stream status lines,
system rows) shares one tone vocabulary, the `Tone` type in
`src/types.ts`: **good → semantic-up**, **bad → semantic-down**,
**info → primary**, **warn → accent-yellow dot + muted text**, and
**neutral → default ink/muted**. Tone is never conveyed by a background
fill, with one exception: the conversation-list activity badge uses a
primary fill because it is a navigation affordance, not a status.

## Tier 3 — shadcn/ui bridge

The `@theme inline` block plus the `--background`/`--foreground`/…
aliases expose tokens to Tailwind utilities consumed by
`src/components/ui/*` (currently only `badge.tsx`; add other shadcn
components via the CLI as needed). Keep this mapping in sync if
primitives change; do not reference these aliases from hand-written
component CSS — use the tier‑1/2 tokens directly.

## Layout

```
┌──────┬───────────────┬──────────────────────────────┬───────────┐
│ nav  │ conversations │ chat (header / transcript /  │ settings  │
│ rail │ (employees)   │ composer)                    │ drawer    │
│ 84px │ 344px         │ flex                         │ 360px     │
└──────┴───────────────┴──────────────────────────────┴───────────┘
```

- Panels separate with 1px hairlines, never shadows.
- Transcript content is centered at `min(100%, 960px)`.
- Below 820px the shell collapses to a single pane with a top bar
  switching between conversations and chat.

### Conversation patterns

- **Message grouping** — consecutive transcript blocks from the same
  agent render as continuations (`.msg-agent.grouped`): no avatar or
  header, gutter preserved so text stays aligned.
- **Activity badge** — when an agent is running in a conversation, the
  list row shows a Relay Blue count badge (`.conversation-badge`) and
  the preview line darkens (`.has-activity`).
- **Status toast** — global feedback surfaces as a transient pill
  (`.toast`) floated below the chat header, auto-dismissing after 4s.
  It is the only floating status element; nothing lives in the header.

## Rules

- **One accent.** Relay Blue carries every action. If a second color is
  competing for attention, something is wrong.
- **Flat by default.** Hairlines for structure; shadows only on the two
  floating tiers.
- **No raw values.** New CSS must consume tokens; new sizes/colors get a
  token (and a row here) first.
- **Tone discipline.** Green/red/yellow are status, never decoration or
  buttons fills.
- Focus is always `2px solid var(--color-primary)` with offset — do not
  remove or restyle per-component.
