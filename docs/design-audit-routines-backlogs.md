# Design Audit — Web UI (Routine & Backlog focus)

Scope: `web/src` pages and components, with emphasis on the **Backlog**
(`BacklogPage.tsx` + `backlog.css`) and **Routine** (`RoutinePage.tsx`,
shares `backlog.css`) screens. Measured against the token system and
design language documented in `web/src/styles/tokens.css` (Linear/Vercel
precision lineage: monochrome ink as the only action color, color reserved
for status, mono as the identity signal, no pill geometry).

Severity legend: **P1** ship-blocker / correctness · **P2** notable polish
or consistency gap · **P3** nice-to-have.

---

## 1. Accessibility (highest priority)

### 1.1 — Drawers are modal in name only · **P1**
`BacklogTaskDrawer` and `RoutineDrawer` declare `role="dialog"
aria-modal="true"` (`BacklogPage.tsx:330`, `RoutinePage.tsx:257`) but
provide none of the modal contract:
- No **Escape-to-close** handler.
- No **focus trap** — Tab escapes the drawer into the board behind the scrim.
- No **autofocus** on the first field when the drawer opens.
- No **return-focus** to the trigger button on close.

The only dismissal path is clicking the scrim. For an `aria-modal` dialog
this fails keyboard and screen-reader users. Fix once in a shared
`<Drawer>` primitive (one already exists at
`components/admin/Drawer.tsx` — reuse it rather than maintaining a third
hand-rolled drawer).

### 1.2 — Yellow status text fails contrast · **P1**
`--color-accent-yellow` (`#f5a623`) on the white canvas is ~1.9:1 — below
the WCAG AA floor (4.5:1 body, 3:1 large). It is used as foreground text in
several spots:
- `.backlog-due.warn` — due-today date, 12px mono (`backlog.css:319`).
- `.backlog-stat-value.tone-overdue` — the "Overdue"/"Due" KPI number
  (`backlog.css:70`), used by both Backlog (`metric_overdue`) and Routine
  (`metric_due`).

The token comment even says yellow is an "attention dot only, not an action
color." It is currently doing duty as readable text. Either render these as
a dot + neutral-ink label, or darken to a text-safe amber for foreground use
(keep the bright value for dots).

---

## 2. Backlog page

### 2.1 — Seven-lane board forces near-permanent horizontal scroll · **P2**
`TASK_STATUSES` has 7 lanes (`lib/backlog.ts:3`) at `--backlog-lane-w: 272px`
→ ~1904px of board. After the 64px sidenav, a 1440px display shows ~5 lanes;
laptops show 4. The most actionable column (`done`) is always off-screen.
Options: collapse terminal lanes (`done`/`blocked`) into a count chip that
expands on demand, allow lanes to flex narrower, or offer a compact density.

### 2.2 — Hover-reveal actions hurt discoverability · **P2**
`.backlog-task-actions` start at `opacity: 0` and only appear on
`:hover`/`:focus-within` (`backlog.css:330-339`). Touch is handled (forced
visible <820px) but on desktop a mouse user can't tell a card is actionable
until they hover it, and the cards reflow when actions appear
(`transform: translateY`). Consider a persistent low-emphasis affordance
(e.g. an always-visible kebab) so the primary action isn't fully hidden.

### 2.3 — Empty-state vocabulary is inconsistent · **P2**
`BacklogEmptyBoard` ships a custom SVG + heading + CTA
(`BacklogPage.tsx:201`), the per-lane empty is a dashed one-liner
(`.backlog-empty`), and **Routine's** empty state (below) has no
illustration at all. Three different "nothing here" treatments across two
sibling screens. Standardize on one empty-state component.

### 2.4 — Overdue tone splits between yellow and red · **P3**
The KPI "Overdue" number is yellow (`tone-overdue`), but the same overdue
date on a card renders red (`.backlog-due.bad`, `--color-semantic-down`).
Pick one semantic for "overdue" and apply it in both places (red reads as
the stronger, more conventional choice; reserve yellow for "due today").

---

## 3. Routine page

### 3.1 — `task`-flavored copy leaks into the Routine drawer · **P2**
The new-routine drawer subtitle renders `t("backlog.new_task_id")`
(`RoutinePage.tsx:263`) — "task" wording inside a Routine surface. More
broadly, Routine borrows a large set of `backlog.*` keys for its own chrome
(`hide_filters`, `clear_filters`, `agent`, `all_agents`, `assignee_filter`,
`ready`/`not_ready`, every action label and toast). That's pragmatic reuse,
but it means Routine cannot diverge its language without surprise edits to
Backlog. Either promote the shared strings to a `common.*` namespace or give
Routine its own keys; don't reach across to `backlog.*`.

### 3.2 — Empty state has no illustration · **P2**
Routine reuses `.backlog-board-empty` but omits the SVG that Backlog ships
(`RoutinePage.tsx:431-443`), so the two screens' empty states look unrelated.
See 2.3 — fold into one component.

### 3.3 — Card badge row is overloaded · **P2**
`RoutineCard` renders up to **five** badges — enabled, type, cadence,
priority, agent (`RoutinePage.tsx:184-196`) — which wraps to two rows on a
320px card and competes with the title for attention. Demote the always-on
descriptors (type, cadence) to the meta line and keep badges for state that
actually varies the card's urgency (enabled / due / agent-readiness).

### 3.4 — Decorative grid doesn't align to content · **P3**
`.routine-page` layers a 28px vertical hairline grid
(`backlog.css:649-654`) behind a card grid whose columns are
`minmax(320px, 1fr)`. The texture lines never coincide with card edges, so
the background reads as noise rather than structure. Either drop it or snap
the card track to the same module.

### 3.5 — `routine-toggle` fakes its alignment · **P3**
The "Enabled" checkbox sits in the form grid styled like the `<select>`
fields but is a different control; it relies on `min-height: 66px` +
`align-self: end` to line its baseline up with neighbors
(`backlog.css:671-682`). Brittle. Pull the toggle out of the field grid into
its own row, or use a proper switch component.

---

## 4. Cross-page consistency

### 4.1 — Page header is copy-pasted, not shared · **P2**
The header block (`min-h-[var(--header-h)]`, title + mono count + refresh +
new) is duplicated verbatim between `BacklogPage.tsx:504-526` and
`RoutinePage.tsx:412-426`, and MCP/Skills use yet another header idiom. Extract
a single `<PageHeader title count action>` so the header height, spacing, and
typography can't drift per route.

### 4.2 — Two implementations of the same primary button · **P2**
Routine's "New" button is the shadcn `<Button className="backlog-primary">`
(`RoutinePage.tsx:421`); Backlog's is a raw `<button
className="backlog-primary">` (`BacklogPage.tsx:521`). They look alike only
because `.backlog-primary` re-declares the fill — and on the `<Button>` path
it now double-applies background rules with the component's own
`data-variant` styling. Pick one (the shadcn `<Button>`) and delete the raw
variant.

### 4.3 — Focus treatment bypasses the focus-ring token · **P3**
`.backlog-filter-primary:focus-within` uses a hard `outline: 2px solid
var(--color-primary)` (`backlog.css:88`) while the system ships a canonical
`--ring-focus` (3px primary-alpha halo) used everywhere else. The filter bar
should consume the token so focus styling stays uniform.

### 4.4 — Filter chrome is mono, form chrome is sans · **P3**
Within these pages, filter selects/inputs use `--type-meta-mono`
(`backlog.css:122`) while the drawer's fields use `--type-body-sm`
(`backlog.css:468`). This is defensible ("filters are data chrome") but it's
undocumented and reads as accidental. Note the rule in the page CSS header or
unify.

---

## 5. Logic touching the UI (design-adjacent)

### 5.1 — Due/overdue computed in UTC, displayed locally · **P2**
`isoToday()` derives "today" from `toISOString().slice(0, 10)`
(`lib/backlog.ts:60`, `lib/routine.ts:57`), i.e. the UTC date. For users west
of UTC in the evening (or east in the early morning) a task can show as
overdue / due-today a day early or late versus the date the user typed. Use a
local-date formatter for the comparison key.

---

## 6. What's working well

- **Token discipline** is strong — lanes, tones, spacing, and radii pull from
  the variable system rather than magic numbers; the monochrome-action /
  color-for-status rule is honored on these screens.
- **Reduced-motion** is respected on the Backlog drawer and cards
  (`backlog.css:635-643`).
- **Priority encoding** (left border + badge) and **mono tabular numerals**
  on KPI tiles fit the precision language cleanly.
- **Responsive shell** correctly collapses to a 2-column grid for both routes
  on desktop and to a single column <820px (`mcp.css`, `skills.css`).

---

## Suggested order of work

1. **P1** — drawer modal a11y (1.1) and yellow-text contrast (1.2).
2. **P2** — shared `PageHeader` + single primary button (4.1, 4.2), one
   empty-state component (2.3 / 3.2), Routine i18n namespace (3.1), UTC date
   bug (5.1).
3. **P3** — focus token (4.3), badge/decoration trims (3.3–3.5, 2.1, 2.2),
   overdue tone alignment (2.4).
