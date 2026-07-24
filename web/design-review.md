# Frontend Visual Design & Cues Review — Relay `web/`

Date: 2026-07-24
Scope: entire `web/` frontend — all components, stylesheets, and status-cue logic.
Method: 5 parallel review passes (shell/tokens, chat, status cues/badges, admin/board, overlays/forms/artifacts) against the Vercel Web Interface Guidelines plus visual-design consistency checks.

## Executive summary

The design system is unusually disciplined (token architecture, reduced-motion coverage, a11y patterns mostly strong). The core problem: **the status-cue vocabulary has collapsed** — the achromatic palette cannot carry the meaning the UI asks of it, and workarounds are fracturing the cue grammar.

### Recommended fix order

1. **Repair the status vocabulary** — introduce hue or at minimum a shape/weight differentiator per tone; make `--warn` ≠ `--info`; fix `--err` in dark mode. Everything else is downstream of this.
2. **Unify status→tone mapping** into one typed function (kill the stringly-typed `statusTone(value: string)`); reconcile readiness vs availability vocabularies.
3. **Add text/icon equivalents** to color-only pips (AgentStateBadge, AgentPlacementBadge).
4. **Harden the focus-ring contract** (higher specificity or dual box-shadow+outline, forced-colors fallback).
5. Close async pending-state gaps (DecisionBar, composer send, task start) and add `role="log"` transcript announcements.

---

## 1. System-level: the monochrome palette can't express status

- `web/src/styles/tokens/palette.css:39` — `--err` (dark) = `#f2f4f6`, **identical to `--ink-1`** and `--action` white. Error text indistinguishable from headings; error fills indistinguishable from primary buttons.
- `web/src/styles/tokens/palette.css:37-38` — `--ok`/`--warn` are `--ink-4`/`--ink-3` brightness tiers; **`--warn` byte-identical to `--info`** (both `--ink-3`) in both themes. Warn vs info literally indistinguishable; good vs warn differ by ~15% lightness.
- `web/src/styles/tokens/palette.css:138-140` — same collision in the light register (`--err` light = `--ink-1`).
- Brightness order inverts between light/dark themes — same tone reads differently per theme.

### Workarounds already fracturing the cue grammar

- `web/src/components/StatusPill.tsx:54` — `bad` renders a *hollow ring* instead of the filled dot every other tone uses (to survive `--err` == white). "Bad" is the only status encoded by shape.
- `web/src/components/EmployeeAvatar.tsx` (`inputs.css:116`) — a *third* variant: filled `--err` dot for the same tone.
- `web/src/components/PriorityBadge.tsx:15` — high priority reuses `--err` for text+border (`backlog.css:427-431`); rank reads as failure.

---

## 2. Status-cue mapping inconsistencies

Three parallel, unreconciled vocabularies for agent/node health (readiness, availability, conversation status), mapped differently per caller:

- `busy/pending` → `tone-warn` in `AgentStateBadge.tsx:36` + `TaskDrawer.tsx:47`, but `tone-info` in `StatusPill.tsx:9`, `adminHelpers.ts:98`, `agentPlacements.ts:11`. (And warn == info visually, per §1.)
- `cancelled` → styled `bad` in StatusPill, but **unstyled** (muted `--ink-4` fallback) in `TaskStatusBadge.tsx:14` / `backlog.css:484-490`.
- `readiness` states `disabled`/`unknown` (`agentReadiness.ts:4`) have **no visual mapping** — `agentStatusTone` (`adminHelpers.ts:104`) collapses both to `neutral`.
- `conversationStatus.ts:9` — returns untyped `string`; `StatusPill.tsx:7` consumes it blindly; `"stale"`/`"provisioning"` have no explicit tone mapping (both → warn), so stale node and provisioning sandbox look identical.
- `conversationStatus.ts:11` — active run forces "running" even when `node.stale`; a stale-but-running node pulses like a healthy one.
- `TaskStatusBadge.tsx:14` — duplicates status→color logic in CSS `data-status` instead of sharing `statusTone`; `backlog.css:486-488` assigns/running/review all in `--info` hue family, distinguishable only by the running pulse (color-only).
- `AgentStateBadge.tsx:42` — boolean fallback maps not-ready → `tone-bad`, while tri-state maps busy → `tone-warn`; callers disagree on severity of "not ready".
- `TaskAssignee.tsx:87` — team readiness is boolean-only (good/bad); busy/pending collapse to red, inconsistent with the tri-state pip AgentStateBadge uses on the same card.

### Color-only cues with no text equivalent

- `AgentStateBadge.tsx:52` — state carried only by a 9px color pip on a non-focusable span; label solely in hover `title`. Keyboard/touch/SR users get no status.
- `AgentPlacementBadge.tsx:64` — placement status is a color-only aria-hidden dot; full status only in `title` tooltip on a non-focusable span.
- `AgentPlacementBadge.tsx:44` — `plain` form drops the status dot entirely; roster rows carry zero visible status signal (tooltip-only).
- `AgentPlacementBadge.tsx:64` — busy maps to `tone-info` whose token is byte-identical to `--warn` — busy vs pending dots indistinguishable.
- `EmployeeAvatar.tsx:29` — unconditionally `aria-hidden`; when avatar is sole identity (no adjacent name), SR users get nothing even though initials are meaningful.
- `EmployeeAvatar.tsx:23` — `running` state is visual-only (pip + pulse, `inputs.css:121-141`); no accessible state exposed.

---

## 3. Chat / transcript cues

- `ChatHeader.tsx:51` — "completed"/good activity nulled out; header shows running/warn/failed but never "done". Settled state only inferable from absence of badge.
- `web/src/lib/agentStream.ts:50` — `displayAgentSegments` drops tool/command segments the instant streaming flips false; a settled run's transcript loses the tool log entirely.
- `MainChatView.tsx:153` — transcript div has no `role="log"`/`aria-live`; streamed agent output invisible to screen readers.
- `AgentStream.tsx:21` — `aria-live="polite"` on StreamActivity only covers the "Working…" label; streamed deltas and new status/narration lines never announced.
- `MainChatView.tsx:205` — DecisionBar mounts when `awaitingDecision` flips true with no announcement (no aria-live/role="status"/focus move).
- `CollaborationTree.tsx:32` — status text inside `<summary>` only announced on toggle; active status changes not in any live region.

### Async actions with no pending affordance (double-submit possible)

- `DecisionBar.tsx:36` — approve/rerun/mark_done/handoff-send fire async with no pending state; buttons never disable, no "…" label.
- `Composer.tsx:74` — after `onSend` fires there is no "sending…" interim state; button only disables on empty text.
- `BacklogPage.tsx:579` — `onStart` fires `startTaskMutation.mutate` with no pending guard; same for `onDiscuss` at :591.
- `RoutinePage.tsx:504` — `onStart` mutation has no in-flight guard.

### Lists / performance

- `MainChatView.tsx:157` — `displayMessages` mapped in full; no virtualization for >50 messages (`content-visibility` in `chat.css:296` is a mitigation, not windowing).
- `ThreadPanel.tsx:82` — full map of conversations, no virtualization.
- `AgentWorkspacePage.tsx:420` — artifact pick list has no virtualization/`content-visibility`; same for file list at :756.
- `AgentStream.tsx:59,87` — `key={i}` index keys on segments; mid-stream re-parses can shift indexes and remount DOM.
- `MessageTurnActions.tsx:38,57` — `agentMessagePlainText` re-parses full stdout/stderr twice per render, unmemoized; O(n) parse per turn row per render.

### Other chat findings

- `CollaborationTree.tsx:27` — `open={active || undefined}` re-applies open every render while active; user collapsing a running subagent gets re-opened on next stream tick.
- `ChatHeader.tsx:71` — token chip uses `--type-micro` sans without tabular-nums; compact token count jitters as it updates.
- `MessageBlock.tsx:86` — PlanCard loading state is just title at 0.6 opacity; no skeleton, spinner, or "…".
- `MessageBlock.tsx:26,49` — `document.documentElement.lang` read inside render; impure render.
- `ThreadPanel.tsx:14` — search filter query is React state only, not in URL.
- `ConversationRow.tsx:63` — `aria-pressed` on row select button; `aria-current`/`aria-selected` (listbox) fits better.
- `AgentSelect.tsx:36,60` — busy pip is aria-hidden; availability of the *selected* agent never conveyed to screen readers.
- `agent-stream.css:413` — `.agent-status-warn` text is ink-3 (neutral); only the 13px icon carries warn color — weak distinction at a glance.
- `agent-stream.css:435` — streaming caret selectors cover p/heading/list/blockquote/pre but not bare trailing text nodes; caret can vanish on some block types.
- `thread.css:117` — `.conversation-row-inner` has no `:focus-visible` rule of its own.
- `thread.css:227` — rename/remove actions opacity-0 until hover; focus-visible reveals them but no focus-within on the row — tabbing to hidden action buttons is a blind jump.
- `handoff.css:13` — `.decision-bar button` / `.handoff-actions button` have no own `:focus-visible` rule.
- `chat.css`, `composer.css` — ✓ pass (strong: min-w-0 grids, tabular-nums timestamps, reduced-motion guards, focus rings, running hairline cue, send→stop swap, iOS 16px zoom guard).

---

## 4. Design-token drift

- `palette.css:93-95` — type scale gap: nothing between 15px (`--fs-4`) and 22px (`--fs-5`); forces off-scale hardcodes downstream.
- `palette.css:91` — `--fs-1` = 11px, below the 12px practical floor for uppercase micro labels.
- `roles.css:26` — `--type-heading` hardcodes `1.1429rem`, no matching `--fs-*` token.
- `roles.css:32` — `--type-number` hardcodes `1.3571rem` — same violation.
- `PageHeader.tsx:52` — non-display title uses arbitrary `text-lg font-semibold leading-[1.25]` instead of role tokens; originates an off-scale 22px/1.25 combo.

### Tailwind bridge flattens the design system

- `shadcn-bridge.css:72-74` — `text-xl/2xl/3xl` all collapse to `--fs-5` (22px); Tailwind heading utilities lose all size differentiation.
- `shadcn-bridge.css:48-51` — `rounded-lg`→`rounded-4xl` all map to `--r-3` (10px); larger radii utilities are no-ops.

### Duplicated sources of truth

- theme-color hexes in **3 places**: `layout.tsx:50-51`, inline script `layout.tsx:73`, `appStorage.ts:61-64`.
- `layout.tsx:49-52` — Next `viewport.themeColor` renders media-scoped metas while the inline script injects a second unmediated `theme-color` meta; order-dependent winner.
- Menu width: CSS 180px (`sidenav.css:223,274`) vs JS 188px (`SideNav.tsx:153`).
- sr-only clip pattern copy-pasted 4× (`sidenav.css:75-101,164-174,434-448`) — no shared utility.
- `appStorage.ts:91` — toggles `dark` class though `tailwind-bridge.css:7` keys dark variant off `data-theme` — dead/redundant class.

### Off-scale literals

- `sidenav.css:42` — `gap: 10px`; `:62-64` brand mark 36px; `:68` one-off box-shadow; `:181` `padding: 0 10px`; `:192` separator `width: 28px`; `:418-424` expanded row `height: 40px; padding: 0 10px`.
- `sidenav.css:240` — settings-menu buttons `min-height: 38px`, below 44px touch target, absent from a11y.css coarse-pointer bump list.
- `sidenav.css:405-414` — stagger delays mix hardcoded 30/55/80/105ms with `var(--t-fast)`.
- `responsive.css:101,119,258` — `gap: 2px`; `:229-230` bottom bar `min-height: 58px`, `padding: 4px`; `:276,281` tab `height: 50px; padding: 3px 2px`; `:291-292` active tick `20px/2px`; `:318-324` staggered delays 40–280ms hardcoded.
- `mobile-overlays.css:83,93-94,145-146,159,197` — hardcoded `44px` despite `--touch-target` token (`base.css:196`).
- `mobile-overlays.css:168,180` — popover `bottom: calc(58px + … + 7.5rem/8.5rem)` magic stacked offsets; brittle against composer height changes.
- `backlog.css:785` — hard-coded `160ms` transitions instead of `var(--t-fast)`.
- `App.tsx:368` — scroll-pin threshold `24` px magic number.

---

## 5. Focus-ring contract

- `tokens/base.css:101` — focus ring via `:where(...)` (0-specificity) box-shadow: any component `box-shadow` silently erases it; ring color == fill color on primary buttons (invisible); no `forced-colors` fallback (`a11y.css` has reduced-motion but no forced-colors support — box-shadow-only rings vanish in Windows High Contrast).
- `tokens/base.css:96` — global `button:active { transform: translateY(1px) }` clobbers any component-level transform on buttons (centering/offsets) — no opt-out.
- `inputs.css:30` — `.relay-search input` / `.adm-search-input` strips `outline: 0`; focus visible only via parent `:focus-within` ring; inner input has no ring if used standalone.
- `login.css:135` — input focus ring is border-color change only (1px), no shadow ring like `.dialog-input` — inconsistent focus affordance vs `dialog.css:96`.

---

## 6. Login

- `login.css:26` — `--lg-err` is white (`#f2f4f6`); the error banner (`:146`) is visually indistinguishable as an error except by border position.
- `LoginScreen.tsx:89` — submit button swaps label text when loading but has no spinner.
- `LoginScreen.tsx:62-69` — username input missing `autoCapitalize="none"` / `autoCorrect="off"`.
- `LoginScreen.tsx:83-87` — error is form-level `role="alert"` but not associated with fields (no `aria-invalid` / `aria-describedby`).
- ✓ labels wrap inputs, `name` + `autoComplete`, `spellCheck={false}` on username.

---

## 7. Admin console

### ChatIntegrationsView (weakest file)

- `ChatIntegrationsView.tsx:417` — `handleCreate` calls `setCredentials({})` + `setCreateOpen(false)` unconditionally after `mutate()`; `mutate()` swallows errors into state — a failed create still closes the drawer and wipes the form, error only visible behind it.
- `ChatIntegrationsView.tsx:735` — rotate webhook secret fires on a single click with no confirm; rotating invalidates the deployed webhook secret (destructive, unlike delete-link/delete-allow which confirm).
- `ChatIntegrationsView.tsx:191,697` — public-base-URL inputs missing `type="url"`.
- `ChatIntegrationsView.tsx:158` — provider `<select>` is uncontrolled (`defaultValue`) and its value never read; disabled Discord option makes it a dead control.
- `ChatIntegrationsView.tsx:269` — selected channel is local state, not URL state; channel detail not deep-linkable (rest of admin console is exemplary here).
- `ChatIntegrationsView.tsx:395` — create/update/identity validation errors all funnel to one global banner; no inline errors beside fields.
- `ChatIntegrationsView.tsx:561` — loading state is a bare text paragraph.

### Validation UX split

- `AddEmployeeDrawer.tsx` — ✓ pass (inline field errors + aria-describedby, focus-first-error, correct autocomplete incl. new-password, beforeunload guard, submit enabled until request starts).
- `AddNodeDrawer.tsx:75` — validation failures go to a global banner only; no inline field error, no focus moved to offending control.
- `AddNodeDrawer.tsx:147,154` — native sandbox `<select>` has no `name`; workspace `<input>` has no `name`/`autoComplete` (and no aria-invalid wiring).
- `AssignNodeDrawer.tsx:84` — validation errors banner-only; no inline error/focus on employee select, node list, or workspace path.
- `AssignNodeDrawer.tsx:344,351` — native sandbox select and workspace input lack `name`/`autoComplete`.
- `AgentProfilePanel.tsx:376` — rename/instruction save errors render at panel bottom (`role=alert`), not inline next to the failing field.

### Unsaved-changes coverage inconsistent

Guarded: Backlog/Routine drawers, AddEmployeeDrawer, ManageAgentsDrawer.
Unguarded (silent draft discard):

- `TeamDrawer.tsx:94` — Cancel/backdrop close discards name/members/lead edits.
- `TeamWorkspacePage.tsx:148` — inline profile edit cancel discards draft with no confirm.
- `AgentInstructionEditor.tsx:168` — Cancel (and Escape at :151) discards dirty personality draft despite `dirty` tracked.
- `AgentProfilePanel.tsx:87` — agent switch resets rename/instruction drafts silently.

### Other admin findings

- `AdminConsole.tsx:361` — auth-check loading state is text-only; no skeleton for shell/dashboard (KPIs fall back to bare "—").
- `AgentsPage.tsx:239` — roster loading is text-only; no skeleton rows.
- `ChannelsPage.tsx:14` — create-drawer open state is local `useState`, not URL-backed.
- `TeamDrawer.tsx:98` — team-name Input has no `name`/`autoComplete="off"`.
- `TaskDrawer.tsx:385` — title Input has `required` but no `autoComplete="off"`; browsers may offer personal autofill on a task title.
- `TaskBoardHeaderActions.tsx:26` — refresh icon button lacks `aria-busy` and the `spin` affordance that AdminConsole's identical button has (`AdminConsole.tsx:432-436`).
- `NodeCard.tsx:66` — copy-feedback `setTimeout` not cleared on unmount.
- `admin-v2-shell.css:116` — long fetch-error text truncates only inside the ≤640px block; desktop long `headerError` can overflow the header row.
- `BacklogPage.tsx:264` — hover-reveal card actions rely on CSS hover; keyboard (focus-within) and ≤820px fallbacks exist — acceptable, noted.
- ✓ pass: TeamsPage, FleetView, EmployeesView (except name truncation below), CredentialsDrawer, ManageAgentsDrawer, ManagedNodeHistory, NodeActions, NodePresence, NodeProfileBadges, NodeRow, AgentProfileDrawer, AdminLayoutToggle, AdminViewToggle, ExecutionProfileField, AuthScreens, all dashboard components (ActivityChart, ActivityFeed, DashboardView, FleetHealthCard, KpiTile, TokenUsageChart, TopEmployees), TaskDrawerArtifacts, WorkspacePrimitives, FiltersBar, PlacementList.

---

## 8. Overlays, forms, artifacts

### DialogProvider / Drawer

- `DialogProvider.tsx:193-194` — toast uses `role="status"` with `aria-live="assertive"` for errors; should be `role="alert"` (role/live conflict).
- `DialogProvider.tsx:188-198` — toast has no manual dismiss; 6s auto-only.
- `DialogProvider.tsx:142` — focus-trap selector includes `button, input, ...` without `:not([disabled])` (useModalDrawer's FOCUSABLE does exclude them — inconsistent).
- `Drawer.tsx:117-118` — underlay gets `aria-hidden` but focus never moved out of it when a higher drawer opens (risk of focused-element-inside-aria-hidden).

### Artifacts

- `ArtifactBody.tsx:24` — `role="img"` on the diff container hides all diff text from screen readers; use `role="group"`/region.
- `ArtifactBody.tsx:83` — hardcoded `width={1600} height={900}` attrs misstate intrinsic dimensions of arbitrary images.
- `ArtifactBody.tsx:96,113,129` — loading/empty status `<p>`s have no `role="status"`; state changes not announced.
- `ArtifactIndexStrip.tsx:60-68` — strip expands only on mouse enter/leave; keyboard/desktop-touch users can never reach the search/filter panel.
- `ArtifactIndexStrip.tsx:104-120` — kind filter buttons: active state is class-only, no `aria-pressed`.
- `ArtifactIndexStrip.tsx:80,133` — selection uses `aria-pressed` where `aria-current` better fits navigation semantics.
- `ArtifactPreviewHeader.tsx:64` — `download={artifact.title}` uses raw title as filename; titles with `/` or illegal chars produce bad downloads.
- `ArtifactPreviewHeader.tsx:41-43` — copy failure is a silent no-op; no error announcement.
- `artifact.css:234` — animates `grid-template-columns` (layout property, not transform/opacity) on every strip hover expand.
- `artifact.css:207` — `.artifact-image-preview` forces `aspect-ratio: 16/9` letterboxing all image artifacts regardless of true ratio.
- `artifact.css:114` — `.artifact-chip-cta` hidden at 0.6 opacity until hover/focus; keyboard reveal via `:focus-visible` ✓.

### Profile image / preferences

- `profile-image.css:90` — remove button is 24×24px, below 44px touch target, not covered by a11y.css coarse-pointer bump.
- `ProfileImagePicker.tsx:23` — `<img>` has no width/height attrs, no `loading="lazy"`/`decoding="async"` (unlike Markdown and artifact images).
- `ProfileImagePicker.tsx:91-99` — sr-only file input is fine, but trigger and input are two separate tab stops pointing at the same action.
- `preferences.css:20` — fixed `height: min(440px, 90dvh)`; no min-height guard, very short viewports squash the panel.
- `PreferencesPanel.tsx:110-116` — `role="radiogroup"` wraps a non-radio child (`<p class="pref-group-label">`); radiogroup should contain radios only.
- `PreferencesPanel.tsx:48-49` — check SVG uses `--color-primary`/`--color-on-primary` (shadcn-bridge aliases) instead of the `--action`/`--on-action` tokens used everywhere else in this file's CSS.

### Syntax

- `syntax.css:32` — stale comment "warm code-number accent" but `.hljs-number` maps to plain `--ink-2`.
- ✓ `syntax.ts` theme classes align with syntax.css; auto-detect fallback cache-bounded.

### Pass

✓ dialog.css, overlay.css, PreferencesDialog.tsx, ArtifactViewerProvider.tsx, ArtifactNavButton.tsx, ArtifactLibraryDrawer.tsx, ArtifactsEmpty.tsx, CodeView.tsx, Markdown.tsx, ui/DialogProvider focus-trap otherwise, ui/OverlayCloseButton, ui/button, ui/input, ui/select, ui/switch, ui/textarea, ui/badge.

---

## 9. Shell / nav / marks / empty states

- `AppShell.tsx:182` — inline `style={{ display: "contents" }}` on `<main>` — bypasses the CSS layer system; `display:contents` on a landmark has known AT exposure bugs in Safari.
- `SideNav.tsx:176` — `aria-label="Relay"` hardcoded English — bypasses i18n used everywhere else.
- `SideNav.tsx:316-329` — More button: no hover/focus tooltip wiring unlike every other collapsed-rail button.
- `SideNav.tsx:123-127` — tooltip show-on-focus has no Escape dismissal (WCAG 1.4.13 content-on-focus).
- `RelayMark.tsx:15` — `aria-label="Relay"` + `<title>Relay</title>` produce a duplicate accessible name; hardcoded English; no way to render decoratively.
- `AgentMark.tsx:43` — `role="img"` combined with `aria-hidden="true"` is contradictory; role is dead code.
- `icons.tsx` — ✓ aria-hidden default with caller-overridable props is the correct pattern. Minor: identical glyphs reused for unrelated semantics (Terminal ×4: NavWorkspace/NodeLocal/StreamCommand/ArtifactCommand; Bot ×3) — cross-surface meaning collision.
- `shell.css:12` — animating `grid-template-columns` (layout, non-composited) on every sidenav toggle; `sidenav.css:13` also transitions width — double-animating the same change.
- `tokens/base.css:202` — `pulse-ring` animation relies solely on a11y.css global squash for reduced-motion; no local guard.

### Empty states

- `BoardEmpty.tsx:21` — title is a `<p>`, not a heading; structure diverges from RelayEmptyState's section+h2 grammar — two empty-state languages.
- `BoardEmpty.tsx:20` — `role="status"` live-announces on mount while RelayEmptyState doesn't; inconsistent SR behavior.
- `BoardEmpty.tsx:23` — `onCreate`/`createLabel` optional; can render a dead-end empty state with no next step.
- `RelayEmptyState.tsx:24` — default `titleId="relay-empty-title"` produces duplicate IDs when 2+ instances render on one page.
- `RelayEmptyState.tsx:49` — hardcoded `<h2>` level may break the heading outline depending on placement.
- ✓ TranscriptEmpty (unique titleId, illustration hidden, hint gives next step).

### Workspace / backlog misc

- `workspace.css:1646` — `.workspace-skeleton` shimmer missing from the `prefers-reduced-motion` block at :1796 (every other animation covered).
- `workspace.css:1690` — `.workspace-error-action` has no `:hover`/`:focus-visible` styles and hard-codes ink-on-canvas colors instead of a Button variant.
- `admin-v2-views.css:200` — `.adm-emp-name` no truncation; long display names wrap/overflow.
- `admin-v2-views.css:606` — `.adm-emp-card-dept` right-aligned, no truncation; long department names overflow card header.
- `admin-v2-views.css:207` — `.adm-emp-meta` email/handle row has no truncation guard.
- `backlog.css:514` — `.backlog-task-title` has no line-clamp; very long titles wrap unbounded inside board cards (description is clamped, title is not).
- ✓ pass: pills.css, empty-state.css, teams.css, agents.css, admin-v2-drawers.css, admin-v2-dashboard.css, tailwind-bridge.css, styles.css, skills.css (stub), mcp.css (stub), app/page.tsx, app/providers.tsx.

---

## 10. A11y rules coverage notes

- `a11y.css:6-11` — `text-wrap: balance` covers only 4 heading selectors; `.page-header-title--display`, `.mobile-topbar-title`, `.dialog-title` not balanced (PageHeader.tsx:49 patches one via class).
- No `forced-colors` support anywhere — see §5.
- `App.tsx:686-691` — pre-auth fallback renders before theme/lang hydration; `login-checking` surface styling lives in login.css.
