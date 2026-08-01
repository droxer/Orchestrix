# Agent Record Status Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the four different renderings of "agent status" on the agent record page (Profile/Workspace/Activities tabs) into one header strip, delete redundant chrome (a duplicate tab-name label, a mislabeled "Ready" badge on the personality card), and let the Profile tab use the full page width like its sibling tabs already do.

**Architecture:** Pure UI cleanup inside the existing Phosphor design system — no new components, no new tokens. `AgentWorkspacePage.tsx`'s `PageHeader` `actions` slot gets one consolidated status strip (runtime chip + placement badge + availability pill) that is tab-independent, replacing a two-line stack. The same availability pill is deleted from `AgentProfilePanel.tsx` (workspace variant) and made optional in the shared `WorkspaceActivities` primitive (still required by `TeamWorkspacePage.tsx`, which is untouched).

**Tech Stack:** Next.js 16 / React (web/src/components), CSS (web/src/styles), i18next locale JSON (web/src/i18n/locales).

## Global Constraints

- Stay inside the Phosphor identity: no new colors, fonts, or spacing values — only `var(--...)` tokens already defined in `web/src/styles/tokens/palette.css`. (Source: design spec, Non-goals.)
- `workspace.profile_sub` is used only by `AgentWorkspacePage.tsx`; `TeamWorkspacePage.tsx` uses the separate key `teams.profile_sub` — do not touch that one. (Verified via `grep -rn "profile_sub"`.)
- `agents_page.personality_defined` is used only by `AgentPersonalityEditor.tsx`, shared by both the admin-drawer and workspace variants of `AgentProfilePanel.tsx` — the copy rename applies to both call sites automatically; that's intended. (Verified via `grep -rn "personality_defined"`.)
- `WorkspaceActivities`'s `statusPill` prop is also consumed by `TeamWorkspacePage.tsx` (`web/src/components/TeamWorkspacePage.tsx:510-519`) — it must become *optional*, not deleted, and `TeamWorkspacePage.tsx` must not change.
- `.workspace-status-pill` and `.workspace-status-pip` CSS rules are pinned by `web/tests/monochromeTokens.test.ts` (existence + tone colors + "no tinted fill") — keep those rule definitions in `workspace.css`; only change which components render elements with those classes.
- Existing locale files use `"custom": "自定义"` (zh-CN) / `"自訂"` (zh-TW) elsewhere in the same file (`web/src/i18n/locales/{zh-CN,zh-TW}/translation.json:416`) — reuse those exact words for the personality-copy rename, for vocabulary consistency.
- This repo's `web/tests/*.test.ts` are logic/text-scan tests run via Node's built-in test runner against **built** JS (`node --test dist/web/tests/<file>.test.js`, built via `tsc -p packages/tsconfig.json`, which `npm run build` calls) — there is no component-rendering test harness (no RTL/jsdom) in this repo, so verification for markup/CSS changes is: (a) the existing text-scan contract tests still pass, (b) a manual browser check per `CLAUDE.md`'s frontend-change rule.

---

## File Structure

No new files. Modified:
- `web/src/components/AgentWorkspacePage.tsx` — header subtitle removal, header strip, drop `statusPill` prop pass
- `web/src/components/AgentProfilePanel.tsx` — drop duplicate availability line (workspace variant only)
- `web/src/components/workspace/WorkspacePrimitives.tsx` — `statusPill` becomes optional
- `web/src/styles/workspace.css` — header strip CSS, Profile full-bleed width, dead-rule cleanup
- `web/src/styles/agents.css` — placement badge dot/icon spacing
- `web/src/i18n/locales/en/translation.json`, `.../zh-CN/translation.json`, `.../zh-TW/translation.json` — delete `workspace.profile_sub`, rename `agents_page.personality_defined`

---

### Task 1: Delete the redundant Profile tab subtitle

**Files:**
- Modify: `web/src/components/AgentWorkspacePage.tsx:374-376,409` (subtitle computation and its use)
- Modify: `web/src/i18n/locales/en/translation.json:263`
- Modify: `web/src/i18n/locales/zh-CN/translation.json:263`
- Modify: `web/src/i18n/locales/zh-TW/translation.json:263`

**Interfaces:**
- Consumes: nothing new
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Remove the `headerSubtitle` computation and its use in `AgentWorkspacePage.tsx`**

In `web/src/components/AgentWorkspacePage.tsx`, delete:

```tsx
  const headerSubtitle = pageTab === "profile"
    ? t("workspace.profile_sub", { agent: displayName })
    : null;
```

and change the `PageHeader` call from:

```tsx
      <PageHeader
        kicker={t("nav.workspace")}
        title={(
```

leaving `kicker`/`title` as-is, but remove the `subtitle={headerSubtitle}` line that currently follows the `title` block (it sits right before `titleVariant="display"`).

- [ ] **Step 2: Delete the now-unused `workspace.profile_sub` key from all three locale files**

`web/src/i18n/locales/en/translation.json`, remove the line:
```json
    "profile_sub": "Profile",
```

`web/src/i18n/locales/zh-CN/translation.json`, remove the line:
```json
    "profile_sub": "配置",
```

`web/src/i18n/locales/zh-TW/translation.json`, remove the line:
```json
    "profile_sub": "設定",
```

- [ ] **Step 3: Verify no remaining references and valid JSON**

Run:
```bash
grep -rn "profile_sub" web/src --include="*.tsx" --include="*.ts"
```
Expected: only `teams.profile_sub` in `TeamWorkspacePage.tsx` remains (no `workspace.profile_sub`).

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('web/src/i18n/locales/en/translation.json','utf8')); JSON.parse(require('fs').readFileSync('web/src/i18n/locales/zh-CN/translation.json','utf8')); JSON.parse(require('fs').readFileSync('web/src/i18n/locales/zh-TW/translation.json','utf8')); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AgentWorkspacePage.tsx web/src/i18n/locales/en/translation.json web/src/i18n/locales/zh-CN/translation.json web/src/i18n/locales/zh-TW/translation.json
git commit -m "fix(web): delete redundant Profile tab subtitle"
```

---

### Task 2: Rename the personality-state copy so it stops colliding with "Ready"

**Files:**
- Modify: `web/src/i18n/locales/en/translation.json:1106`
- Modify: `web/src/i18n/locales/zh-CN/translation.json:1105`
- Modify: `web/src/i18n/locales/zh-TW/translation.json:1104`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by later tasks (independent of Task 1, safe to reorder, but keep as its own commit since a reviewer could reject the wording without touching the header work)

- [ ] **Step 1: Change the English copy**

In `web/src/i18n/locales/en/translation.json`, change:
```json
    "personality_defined": "Ready",
```
to:
```json
    "personality_defined": "Custom",
```

- [ ] **Step 2: Change the Chinese (Simplified) copy**

In `web/src/i18n/locales/zh-CN/translation.json`, change:
```json
    "personality_defined": "就绪",
```
to:
```json
    "personality_defined": "自定义",
```

- [ ] **Step 3: Change the Chinese (Traditional) copy**

In `web/src/i18n/locales/zh-TW/translation.json`, change:
```json
    "personality_defined": "就緒",
```
to:
```json
    "personality_defined": "自訂",
```

- [ ] **Step 4: Verify JSON validity and that no code assumes the old English string**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('web/src/i18n/locales/en/translation.json','utf8')); JSON.parse(require('fs').readFileSync('web/src/i18n/locales/zh-CN/translation.json','utf8')); JSON.parse(require('fs').readFileSync('web/src/i18n/locales/zh-TW/translation.json','utf8')); console.log('ok')"
grep -rn '"Ready"' web/src/components/AgentPersonalityEditor.tsx
```
Expected: `ok`, and the grep returns nothing (the component reads the key via `t()`, never hardcodes the word).

- [ ] **Step 5: Commit**

```bash
git add web/src/i18n/locales/en/translation.json web/src/i18n/locales/zh-CN/translation.json web/src/i18n/locales/zh-TW/translation.json
git commit -m "fix(web): stop reusing the word Ready for the personality-defined badge"
```

---

### Task 3: Consolidate the header into one status strip

**Files:**
- Modify: `web/src/components/AgentWorkspacePage.tsx:438-469` (the `actions` block of the `PageHeader` call)
- Modify: `web/src/styles/workspace.css:40-102` (header fact styles)

**Interfaces:**
- Consumes: `primaryPlacement` (already computed earlier in the component, unchanged), `agent.executorKind`, `agent.availability`, `agentLabel()` from `../lib/plan`, `agentAvailabilityTone()` from `../lib/adminHelpers`, `AgentMark`, `AgentPlacementBadge` (all already imported)
- Produces: `.workspace-header-strip` CSS class (new), used only here

- [ ] **Step 1: Replace the two-line header facts JSX with one strip**

In `web/src/components/AgentWorkspacePage.tsx`, inside the `PageHeader`'s `actions` prop, replace:

```tsx
        actions={(
          <>
            <div className="workspace-header-facts">
              <span className="workspace-header-fact">
                <span className="workspace-header-fact-label">{t("admin.v2.agent_runtime")}</span>
                <span className="workspace-header-chip" translate="no">
                  <AgentMark agent={agent.executorKind} size={13} />
                  <span className="workspace-header-chip-name">{agentLabel(agent.executorKind)}</span>
                </span>
              </span>
              <span className="workspace-header-fact">
                {primaryPlacement ? (
                  <AgentPlacementBadge description={primaryPlacement} showSandbox />
                ) : (
                  <span className="workspace-header-chip workspace-header-chip--empty">
                    {t("admin.v2.no_runtime_placement")}
                  </span>
                )}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("nav.refresh")}
              disabled={isRefreshing || (pageTab === "activities" && query.isFetching)}
              onClick={() => void refreshWorkspace()}
            >
              <NavRefresh size={16} className={isRefreshing || (pageTab === "activities" && query.isFetching) ? "spin" : undefined} />
            </Button>
          </>
        )}
```

with:

```tsx
        actions={(
          <>
            <div className="workspace-header-strip">
              <span
                className="workspace-header-chip"
                translate="no"
                aria-label={`${t("admin.v2.agent_runtime")}: ${agentLabel(agent.executorKind)}`}
              >
                <AgentMark agent={agent.executorKind} size={13} />
                <span className="workspace-header-chip-name" aria-hidden="true">{agentLabel(agent.executorKind)}</span>
              </span>
              {primaryPlacement ? (
                <AgentPlacementBadge description={primaryPlacement} showSandbox />
              ) : (
                <span className="workspace-header-chip workspace-header-chip--empty">
                  {t("admin.v2.no_runtime_placement")}
                </span>
              )}
              <span className={`workspace-status-pill tone-${agentAvailabilityTone(agent.availability)}`}>
                {t(`admin.v2.placement_status.${agent.availability}`, { defaultValue: agent.availability })}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("nav.refresh")}
              disabled={isRefreshing || (pageTab === "activities" && query.isFetching)}
              onClick={() => void refreshWorkspace()}
            >
              <NavRefresh size={16} className={isRefreshing || (pageTab === "activities" && query.isFetching) ? "spin" : undefined} />
            </Button>
          </>
        )}
```

(The visible "RUNTIME" caps label is replaced by an `aria-label` on the runtime chip — the agent glyph + name is self-explanatory visually, but screen readers still get the "runtime" context.)

- [ ] **Step 2: Replace the header-facts CSS with the single-strip CSS**

In `web/src/styles/workspace.css`, replace:

```css
.workspace-header-facts {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--sp-2);
  min-width: 0;
}

.workspace-header-fact {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  max-width: 100%;
}

.workspace-header-fact-label {
  flex: none;
  color: var(--ink-3);
  font: var(--type-micro);
  letter-spacing: var(--track-caps);
  text-transform: uppercase;
}

.workspace-header-chip {
```

with:

```css
.workspace-header-strip {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  max-width: 100%;
}

.workspace-header-chip {
```

(Everything from `.workspace-header-chip {` onward — the chip, its `svg`, `.workspace-header-chip-name`, `.workspace-header-chip--empty` — is unchanged; only the three rules above it are replaced.)

- [ ] **Step 3: Verify the old class names are gone and the file still parses**

Run:
```bash
grep -n "workspace-header-fact\b\|workspace-header-facts\|workspace-header-fact-label" web/src/components/AgentWorkspacePage.tsx web/src/styles/workspace.css
```
Expected: no matches (the old names are fully retired; `workspace-header-fact-label` was a class, not a substring of anything else you should keep).

Run:
```bash
npx tsc -p packages/tsconfig.json --noEmit
```
Expected: no new errors (this project excludes `web/src/components/**` from this tsconfig per `packages/tsconfig.json`, so this mainly guards the test files; the real type check for the component happens via `npm run build -w web` in the final verification task).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AgentWorkspacePage.tsx web/src/styles/workspace.css
git commit -m "feat(web): consolidate agent header facts into one status strip"
```

---

### Task 4: Remove the duplicate availability line from the Profile hero

**Files:**
- Modify: `web/src/components/AgentProfilePanel.tsx:342-351` (workspace variant only)
- Modify: `web/src/styles/workspace.css:1184-1197` (`.workspace-dossier-meta` / `.workspace-dossier-availability`)

**Interfaces:**
- Consumes: nothing new
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Delete the availability span from the workspace-variant hero**

In `web/src/components/AgentProfilePanel.tsx`, inside the `isWorkspace` branch, replace:

```tsx
            <div className="workspace-dossier-meta">
              <span className="workspace-dossier-availability">
                <span
                  className={`workspace-status-pip tone-${agentAvailabilityTone(agent.availability)}`}
                  aria-hidden="true"
                />
                {t(`admin.v2.placement_status.${agent.availability}`, { defaultValue: agent.availability })}
              </span>
              <span translate="no">@{agent.employeeId}</span>
            </div>
```

with:

```tsx
            <div className="workspace-dossier-meta">
              <span translate="no">@{agent.employeeId}</span>
            </div>
```

- [ ] **Step 2: Delete the now-dead `.workspace-dossier-availability` CSS rule**

In `web/src/styles/workspace.css`, delete:

```css
.workspace-dossier-availability {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1-5);
}
```

Leave `.workspace-dossier-meta` as-is (it still applies to the remaining `@handle` span).

- [ ] **Step 3: Verify**

Run:
```bash
grep -n "workspace-dossier-availability" web/src/components/AgentProfilePanel.tsx web/src/styles/workspace.css
```
Expected: no matches.

```bash
grep -n "agentAvailabilityTone" web/src/components/AgentProfilePanel.tsx
```
Expected: still one match, in the non-workspace (`admin`) branch further down the file (`adm-status-pill tone-...`) — confirms the import is still used and shouldn't be removed.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AgentProfilePanel.tsx web/src/styles/workspace.css
git commit -m "fix(web): remove duplicate availability line from the profile hero"
```

---

### Task 5: Make the Activities metric-strip status pill optional, and stop passing it from the agent page

**Files:**
- Modify: `web/src/components/workspace/WorkspacePrimitives.tsx:204-245`
- Modify: `web/src/components/AgentWorkspacePage.tsx:485-509` (the `WorkspaceActivities` call)

**Interfaces:**
- Consumes: nothing new
- Produces: `WorkspaceActivities({ statusPill?: ReactNode, ... })` — `TeamWorkspacePage.tsx` keeps passing a value and is unaffected; `AgentWorkspacePage.tsx` stops passing one

- [ ] **Step 1: Make `statusPill` optional and conditionally render its cell**

In `web/src/components/workspace/WorkspacePrimitives.tsx`, change the prop type from:

```tsx
export function WorkspaceActivities({
  brief,
  statusPill,
  onOpenThread,
  panelId,
  labelledBy,
  emptyMark,
  emptyPulse = false,
}: {
  brief?: WorkspaceBriefResponse;
  /** Status chip rendered as the last metric cell (agent availability or team readiness). */
  statusPill: ReactNode;
  onOpenThread: (sessionId: string) => void;
  panelId: string;
  labelledBy: string;
  emptyMark?: ReactNode;
  emptyPulse?: boolean;
}) {
```

to:

```tsx
export function WorkspaceActivities({
  brief,
  statusPill,
  onOpenThread,
  panelId,
  labelledBy,
  emptyMark,
  emptyPulse = false,
}: {
  brief?: WorkspaceBriefResponse;
  /** Optional status chip rendered as a trailing metric cell (e.g. team
   *  readiness). Omit when the caller already shows status elsewhere
   *  (the agent page's header strip covers this for agents). */
  statusPill?: ReactNode;
  onOpenThread: (sessionId: string) => void;
  panelId: string;
  labelledBy: string;
  emptyMark?: ReactNode;
  emptyPulse?: boolean;
}) {
```

and change the render of the strip from:

```tsx
      <div className="workspace-metric-strip" role="group" aria-label={t("workspace.metrics")}>
        <MetricItem
          label={t("workspace.metric_runs")}
          value={metrics?.activeRunCount ?? 0}
          live={(metrics?.activeRunCount ?? 0) > 0}
        />
        <MetricItem label={t("workspace.metric_tasks")} value={metrics?.activeTaskCount ?? 0} zero={(metrics?.activeTaskCount ?? 0) === 0} />
        <MetricItem label={t("workspace.metric_sessions")} value={metrics?.sessionCount ?? 0} zero={(metrics?.sessionCount ?? 0) === 0} />
        <div className="workspace-metric-item workspace-metric-item--status">{statusPill}</div>
      </div>
```

to:

```tsx
      <div className="workspace-metric-strip" role="group" aria-label={t("workspace.metrics")}>
        <MetricItem
          label={t("workspace.metric_runs")}
          value={metrics?.activeRunCount ?? 0}
          live={(metrics?.activeRunCount ?? 0) > 0}
        />
        <MetricItem label={t("workspace.metric_tasks")} value={metrics?.activeTaskCount ?? 0} zero={(metrics?.activeTaskCount ?? 0) === 0} />
        <MetricItem label={t("workspace.metric_sessions")} value={metrics?.sessionCount ?? 0} zero={(metrics?.sessionCount ?? 0) === 0} />
        {statusPill ? (
          <div className="workspace-metric-item workspace-metric-item--status">{statusPill}</div>
        ) : null}
      </div>
```

- [ ] **Step 2: Stop passing `statusPill` from the agent workspace page**

In `web/src/components/AgentWorkspacePage.tsx`, inside the `WorkspaceActivities` call, delete the `statusPill` prop:

```tsx
          <WorkspaceActivities
            brief={brief}
            panelId="workspace-page-panel-activities"
            labelledBy="workspace-page-tab-activities"
            statusPill={(
              <span className={`workspace-status-pill tone-${agentAvailabilityTone(agent.availability)}`}>
                {t(`admin.v2.placement_status.${agent.availability}`, { defaultValue: agent.availability })}
              </span>
            )}
            emptyPulse
            onOpenThread={onOpenThread}
          />
```

becomes:

```tsx
          <WorkspaceActivities
            brief={brief}
            panelId="workspace-page-panel-activities"
            labelledBy="workspace-page-tab-activities"
            emptyPulse
            onOpenThread={onOpenThread}
          />
```

- [ ] **Step 3: Verify `TeamWorkspacePage.tsx` is untouched and still compiles against the new optional type**

Run:
```bash
git diff --stat web/src/components/TeamWorkspacePage.tsx
```
Expected: empty output (no changes to this file).

```bash
grep -n "statusPill" web/src/components/TeamWorkspacePage.tsx web/src/components/AgentWorkspacePage.tsx web/src/components/workspace/WorkspacePrimitives.tsx
```
Expected: `TeamWorkspacePage.tsx` still passes `statusPill={...}`; `AgentWorkspacePage.tsx` no longer has a `statusPill=` line; `WorkspacePrimitives.tsx` shows the `statusPill?:` type and the `{statusPill ? (...) : null}` conditional.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/workspace/WorkspacePrimitives.tsx web/src/components/AgentWorkspacePage.tsx
git commit -m "fix(web): drop the duplicate availability pill from agent activities metrics"
```

---

### Task 6: Fix placement badge dot/icon legibility

**Files:**
- Modify: `web/src/styles/agents.css:235-241`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Add breathing room after the status dot**

In `web/src/styles/agents.css`, change:

```css
.agent-placement-badge-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: var(--r-full);
  background: var(--tone, var(--ink-4));
}
```

to:

```css
.agent-placement-badge-dot {
  width: 7px;
  height: 7px;
  flex: none;
  margin-right: var(--sp-1);
  border-radius: var(--r-full);
  background: var(--tone, var(--ink-4));
}
```

(The badge's own `gap: var(--sp-1)` already spaces every child evenly; this adds a second `--sp-1` specifically after the dot, so it no longer sits shoulder-to-shoulder with the ownership icon and reads as a doubled dot at small sizes.)

- [ ] **Step 2: Verify in the browser**

Start the web dev server (`.claude/launch.json` config `"web"`, port 5000) if not already running, open `/agents/<any-agent-with-a-placement>`, and confirm the placement badge in the new header strip shows a clearly separated status dot, then ownership icon, then node name — not two adjacent dots.

- [ ] **Step 3: Commit**

```bash
git add web/src/styles/agents.css
git commit -m "fix(web): separate the placement badge's status dot from its ownership icon"
```

---

### Task 7: Let the Profile tab use the full page width

**Files:**
- Modify: `web/src/styles/workspace.css:433-440`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Drop the fixed-width centering**

In `web/src/styles/workspace.css`, change:

```css
.workspace-profile .workspace-profile-panel {
  max-width: 640px;
  margin: 0 auto;
  padding: var(--sp-7);
  border: 1px solid var(--line-1);
  border-radius: var(--r-3);
  background: var(--surface-1);
}
```

to:

```css
.workspace-profile .workspace-profile-panel {
  padding: var(--sp-7);
  border: 1px solid var(--line-1);
  border-radius: var(--r-3);
  background: var(--surface-1);
}
```

- [ ] **Step 2: Verify no other rule re-imposes a width cap**

Run:
```bash
grep -n "workspace-profile-panel" web/src/styles/workspace.css
```
Expected: the base rule (now without `max-width`/`margin`) plus the existing `@media (max-width: 640px)` rule further down that sets `padding: var(--sp-4)` on small screens — leave that mobile rule as-is, it does not reintroduce a desktop width cap.

- [ ] **Step 3: Commit**

```bash
git add web/src/styles/workspace.css
git commit -m "fix(web): let the profile tab panel use the full page width"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the existing contract test suite**

```bash
npm run build -w web
tsc -p packages/tsconfig.json
node --test dist/web/tests/faceUtilities.test.js dist/web/tests/monochromeTokens.test.js dist/web/tests/designGrid.test.js
```
Expected: all PASS. (`faceUtilities.test.ts` checks `.mono`/`.code`/`.tnum` usage and one pinned line in `AgentWorkspacePage.tsx` unrelated to this change; `monochromeTokens.test.ts` checks `.workspace-status-pill`/`.workspace-status-pip` still exist with correct tone rules; `designGrid.test.ts` checks the breakpoint registry, unaffected since no breakpoints were added or removed.)

- [ ] **Step 2: Full project test suite**

```bash
npm test
```
Expected: PASS (TypeScript suite + Python backend suite — this change touches no backend or non-web TS code, so this mainly guards against an accidental break).

- [ ] **Step 3: Manual browser verification**

Start the web dev server (`make web`, or the `.claude/launch.json` `"web"` config on port 5000) against a real or mocked backend, sign in, open an agent's record page, and check on both light and dark themes:
- The Profile tab header shows no second "Profile" line above the tab strip.
- All three tabs show one header strip (runtime chip, placement badge, one availability pill) — not two rows.
- The Profile hero no longer shows its own "Ready"/availability line (only `@handle` remains next to the name).
- The Personality card badge reads "Custom" or "Default" — never "Ready".
- The Activities metric strip has exactly three cells (Active Runs / Active Tasks / Threads) with no trailing pill stranded across a gap.
- The Profile tab's content panel spans the same width as the Workspace and Activities tab content, not a narrow centered column.
- The placement badge's status dot and ownership icon read as two distinct marks, not a doubled dot.

- [ ] **Step 4: Final commit (if any stray formatting changes were picked up by the dev server's linting)**

```bash
git status
```
If clean, no commit needed — Tasks 1-7 already cover every change.
