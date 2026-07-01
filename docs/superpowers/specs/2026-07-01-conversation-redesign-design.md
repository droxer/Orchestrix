# Conversation Redesign — "The Thread"

**Date:** 2026-07-01
**Status:** Approved design, pre-implementation
**Scope:** Web conversation surface only (`web/`). TUI untouched.

## Summary

Redesign Relay's conversation and chat surface around a single continuous
**rail** — a vertical spine that threads every turn, human and agent alike.
The redesign stays entirely within the existing precision/technical design
system (`docs/design-system.md`): monochrome canvas, near-black ink as the
only action color, status-only color, Geist + Geist Mono, **flat surfaces
with hairline borders and no shadows**. The "modern/future" quality comes
exclusively from structure, typographic hierarchy, and restrained functional
motion — not from depth, new color, or decoration.

This was chosen over (a) a warmer/consumer direction, (b) an AI-native
interaction-paradigm rebuild, and (c) a bold visual reinvention. The user
explicitly selected: evolve the precision aesthetic; stay strictly flat;
restrained & functional motion only.

## Design decisions (each validated visually)

1. **Structure: threaded rail.** Chosen over a de-bubbled document log and a
   run/pipeline card model. One device answers all four focus areas (agent
   identity, multi-agent choreography, dialogue rhythm, navigation).
2. **Disclosure: full stream, always.** The complete work record — thinking,
   tool calls, prose, artifacts — stays inline and permanent. Nothing
   collapses. Chosen over "work collapses on completion" and "thinking quiet."
3. **Thread list: grouped by state** — *Needs you → Running → Idle*. Chosen
   over a flat dense roster and an activity-forward layout.
4. **Human voice: on-rail node.** The user sits on the same spine as a filled
   circular ink node (agents are squares). Chosen over a right-aligned bubble
   and a full-width instruction band.

## The rail (core structural device)

A 1.5px hairline spine runs down the transcript's left gutter. Every turn
hangs off it via a **node** positioned at the gutter:

- **Agent turn** → square node, 12–13px, monochrome ink glyph (`AgentMark` shape carries identity — **not** vendor brand hue).
- **Human turn** → filled **circular** ink node.

Square-vs-circle is the sole attribution device; no avatars. The rail is
**continuous across handoffs**, so a `claude → codex` sequence reads as one
connected gesture, not two stacked messages. Consecutive same-agent turns
group: the repeated eyebrow is dropped (existing `.msg-agent.grouped`
behavior), and the rail simply continues.

## Turn anatomy (full stream, always)

Each agent turn, top to bottom:

- **Eyebrow** — mono (`var(--type-meta-mono)`), `agent · mode`. The agent
  name is ink; the mode token is muted. A `review` turn earns the one hue:
  an info dot + info mode label (existing `[data-mode="review"]`
  treatment). Post-cobalt-rebrand, `--color-info` folds into the brand, so
  this resolves to cobalt — not the legacy `#3b82f6` blue.
- **Timestamp** — mono, muted, right-aligned (existing).
- **Work stream** — rendered by `AgentStream` unchanged. Three permanent
  type tiers carry legibility in place of collapse:
  - *thinking / reasoning* — 13px Geist, muted, italic.
  - *tool / command lines* — 12px Geist Mono, body color, `⏺` glyph.
  - *prose answer* — 14px Geist, ink.
- **Artifact chips** — existing `ArtifactCard` / `PlanCard`, reparented under
  the rail.

Human turn: circular node, mono `YOU` eyebrow + mono timestamp, then the
message in 14px Geist, medium weight, ink. No bubble, no fill, no right
alignment.

The **no-raw-JSONL** invariant and block-based rendering
(`●`/`○`/`⏺` markers) are preserved exactly — `AgentStream`'s contract does
not change; only its container does.

## Thread list — grouped by state

`ThreadPanel` renders sessions in three ordered sections, each with a mono
section label and count:

1. **Needs you** — sessions awaiting a human decision (approval/review).
   Warn-amber accent (`--accent-yellow`), listed first.
2. **Running** — sessions with an active agent turn. Live info-blue pulse dot.
3. **Idle** — everything else, recency-ordered.

Row anatomy (unchanged density from today): status dot, agent mark, title,
one-line activity sub, mono relative timestamp. The selected row keeps the
`--color-surface-strong` fill. The "+ New conversation" and search affordances
are unchanged. Section derivation is a **pure function** over the existing
conversation/session status (see `conversationStatus.ts`) — no new backend
state. An empty section is omitted entirely.

Optional, low-priority: a small activity accent on the Running row. Out of
scope for v1 unless trivial.

## Motion spec (restrained & functional only)

| Moment | Motion |
|---|---|
| Turn appears | Existing `message-in`: 10px rise + fade, `--duration-base` ease-out |
| New node | Node scales in ~120ms as the rail extends to reach it |
| Live agent turn | Info-blue `working` pulse + streaming caret (already in system) |
| Running thread row | Status-dot pulse only |

Nothing else animates. No parallax, no decorative transitions, no shadow
fades (there are no shadows). Respect `prefers-reduced-motion`: pulses and
the rise become instant/static.

## Components touched

- `web/src/components/MessageBlock.tsx` — rail + node structure; user turn
  becomes an on-rail circular node (remove the right-aligned `.bubble`);
  agent nodes square + mark-colored. Grouping logic unchanged.
- `web/src/components/ThreadPanel.tsx` — render state-grouped sections.
- `web/src/components/ConversationRow.tsx` — row unchanged structurally; may
  expose status for grouping.
- `web/src/lib/conversationStatus.ts` (or a new sibling) — pure
  `groupConversations(items) → { needsYou, running, idle }`.
- `web/src/styles/chat.css` — the rail, nodes, type tiers; **retire** the
  `.msg-user` right-align + ink-fill bubble rules; replace with on-rail
  treatment.
- `web/src/styles/thread.css` — section labels, grouped layout.
- `web/src/components/AgentStream.tsx` — **no contract change**; restyle only
  insofar as it sits inside the rail column.
- Composer (`composer/Composer.tsx`, `ModeToggle.tsx`, `MentionPopover.tsx`,
  `DecisionBar.tsx`) — **restyle-only**: align flush to the rail column, no
  behavior change.
- i18n — add a `message.you` (or reuse) mono `YOU` eyebrow key; otherwise
  reuse existing keys.

Explicitly **not** touched: backend, session/event model, `AgentStream`
rendering contract, TUI, the agent registry.

## Testing

- `web/tests/messageBlock.test.ts` — user turn renders as an on-rail circular
  node (no `.bubble`, not right-aligned); agent turn renders a square
  mark-colored node; `review` mode renders the info-blue dot.
- `web/tests/agentStream.test.ts` — unchanged; continues to prove no raw
  JSONL leaks and block markers render.
- New: unit test for `groupConversations` — correct section assignment and
  ordering for needs-you / running / idle, empty-section omission.
- Existing TUI frame tests untouched (web-only change).

## Out of scope (YAGNI)

- Collapse/disclosure affordances for long turns (explicitly rejected).
- Shadows, elevation, translucency, or any depth system.
- New color beyond the existing status palette.
- Composer behavior changes.
- Backend or event-model changes.
- TUI changes.
