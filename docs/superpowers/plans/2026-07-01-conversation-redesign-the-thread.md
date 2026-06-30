# Conversation Redesign — "The Thread" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the web conversation surface around a single continuous vertical "rail" that threads every turn (human and agent), with a state-grouped thread list — staying entirely within the existing monochrome/flat design system.

**Architecture:** Pure-logic changes go in `web/src/lib/` (unit-tested under `node:test`); presentational changes go in `web/src/components/` + `web/src/styles/` (verified by the Next build + existing suite + manual `make web`). No backend, event-model, `AgentStream` contract, TUI, or agent-registry changes. The rail is drawn with CSS (per-turn pseudo-element line + absolutely-positioned node); agent identity on the rail comes from the existing monochrome `AgentMark` glyph, not color.

**Tech Stack:** React 19, TypeScript (NodeNext), Next 16 (webpack build), plain CSS with design-system custom properties, i18next, `node:test`.

## Global Constraints

- **Design system is law** (`docs/design-system.md`): monochrome canvas; near-black ink is the only action color; **color is status-only** (success/danger/warning + one info-blue) — never for agent identity or decoration; Geist + Geist Mono; **flat — hairline borders, no shadows**; pills retired; tight geometry (4px buttons/badges, 6px inputs, 8–10px cards).
- **Spec correction (binding):** `AgentMark` renders monochrome vendor glyphs in `currentColor`; there is **no per-agent color palette**. Rail nodes are therefore **monochrome** (ink). Human-vs-agent is carried by node **shape** (circle vs square); which agent is carried by the `AgentMark` glyph and the existing eyebrow. Do **not** color nodes per agent.
- **Motion: restrained & functional only.** Respect `prefers-reduced-motion` (pulses/rises become static). No decorative transitions.
- **Preserve invariants:** never print raw JSONL; block-based rendering (`●`/`○`/`⏺`) unchanged; immutability (new objects, no mutation); `AgentStream` props/contract unchanged.
- **Node ≥ 22.19.** Tests are compiled then run: `tsc -p packages/tsconfig.json` emits to `dist/`, run with `node --test dist/web/tests/*.test.js`. That tsconfig **excludes `web/src/components/**` and `web/src/app/**`** — anything imported by a test must live under `web/src/lib/` or `web/src/types.ts`.
- **Do not create git commits** unless the user has explicitly approved it for this work (user global rule). The "Commit" steps below are written for completeness; if commits are disallowed, complete the step's code/tests and skip only the `git commit` invocation.

---

### Task 1: `groupConversations` pure function (+ move `ConversationItem` to lib)

Partition the thread list into *Needs you → Running → Idle*. The type move makes the function testable (tests cannot import from `web/src/components/`).

**Files:**
- Modify: `web/src/lib/conversations.ts` (add `ConversationItem` type)
- Modify: `web/src/components/ConversationRow.tsx:10-16` (import + re-export the moved type)
- Create: `web/src/lib/conversationGroups.ts`
- Test: `web/tests/conversationGroups.test.ts`

**Interfaces:**
- Consumes: `RelaySession` (`web/src/types.ts`), `AgentName` (`web/src/types.ts`). `RelaySession["status"]` is `"running" | "waiting_for_human" | "completed" | "failed" | "cancelled"`.
- Produces:
  - `ConversationItem = { session: RelaySession; runningAgent?: AgentName }` (now exported from `web/src/lib/conversations.ts`, re-exported from `ConversationRow.tsx`).
  - `ConversationGroups = { needsYou: ConversationItem[]; running: ConversationItem[]; idle: ConversationItem[] }`
  - `groupConversations(items: readonly ConversationItem[]): ConversationGroups`

- [ ] **Step 1: Write the failing test**

Create `web/tests/conversationGroups.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupConversations } from "../src/lib/conversationGroups.js";
import type { ConversationItem } from "../src/lib/conversations.js";
import type { AgentName, RelaySession } from "../src/types.js";

function item(
  id: string,
  status: RelaySession["status"],
  runningAgent?: AgentName,
): ConversationItem {
  const session = {
    id,
    workspacePath: "/workspace",
    ownerEmployeeId: "alice",
    taskGoal: `goal ${id}`,
    participants: ["human", "claude"],
    status,
    phase: status,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    agentRuns: [],
    artifacts: [],
    decisions: [],
    events: [],
  } as unknown as RelaySession;
  return { session, runningAgent };
}

describe("groupConversations", () => {
  it("routes waiting_for_human to needsYou", () => {
    const { needsYou, running, idle } = groupConversations([item("a", "waiting_for_human")]);
    assert.deepEqual(needsYou.map((c) => c.session.id), ["a"]);
    assert.equal(running.length, 0);
    assert.equal(idle.length, 0);
  });

  it("routes running status to running", () => {
    const { running } = groupConversations([item("a", "running")]);
    assert.deepEqual(running.map((c) => c.session.id), ["a"]);
  });

  it("treats a live runningAgent as running even when status is not running", () => {
    const { running } = groupConversations([item("a", "completed", "claude")]);
    assert.deepEqual(running.map((c) => c.session.id), ["a"]);
  });

  it("routes completed/failed/cancelled to idle", () => {
    const { idle } = groupConversations([
      item("a", "completed"),
      item("b", "failed"),
      item("c", "cancelled"),
    ]);
    assert.deepEqual(idle.map((c) => c.session.id), ["a", "b", "c"]);
  });

  it("preserves input order within each group", () => {
    const { needsYou } = groupConversations([
      item("x", "waiting_for_human"),
      item("y", "running"),
      item("z", "waiting_for_human"),
    ]);
    assert.deepEqual(needsYou.map((c) => c.session.id), ["x", "z"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsc -p packages/tsconfig.json && node --test dist/web/tests/conversationGroups.test.js`
Expected: compile error / FAIL — `conversationGroups.js` and the lib `ConversationItem` export do not exist yet.

- [ ] **Step 3: Move `ConversationItem` into `conversations.ts`**

In `web/src/lib/conversations.ts`, change the first import line and add the type near the top (after the existing `import type { RelaySession }`):

```ts
import type { AgentName, RelaySession } from "../types.js";

// A conversation is one owner-scoped session. The row binds to the session
// itself (not an employee), so the logged-in employee can hold several in
// parallel and switch between them.
export type ConversationItem = {
  session: RelaySession;
  /** Agent of an in-flight run for this conversation, if any. */
  runningAgent?: AgentName;
};
```

- [ ] **Step 4: Re-export the type from `ConversationRow.tsx`**

In `web/src/components/ConversationRow.tsx`, replace the local definition (lines ~4-16) so the type now comes from lib:

```tsx
import type { RelaySession } from "../types";
import { conversationLabel, type ConversationItem } from "../lib/conversations";

export type { ConversationItem };
```

(Delete the old inline `type ConversationItem = {...}` block and its separate `import type { AgentName, RelaySession }` line. `RelaySession` is still used by `ConversationRowProps`, so keep importing it. `AgentName` is no longer referenced here.)

- [ ] **Step 5: Write `groupConversations`**

Create `web/src/lib/conversationGroups.ts`:

```ts
import type { ConversationItem } from "./conversations.js";

export type ConversationGroups = {
  needsYou: ConversationItem[];
  running: ConversationItem[];
  idle: ConversationItem[];
};

// Partition owner-scoped conversations by the signal that matters for agent
// work: which threads await a human decision (needsYou), which have a live
// agent (running), and which are settled (idle). A live run overrides a
// non-running status. Input order (newest-first) is preserved within groups.
export function groupConversations(
  items: readonly ConversationItem[],
): ConversationGroups {
  const needsYou: ConversationItem[] = [];
  const running: ConversationItem[] = [];
  const idle: ConversationItem[] = [];
  for (const item of items) {
    if (item.session.status === "waiting_for_human") {
      needsYou.push(item);
    } else if (item.session.status === "running" || item.runningAgent) {
      running.push(item);
    } else {
      idle.push(item);
    }
  }
  return { needsYou, running, idle };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx tsc -p packages/tsconfig.json && node --test dist/web/tests/conversationGroups.test.js`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/conversations.ts web/src/lib/conversationGroups.ts web/src/components/ConversationRow.tsx web/tests/conversationGroups.test.ts
git commit -m "feat: group conversations by needs-you/running/idle state"
```

---

### Task 2: ThreadPanel renders state-grouped sections

Render the three groups as labelled sections (mono label + count), Needs-you first. Empty sections are omitted.

**Files:**
- Modify: `web/src/components/ThreadPanel.tsx:65-81` (replace the flat `.conversation-list` map)
- Modify: `web/src/styles/thread.css` (add section-label styles)
- Modify: `web/src/i18n/locales/en/translation.json`, `web/src/i18n/locales/zh-CN/translation.json`, `web/src/i18n/locales/zh-TW/translation.json` (add `thread.group_*` keys)

**Interfaces:**
- Consumes: `groupConversations` (Task 1), `ConversationItem` (Task 1), existing `ConversationRow` props (`item`, `selected`, `onSelect`, `onRename`, `onClose`).
- Produces: no new exports (presentational).

- [ ] **Step 1: Add i18n keys**

In each locale's `"thread"` object add three keys. English (`web/src/i18n/locales/en/translation.json`):

```json
"group_needs_you": "Needs you",
"group_running": "Running",
"group_idle": "Idle",
```

zh-CN (`web/src/i18n/locales/zh-CN/translation.json`):

```json
"group_needs_you": "待处理",
"group_running": "运行中",
"group_idle": "空闲",
```

zh-TW (`web/src/i18n/locales/zh-TW/translation.json`):

```json
"group_needs_you": "待處理",
"group_running": "運行中",
"group_idle": "閒置",
```

(Place them inside the existing `"thread": { ... }` object; keep valid JSON — add a comma after the previous key.)

- [ ] **Step 2: Render grouped sections in ThreadPanel**

In `web/src/components/ThreadPanel.tsx`, add the import near the top:

```tsx
import { groupConversations } from "../lib/conversationGroups";
```

Replace the `<section className="conversation-list">…</section>` block (lines ~65-81) with a grouped renderer. First compute groups inside the component body (after `const { t } = useTranslation();`):

```tsx
  const groups = groupConversations(conversations);
  const sections = [
    { key: "needsYou", tone: "attn", label: t("thread.group_needs_you"), items: groups.needsYou },
    { key: "running", tone: "run", label: t("thread.group_running"), items: groups.running },
    { key: "idle", tone: "idle", label: t("thread.group_idle"), items: groups.idle },
  ] as const;
```

Then the list markup:

```tsx
      <section className="conversation-list" aria-label={t("nav.conversations")}>
        {sections.map((section) =>
          section.items.length > 0 ? (
            <div key={section.key} className="conversation-group" data-tone={section.tone}>
              <div className="conversation-group-label">
                <span>{section.label}</span>
                <span className="conversation-group-count mono">{section.items.length}</span>
              </div>
              {section.items.map((item) => (
                <ConversationRow
                  key={item.session.id}
                  item={item}
                  selected={selectedSessionId === item.session.id}
                  onSelect={onSelectConversation}
                  onRename={onRenameConversation}
                  onClose={onCloseConversation}
                />
              ))}
            </div>
          ) : null,
        )}
        {conversations.length === 0 ? (
          <p className="conversation-empty">
            {query.trim() ? t("thread.no_matches") : t("thread.no_conversations")}
          </p>
        ) : null}
      </section>
```

- [ ] **Step 3: Add section-label styles**

Append to `web/src/styles/thread.css`:

```css
/* ===================== state-grouped sections ===================== */
.conversation-group + .conversation-group {
  margin-top: var(--space-sm);
}

.conversation-group-label {
  display: flex;
  align-items: baseline;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-base) var(--space-xxs);
  font: var(--type-meta-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-muted);
}

/* Needs-you earns the one warning hue — it is the only section that demands
   action. Running/idle stay muted (status color is carried by the row dot). */
.conversation-group[data-tone="attn"] .conversation-group-label {
  color: var(--color-accent-yellow, var(--color-semantic-down));
}

.conversation-group-count {
  color: var(--color-muted-soft);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: Build the web app to verify it compiles & renders**

Run: `npm run build -w web`
Expected: build succeeds with no type errors.

- [ ] **Step 5: Manual visual check**

Run: `make web`, open the app, confirm the conversation list shows up to three labelled sections (Needs you / Running / Idle), empty sections are hidden, and selecting/searching still works.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ThreadPanel.tsx web/src/styles/thread.css web/src/i18n/locales/en/translation.json web/src/i18n/locales/zh-CN/translation.json web/src/i18n/locales/zh-TW/translation.json
git commit -m "feat: render conversation list in state-grouped sections"
```

---

### Task 3: Message rail + nodes (on-rail user, agent square glyph)

Turn the transcript into the continuous rail: every `.msg` hangs off a left-gutter spine via a node. User turns become an on-rail **circular** ink node (no bubble); agent turns get a **square** node carrying the `AgentMark` glyph.

**Files:**
- Modify: `web/src/components/MessageBlock.tsx:134-194` (user + agent + system branches)
- Modify: `web/src/styles/chat.css` (rail/node/type tiers; retire `.msg-user` bubble rules at lines ~324-362)

**Interfaces:**
- Consumes: `DerivedMessage` (`web/src/lib/projectMessages.ts`), `AgentMark` (`web/src/components/AgentMark.tsx`), `AgentStream` (unchanged), `t("message.user_label")` (existing key → uppercased to "YOU" via CSS).
- Produces: no new exports.

- [ ] **Step 1: Restructure the user branch**

In `web/src/components/MessageBlock.tsx`, replace the `message.kind === "user"` block (lines ~140-149) with:

```tsx
  if (message.kind === "user") {
    return (
      <article className="msg msg-user" aria-label={t("message.user_label")}>
        <span className="rail-node rail-node-user" aria-hidden="true" />
        <div className="turn-body">
          <header>
            <span className="turn-who" translate="no">{t("message.user_label")}</span>
            <time className="mono">{formatTime(message.timestamp)}</time>
          </header>
          <p className="user-text">{message.text}</p>
        </div>
      </article>
    );
  }
```

- [ ] **Step 2: Restructure the agent branch**

Replace the `message.kind === "agent"` block (lines ~151-181) with a square node + body wrapper. Keep `AgentStream` and the attachment list exactly as-is:

```tsx
  if (message.kind === "agent") {
    return (
      <article
        className={`msg msg-agent ${message.streaming ? "streaming" : ""} ${grouped ? "grouped" : ""}`}
      >
        <span className="rail-node rail-node-agent" aria-hidden="true">
          <AgentMark agent={message.agent} size={12} />
        </span>
        <div className="turn-body">
          <header>
            <span className="agent-title" translate="no">
              {message.agent}
              <span className="agent-mode" data-mode={message.mode}>{message.mode}</span>
            </span>
            <time className="mono">{formatTime(message.timestamp)}</time>
          </header>
          <AgentStream
            agent={message.agent}
            stdout={message.stdout}
            stderr={message.stderr}
            streaming={message.streaming}
          />
          {message.attachments.length > 0 ? (
            <div className="attachment-list">
              {message.attachments.map((artifact) => (
                <ArtifactCard key={artifact.id} artifact={artifact} sessionId={sessionId} />
              ))}
            </div>
          ) : null}
        </div>
      </article>
    );
  }
```

(The eyebrow's inline `AgentMark` is removed — the glyph now lives in the rail node. The agent name + mode stay in the eyebrow.)

- [ ] **Step 3: Align the system branch to the rail gutter**

Replace the final `return (...)` system block (lines ~183-193) so it clears the gutter (no node):

```tsx
  return (
    <div className={`msg msg-system tone-${message.tone}`}>
      <div className="turn-body">
        <span className="msg-system-label">
          <span>{message.label}</span>
        </span>
        {message.detail ? (
          <span className="msg-system-detail">{message.detail}</span>
        ) : null}
        <time className="mono">{formatTime(message.timestamp)}</time>
      </div>
    </div>
  );
```

- [ ] **Step 4: Add the rail + node CSS and retire the user bubble**

In `web/src/styles/chat.css`:

(a) Replace the `.msg` rule (lines ~225-229) and add the rail spine + gutter:

```css
.msg {
  position: relative;
  padding-left: 30px;
  animation: message-in var(--duration-base) ease-out both;
}

/* The continuous spine: each turn draws the gutter line through its own box
   and into the gap below, so consecutive turns read as one unbroken rail.
   Flat hairline — depth comes from the rail + type, never a shadow. */
.msg::before {
  content: "";
  position: absolute;
  left: 6px;
  top: 0;
  bottom: calc(var(--space-md) * -1);
  width: 1.5px;
  background: var(--color-hairline);
}

.transcript-inner > .msg:last-child::before {
  bottom: 0;
}

@media (prefers-reduced-motion: reduce) {
  .msg { animation: none; }
}
```

(b) Add the node styles (place near the `.msg` rules):

```css
.rail-node {
  position: absolute;
  left: 0;
  top: 2px;
  display: grid;
  place-items: center;
  width: 13px;
  height: 13px;
  color: var(--color-ink);
  background: var(--color-canvas);
  /* Agents are squares; the human is a circle (overridden below). Monochrome
     only — agent identity is the glyph inside, never color. */
  border-radius: var(--radius-xs, 3px);
  animation: node-in 120ms ease-out both;
}

.rail-node-agent > svg { display: block; }

.rail-node-user {
  background: var(--color-ink);
  border-radius: var(--radius-full);
  width: 11px;
  height: 11px;
  top: 3px;
  left: 1px;
}

@keyframes node-in {
  from { transform: scale(0.4); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .rail-node { animation: none; }
}
```

(c) Wrap content in `.turn-body` consistently — the grid/gap that used to live on `.bubble` now lives on `.turn-body`. Replace the `.bubble` rules (lines ~252-255) with:

```css
.turn-body {
  display: grid;
  gap: var(--space-xs);
}
```

(d) Update the grouped-continuation rules (lines ~243-250) to target `.turn-body`:

```css
.msg-agent.grouped .turn-body > header {
  display: none;
}

.msg-agent + .msg-agent.grouped {
  margin-top: calc(var(--space-sm) - var(--space-md));
}
```

(e) **Retire** the right-aligned user bubble. Delete the `.msg-user` grid rule and `.msg-user .bubble` / `.msg-user p` bubble fill (lines ~329-354) and replace with the on-rail treatment:

```css
/* User voice — on the rail, not a bubble. The circular node + mono "YOU"
   eyebrow carry attribution; the text is plain ink, medium weight, so the
   human instruction reads as a peer turn in the same thread as the agents. */
.msg-user .turn-who {
  font: var(--type-meta-mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-ink);
}

.msg-user .user-text {
  margin: 0;
  color: var(--color-ink);
  font-size: var(--text-base);
  font-weight: 500;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
```

(Keep `.msg header`, `.agent-title`, `.agent-mode`, timestamp, and `.msg-quiet` streaming-caret rules as they are — they still apply inside `.turn-body`. If any selector referenced `.bubble > header`, retarget it to `.turn-body > header`.)

- [ ] **Step 5: Build to verify it compiles**

Run: `npm run build -w web`
Expected: build succeeds, no type errors.

- [ ] **Step 6: Run the existing TS suite (no regressions)**

Run: `npm run test:ts`
Expected: PASS — including `web/tests/messageBlock.test.ts` (projection logic unchanged) and `web/tests/agentStream.test.ts` (no raw JSONL).

- [ ] **Step 7: Manual visual check**

Run: `make web`. Confirm: a continuous rail runs down the transcript; user turns show a filled circular node + "YOU" eyebrow + plain text (no bubble, not right-aligned); agent turns show a square node with the vendor glyph; grouped same-agent turns drop the eyebrow and the rail stays unbroken; review turns keep the info-blue mode dot; streaming caret still animates.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/MessageBlock.tsx web/src/styles/chat.css
git commit -m "feat: thread the conversation on a continuous rail with on-rail user voice"
```

---

### Task 4: Align composer to the rail column + final verification

Restyle-only: make the composer/decision bar sit flush with the transcript's rail column so the input reads as the next turn on the thread. No behavior change.

**Files:**
- Modify: `web/src/styles/composer.css` (align inner max-width / padding to the transcript column)
- Reference (no change): `web/src/components/composer/Composer.tsx`, `web/src/components/composer/DecisionBar.tsx`

**Interfaces:**
- Consumes: existing composer markup/classes. Produces: nothing new.

- [ ] **Step 1: Inspect the current composer column**

Run: `grep -n "max-width\|width: min\|padding\|composer-inner\|composer-shell" web/src/styles/composer.css`
Goal: find the composer's inner wrapper width rule so it can match `.transcript-inner` (`width: min(100%, 960px); margin: 0 auto;` with `--space-lg` side padding).

- [ ] **Step 2: Match the composer inner width to the transcript**

In `web/src/styles/composer.css`, set the composer's inner container to the same column as `.transcript-inner` so the input lines up under the rail. Apply to the composer's inner wrapper selector found in Step 1 (e.g. `.composer-inner`):

```css
.composer-inner {
  width: min(100%, 960px);
  margin: 0 auto;
  padding-inline: var(--space-lg);
}
```

(Adjust the selector name to whatever Step 1 reveals; keep any existing vertical padding. Do not change layout behavior, focus handling, or the mode toggle / mention popover.)

- [ ] **Step 3: Build**

Run: `npm run build -w web`
Expected: build succeeds.

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: PASS — TS suite (`test:ts`) and Python suite (`test:py`) both green. No web behavior changed; this guards against accidental regressions.

- [ ] **Step 5: Manual visual check**

Run: `make web`. Confirm the composer/decision bar align under the transcript rail column at desktop and narrow widths, and that sending a message, mode toggle, `@mentions`, and the decision bar all still work.

- [ ] **Step 6: Commit**

```bash
git add web/src/styles/composer.css
git commit -m "style: align composer to the conversation rail column"
```

---

## Self-Review

**Spec coverage:**
- Rail core device → Task 3 (rail spine, nodes, square/circle). ✓
- Full-stream-always (no collapse) → preserved by leaving `AgentStream` untouched; nothing in the plan adds collapse. ✓
- Turn anatomy / type tiers → existing `agent-stream.css` tiers retained; eyebrow/mode/review-dot kept in Task 3. ✓
- Human voice on-rail node → Task 3 Steps 1, 4(e). ✓
- Thread list grouped by state → Tasks 1 + 2. ✓
- Motion spec (turn-in, node scale-in, pulse; reduced-motion) → Task 3 CSS + reduced-motion guards. Running-row pulse already exists via `.has-activity`/existing dot styles (untouched). ✓
- Components touched list / out-of-scope → matches Tasks 1-4; backend/TUI/AgentStream untouched. ✓
- Testing: `groupConversations` unit test (Task 1); existing `messageBlock`/`agentStream` stay green (Task 3 Step 6). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Task 4 Step 2 selector is parameterized on a `grep` result by necessity (composer inner class name verified at execution) — Step 1 resolves it before code is written. Acceptable and explicit.

**Type consistency:** `ConversationItem` defined once in `conversations.ts`, re-exported from `ConversationRow.tsx`, consumed by `groupConversations` and `ThreadPanel`. `ConversationGroups` keys (`needsYou`/`running`/`idle`) used identically in Task 2. `groupConversations` signature matches call site in `ThreadPanel`. ✓

**Spec correction applied:** Rail nodes are monochrome (not per-agent color) to honor the status-only-color invariant — documented in Global Constraints and Task 3.
