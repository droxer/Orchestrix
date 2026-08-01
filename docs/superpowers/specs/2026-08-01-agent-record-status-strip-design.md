# Agent record surfaces — status strip & hierarchy cleanup

Date: 2026-08-01
Status: approved (pending implementation)
Scope: `web/src/components/AgentWorkspacePage.tsx`, `AgentProfilePanel.tsx` (workspace variant), `AgentPersonalityEditor.tsx`, `AgentPlacementBadge.tsx`, `workspace/WorkspacePrimitives.tsx`, `web/src/styles/workspace.css`, `web/src/i18n/locales/*/translation.json`

## Context

The agent record page (`/agents/<id>`, tabs Profile / Workspace / Activities) is built on the Phosphor identity (grey-until-working, one `--live` accent, JetBrains Mono, tokens sourced only from `palette.css`). This spec does not touch that identity — no new colors, type, or spacing tokens. It is a hierarchy and duplication cleanup within it.

Evidence gathered by screenshotting the current (pre-existing, uncommitted) implementation at 1440px, light+dark, via a mocked backend:

1. **Redundant tab label.** The Profile tab's header subtitle renders the i18n string `workspace.profile_sub`, whose English value is literally `"Profile"` — placed directly above a tab strip where "Profile" is already the selected tab's label. Pure duplication, no added information.
2. **Agent status is drawn four different ways on one page:**
   - Header facts block: a placement badge showing node name + `OWNERSHIP PENDING` / `RUNTIME PENDING` (a two-line stack, misaligned against the adjacent refresh button).
   - Profile hero: a dot + the word "Ready" (`agentAvailabilityTone` / `admin.v2.placement_status.*`).
   - Personality card: a pip + the word **"Ready"** next to "Personality" — this is `agents_page.personality_defined`, which describes whether the agent has a *custom personality written*, not runtime availability. It happens to share the exact English string "Ready" with the real availability status, so it reads as a duplicate/contradiction of the header and hero (e.g. header can say "pending" while the personality card says "Ready").
   - Activities tab: a `workspace-status-pill` showing the same availability again, stranded at the far right of the metric strip with a large empty gap before it.
3. **Profile tab wastes ~50% of the canvas.** `.workspace-profile-panel` is capped at `max-width: 640px` and centered, on a page that is otherwise full-bleed (Workspace's file browser, Activities' rows). At 1440px this leaves roughly half the viewport empty.
4. **Placement badge legibility.** `AgentPlacementBadge` renders a status dot (`agent-placement-badge-dot`) immediately next to an ownership icon (`NodeManaged`/`NodeLocal`/`NodePending`, 13px) — at that size and spacing they read as two adjacent status dots ("● ○") rather than a dot + a meaningful glyph.

## Goals

- One place on the page shows agent status (runtime, placement/node, availability) — not four.
- No i18n string reused across two different meanings ("Ready" for availability vs. "has custom personality").
- No redundant chrome (the repeated tab-name label).
- Profile tab content uses the same full-bleed width discipline as Workspace and Activities.

## Non-goals

- No new persistent sidebar/rail across tabs (considered, rejected — bigger structural change than this cleanup calls for, and interacts with the `container-type: inline-size` sizing already in place on `.workspace-profile`).
- No changes to Workspace tab (files browser) — it already behaves correctly (full-width rows, live/snapshot chip).
- No token, color, or typography changes. Still Phosphor.
- No changes to the admin-drawer variant of `AgentProfilePanel` (`variant="admin"`) beyond the personality-copy rename, which it inherits for free since both variants share `AgentPersonalityEditor`.

## Design

### 1. Header: delete the redundant subtitle

`AgentWorkspacePage` currently sets `headerSubtitle = pageTab === "profile" ? t("workspace.profile_sub", ...) : null`. Remove this entirely — `PageHeader` renders kicker → title (with monogram) → tab strip, with nothing else. `workspace.profile_sub` becomes unused and is deleted from all three locale files (confirmed single caller; `TeamWorkspacePage` uses the separate key `teams.profile_sub`, untouched).

### 2. Header: single-row status strip

Replace the current two-line `workspace-header-facts` stack (runtime chip on its own row, placement badge + ownership/runtime-pending text on a second row) with one horizontal strip, vertically centered against the refresh button, in this order:

`[agent glyph] Claude   [placement badge: node · ownership · sandbox]   [● Ready]`

- Runtime and placement badge keep their existing components/data (`AgentMark`, `AgentPlacementBadge` via `describeAgentPlacements`) — this is a layout change, not a data change.
- Availability becomes a single dot+word pair (reusing the existing `workspace-status-pill`/`tone-*` pattern already defined in `workspace.css`), appended once to this strip.
- This strip lives in `PageHeader`'s `actions`, so it is tab-independent (visible on all three tabs without being redeclared inside tab bodies) — matching how it already works today, just consolidated to one row.

### 3. Delete the now-duplicate availability displays

- **Profile hero** (`workspace-dossier-meta` in `AgentProfilePanel.tsx`, workspace variant): remove the `workspace-dossier-availability` dot+word line. Keep `@{agent.employeeId}` — that's identity, not status.
- **Activities metric strip** (`WorkspaceActivities` in `WorkspacePrimitives.tsx`): remove the `workspace-metric-item--status` cell and the `statusPill` prop plumbing (`AgentWorkspacePage.tsx` passes it in, `TeamWorkspacePage.tsx` likely has its own equivalent — confirm at implementation time whether the prop is shared or agent-specific before removing it from the shared primitive vs. just the agent caller). The strip becomes three cells: Active Runs / Active Tasks / Threads.

### 4. Rename the personality-state copy

`agents_page.personality_defined` changes from `"Ready"` to a word that cannot be read as a runtime/availability status — `"Custom"` (paired with the existing `personality_default` = `"Default"`). Update all three locales (en/zh-CN/zh-TW). This is copy-only; the component logic (`hasCustomPersonality` boolean, tone classes) is unchanged.

### 5. Placement badge legibility

Increase the visual separation between `agent-placement-badge-dot` (status) and the ownership icon in `AgentPlacementBadge` — e.g. slightly larger icon size or added gap — so the two no longer read as a doubled dot at small sizes. Exact values decided at implementation time against a real rendered instance (per the project's own guidance: verify computed/visual output on a real element, not just the rule).

### 6. Profile tab: full-bleed width

`.workspace-profile-panel` (workspace variant) drops its `max-width: 640px; margin: 0 auto` centering. The panel takes the full width of `.workspace-profile` (matching Workspace/Activities), with prose inside `AgentPersonalityEditor`'s document/editor views keeping their own readable measure (already the case — `.agent-personality-document`/textarea don't currently rely on the outer card being narrow). Padding/border treatment of the outer card stays as-is; only the width constraint changes.

### 7. Activities metric strip

No structural change beyond removing the status cell (item 3) — once the trailing pill is gone, the strip is three even cells with no orphaned element across a gap. No new stretching/redistribution logic needed.

## Testing / risk notes

- `web/tests/faceUtilities.test.ts` pins some literal JSX snippets by regex — check it doesn't reference the specific header-facts markup or the personality-state span being removed/changed.
- `web/tests/monochromeTokens.test.ts` asserts `--live` is only used with `data-shape="live"` and pins some now-deleted-elsewhere status chip contracts — confirm the consolidated status strip still satisfies it (it reuses `workspace-status-pill`, not a new element).
- `designGrid.test.ts` requires breakpoints to be registered — this change doesn't add new breakpoints, so should be a no-op there.
- Locale files: `en`, `zh-CN`, `zh-TW` all need the `personality_defined` copy change and the `profile_sub` key removal kept in sync (three-file edits, easy to miss one).
- `TeamWorkspacePage.tsx` shares `WorkspacePrimitives.tsx` (`WorkspaceActivities`, `MetricItem`) — verify whether it passes its own `statusPill` and whether removing the cell from the shared component affects it identically (teams may want the same fix, but that page is out of this spec's explicit scope; at minimum it must not break).
