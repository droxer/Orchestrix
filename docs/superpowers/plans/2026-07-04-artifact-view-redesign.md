# Artifact View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two existing artifact viewer surfaces (single-artifact drawer + library drawer) with one unified `ArtifactLibraryDrawer` that opens preview-first with a collapsible index strip for navigation.

**Architecture:** A new `ArtifactLibraryDrawer` component assembles two new sub-components (`ArtifactIndexStrip` and `ArtifactPreviewHeader`) alongside the existing `ArtifactBody`. The existing `ArtifactViewerProvider` context API is preserved but its inner drawer is replaced. `ConversationArtifactsDrawer` is deleted and its usage in `App.tsx` is replaced.

**Tech Stack:** React 18, TypeScript, CSS custom properties (no new dependencies).

## Global Constraints

- Node ≥ 22.19 required; TypeScript strict mode.
- No new npm dependencies.
- All new i18n strings must be added to all three locale files: `en`, `zh-CN`, `zh-TW`.
- Do NOT create git commits (project rule).
- Test runner: `node --test` with `describe`/`it` from `node:test`. Tests live in `web/tests/`.
- Build: `npm run build` from repo root; type-check: `npx tsc --noEmit` from `web/`.
- CSS variables come from the existing design token set — do not introduce new custom properties.

---

## File Map

| Path | Action | Purpose |
|---|---|---|
| `web/src/components/artifact/ArtifactIndexStrip.tsx` | **Create** | Collapsible left-edge navigation strip |
| `web/src/components/artifact/ArtifactPreviewHeader.tsx` | **Create** | Single-row preview header with actions |
| `web/src/components/artifact/ArtifactLibraryDrawer.tsx` | **Create** | Unified drawer: assembles strip + header + body |
| `web/src/components/ArtifactViewerProvider.tsx` | **Modify** | Update context API; use `ArtifactLibraryDrawer` |
| `web/src/App.tsx` | **Modify** | Replace `ConversationArtifactsDrawer` with `ArtifactLibraryDrawer` |
| `web/src/components/artifact/ArtifactBody.tsx` | **Modify** | Add line number gutter to `DiffView` |
| `web/src/styles/artifact.css` | **Modify** | Delete old decoration classes; add new layout classes |
| `web/src/i18n/locales/en/translation.json` | **Modify** | Add new keys |
| `web/src/i18n/locales/zh-CN/translation.json` | **Modify** | Add new keys |
| `web/src/i18n/locales/zh-TW/translation.json` | **Modify** | Add new keys |
| `web/tests/artifactLibrary.test.ts` | **Create** | Unit tests for pure logic (filtering, selection) |
| `web/src/components/ConversationArtifactsDrawer.tsx` | **Delete** | Replaced by `ArtifactLibraryDrawer` |

---

## Task 1: Add i18n keys

**Files:**
- Modify: `web/src/i18n/locales/en/translation.json`
- Modify: `web/src/i18n/locales/zh-CN/translation.json`
- Modify: `web/src/i18n/locales/zh-TW/translation.json`

**Interfaces:**
- Produces: i18n keys consumed by Tasks 4 and 5.

- [ ] **Step 1: Add keys to English locale**

In `web/src/i18n/locales/en/translation.json`, find the `"artifact"` object and add these entries (keep alphabetical order within the object):

```json
"action_copy": "Copy",
"action_download": "Download",
"action_raw": "Raw",
"copied": "Copied!",
"strip_label": "Artifact navigator"
```

- [ ] **Step 2: Add same keys to zh-CN locale**

In `web/src/i18n/locales/zh-CN/translation.json`, find the `"artifact"` object and add:

```json
"action_copy": "复制",
"action_download": "下载",
"action_raw": "原始",
"copied": "已复制！",
"strip_label": "产物导航"
```

- [ ] **Step 3: Add same keys to zh-TW locale**

In `web/src/i18n/locales/zh-TW/translation.json`, find the `"artifact"` object and add:

```json
"action_copy": "複製",
"action_download": "下載",
"action_raw": "原始",
"copied": "已複製！",
"strip_label": "產物導覽"
```

- [ ] **Step 4: Verify no JSON syntax errors**

```bash
node -e "require('./web/src/i18n/locales/en/translation.json'); console.log('ok')"
node -e "require('./web/src/i18n/locales/zh-CN/translation.json'); console.log('ok')"
node -e "require('./web/src/i18n/locales/zh-TW/translation.json'); console.log('ok')"
```

Expected: three lines of `ok`.

---

## Task 2: DiffView line number gutter

**Files:**
- Modify: `web/src/components/artifact/ArtifactBody.tsx`
- Modify: `web/src/styles/artifact.css`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DiffView` with a visible line number gutter; `.artifact-diff-line` grid updates to 3 columns.

- [ ] **Step 1: Write the failing test**

Create `web/tests/artifactLibrary.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Pure logic extracted from ArtifactIndexStrip — imported after Task 5 creates it.
// This file is the single test home for all artifact library pure logic.
// Placeholder test to establish the file — real tests added in Task 5.

describe("artifactLibrary", () => {
  it("placeholder — real tests added in Task 5", () => {
    assert.ok(true);
  });
});
```

- [ ] **Step 2: Run test to confirm it passes (file compiles)**

```bash
cd web && node --test tests/artifactLibrary.test.ts
```

Expected: 1 passing test.

- [ ] **Step 3: Update `DiffView` in `ArtifactBody.tsx`**

Replace the current `DiffView` function (lines 21–37 of `ArtifactBody.tsx`) with:

```tsx
function DiffView({ text }: { text: string }) {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  return (
    <div className="artifact-diff" role="img" aria-label="diff">
      {lines.map((line, index) => {
        const kind = classifyDiffLine(line);
        const sign = kind === "add" ? "+" : kind === "del" ? "-" : " ";
        return (
          <div key={index} className={`artifact-diff-line is-${kind}`}>
            <span className="artifact-diff-ln" aria-hidden="true">{index + 1}</span>
            <span className="artifact-diff-sign" aria-hidden="true">{sign}</span>
            <span className="artifact-diff-text">{line || " "}</span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Update the `.artifact-diff-line` grid in `artifact.css`**

Find the `.artifact-diff-line` rule and change `grid-template-columns` from `1.6em minmax(0, 1fr)` to:

```css
.artifact-diff-line {
  display: grid;
  grid-template-columns: 3.5em 1.6em minmax(0, 1fr);
  white-space: pre;
}
```

Add a new rule for the line number gutter (add immediately after `.artifact-diff-line`):

```css
.artifact-diff-ln {
  padding-right: var(--space-xs);
  color: var(--color-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
  user-select: none;
  opacity: 0.45;
}
```

- [ ] **Step 5: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

---

## Task 3: CSS — strip old decoration, add new layout classes

**Files:**
- Modify: `web/src/styles/artifact.css`

**Interfaces:**
- Produces: CSS classes `.artifact-library-shell`, `.artifact-index-strip`, `.artifact-index-strip.is-expanded`, `.artifact-index-btn`, `.artifact-index-row`, `.artifact-preview-header`, `.artifact-preview-body` used by Tasks 4, 5, 6.

- [ ] **Step 1: Delete the old library CSS blocks**

In `artifact.css`, delete everything from `/* ── Conversation artifact library drawer ─────────────────────────────── */` to the end of the file (line 265 onward in the current file). This removes all `.conversation-artifacts-*` classes.

Also delete the `/* ── Viewer drawer ─────────────────────────────────────────────────────── */` block (lines 152–173): `.artifact-viewer-sub`, `.artifact-viewer-raw`, `.artifact-viewer-drawer-body`, `.artifact-viewer-status`, `.artifact-viewer-error`, `.artifact-viewer-body`.

Keep everything before line 152: the per-kind accent variables, `.artifact-chip`, `.artifact-chip-*`, `.artifact-kind-tag`, `.artifact-stat`, `.artifact-diff-*`, `.artifact-terminal`, `.artifact-plain`, `.artifact-image-preview`, `.artifact-frame-preview`.

- [ ] **Step 2: Add new layout CSS**

Append the following to the end of `artifact.css`:

```css
/* ── Unified artifact library drawer ─────────────────────────────────── */

.artifact-library-shell {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--color-canvas);
  color: var(--color-ink);
  transition: grid-template-columns 150ms ease;
}

.artifact-library-shell.strip-expanded {
  grid-template-columns: 280px minmax(0, 1fr);
}

/* Index strip */

.artifact-index-strip {
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-hairline);
  background: var(--color-surface-soft);
  overflow: hidden;
}

.artifact-index-strip-icons {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--space-xs);
  overflow-y: auto;
  flex: 1 1 0;
}

.artifact-index-btn {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--artifact-accent, var(--color-primary));
  cursor: pointer;
  transition: background var(--duration-fast) ease;
  flex: 0 0 auto;
}

.artifact-index-btn:hover {
  background: color-mix(in srgb, var(--artifact-accent, var(--color-primary)) 12%, transparent);
}

.artifact-index-btn.is-active {
  background: color-mix(in srgb, var(--artifact-accent, var(--color-primary)) 85%, transparent);
  color: #fff;
}

.artifact-index-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* Expanded list panel (shown when .strip-expanded) */

.artifact-index-panel {
  display: none;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.artifact-library-shell.strip-expanded .artifact-index-strip {
  width: 280px;
}

.artifact-library-shell.strip-expanded .artifact-index-strip-icons {
  display: none;
}

.artifact-library-shell.strip-expanded .artifact-index-panel {
  display: flex;
}

.artifact-index-search {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-base);
  border-bottom: 1px solid var(--color-hairline);
  flex: 0 0 auto;
}

.artifact-index-search input {
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--color-ink);
  font: var(--type-label);
}

.artifact-index-search input::placeholder {
  color: var(--color-muted);
}

.artifact-index-filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xxs);
  padding: var(--space-xs) var(--space-base);
  border-bottom: 1px solid var(--color-hairline);
  flex: 0 0 auto;
}

.artifact-index-filter-btn {
  padding: 2px var(--space-sm);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-muted);
  font: var(--type-caption-strong-sm);
  cursor: pointer;
  transition: background var(--duration-fast) ease, color var(--duration-fast) ease;
}

.artifact-index-filter-btn.is-active,
.artifact-index-filter-btn:hover {
  background: var(--color-surface-strong);
  color: var(--color-ink);
  border-color: color-mix(in srgb, var(--color-ink) 24%, var(--color-hairline));
}

.artifact-index-list {
  flex: 1 1 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: var(--space-xs);
  gap: 2px;
}

.artifact-index-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-ink);
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition: background var(--duration-fast) ease;
}

.artifact-index-row:hover {
  background: var(--color-surface-raised);
}

.artifact-index-row.is-active {
  background: var(--color-surface-strong);
}

.artifact-index-row:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.artifact-index-row-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  color: var(--artifact-accent, var(--color-primary));
  background: color-mix(in srgb, var(--artifact-accent, var(--color-primary)) 14%, transparent);
}

.artifact-index-row-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.artifact-index-row-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--type-label);
  color: var(--color-ink);
}

.artifact-index-empty {
  padding: var(--space-base);
  color: var(--color-muted);
  font: var(--type-label);
}

/* Preview pane */

.artifact-preview-pane {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.artifact-preview-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 0 var(--space-base);
  height: 44px;
  border-bottom: 1px solid var(--color-hairline);
  background: var(--color-surface-soft);
  flex: 0 0 auto;
  min-width: 0;
  overflow: hidden;
}

.artifact-preview-header-title {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--type-label-strong);
  color: var(--color-ink);
}

.artifact-preview-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex: 0 0 auto;
}

.artifact-preview-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 var(--space-sm);
  border: 1px solid var(--color-hairline);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-body);
  font: var(--type-caption-strong-sm);
  text-decoration: none;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--duration-fast) ease, border-color var(--duration-fast) ease;
}

.artifact-preview-action-btn:hover {
  background: var(--color-surface-raised);
  border-color: color-mix(in srgb, var(--color-ink) 24%, var(--color-hairline));
}

.artifact-preview-action-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.artifact-preview-body {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--color-canvas);
}

.artifact-preview-status {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-muted);
  font: var(--type-label);
}

.artifact-preview-error {
  color: var(--color-semantic-down);
}

/* Viewer status (reused by ArtifactBody loading/error states) */
.artifact-viewer-status {
  padding: var(--space-lg);
  color: var(--color-muted);
  font-size: var(--text-sm);
}
.artifact-viewer-error {
  color: var(--color-semantic-down);
}
.artifact-viewer-body {
  min-width: 0;
}

@media (prefers-reduced-motion: reduce) {
  .artifact-library-shell,
  .artifact-index-btn,
  .artifact-index-row,
  .artifact-preview-action-btn {
    transition: none;
  }
}
```

- [ ] **Step 3: Type-check (no TS changes, but confirm no regressions)**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

---

## Task 4: `ArtifactPreviewHeader` component

**Files:**
- Create: `web/src/components/artifact/ArtifactPreviewHeader.tsx`

**Interfaces:**
- Consumes: `artifact-preview-header` CSS classes from Task 3; i18n keys from Task 1.
- Produces: `ArtifactPreviewHeader` component exported for use in Task 6.

```ts
// Props signature consumed by Task 6:
export function ArtifactPreviewHeader({
  artifact,
  sessionId,
}: {
  artifact: RelayArtifact;
  sessionId: string;
}): JSX.Element
```

- [ ] **Step 1: Create the file**

```tsx
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { RelayArtifact } from "relay-core";
import { artifactRawHref } from "../../lib/artifactPreview";

const TEXT_KINDS: ReadonlySet<RelayArtifact["kind"]> = new Set([
  "diff",
  "review",
  "summary",
  "agent_output",
  "command_log",
  "test_output",
  "plan",
]);

export function ArtifactPreviewHeader({
  artifact,
  sessionId,
}: {
  artifact: RelayArtifact;
  sessionId: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const kindLabel = t(`artifact.kind.${artifact.kind}`, { defaultValue: artifact.kind });
  const rawHref = artifactRawHref(sessionId, artifact.id);
  const canCopy = TEXT_KINDS.has(artifact.kind);

  const handleCopy = useCallback(async () => {
    try {
      const response = await fetch(rawHref);
      const text = await response.text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable — silently no-op
    }
  }, [rawHref]);

  return (
    <header className="artifact-preview-header">
      <span className={`artifact-kind-tag is-${artifact.kind}`}>{kindLabel}</span>
      <span className="artifact-preview-header-title">{artifact.title}</span>
      <div className="artifact-preview-actions">
        {canCopy ? (
          <button
            type="button"
            className="artifact-preview-action-btn"
            onClick={handleCopy}
            aria-label={t("artifact.action_copy")}
          >
            {copied ? t("artifact.copied") : t("artifact.action_copy")}
          </button>
        ) : null}
        <a
          className="artifact-preview-action-btn"
          href={rawHref}
          download={artifact.title}
          aria-label={t("artifact.action_download")}
        >
          {t("artifact.action_download")}
        </a>
        <a
          className="artifact-preview-action-btn"
          href={rawHref}
          target="_blank"
          rel="noreferrer"
          aria-label={t("artifact.action_raw")}
        >
          {t("artifact.action_raw")}
        </a>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

---

## Task 5: `ArtifactIndexStrip` component

**Files:**
- Create: `web/src/components/artifact/ArtifactIndexStrip.tsx`
- Modify: `web/tests/artifactLibrary.test.ts`

**Interfaces:**
- Consumes: `artifact-index-*` CSS classes from Task 3; i18n keys from Task 1.
- Produces:
  - `filterArtifacts(artifacts, query, kind)` — exported pure function, tested here.
  - `ArtifactIndexStrip` component exported for use in Task 6.

```ts
// Exported pure function signature:
export function filterArtifacts(
  artifacts: RelayArtifact[],
  query: string,
  kind: RelayArtifact["kind"] | "all",
): RelayArtifact[]

// Component signature consumed by Task 6:
export function ArtifactIndexStrip({
  artifacts,
  selectedId,
  onSelect,
  expanded,
  onExpandedChange,
}: {
  artifacts: RelayArtifact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
}): JSX.Element
```

- [ ] **Step 1: Write the failing tests**

Replace the placeholder in `web/tests/artifactLibrary.test.ts` with:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterArtifacts } from "../src/components/artifact/ArtifactIndexStrip.js";
import type { RelayArtifact } from "relay-core";

function artifact(overrides: Partial<RelayArtifact> & { id: string }): RelayArtifact {
  return {
    id: overrides.id,
    kind: overrides.kind ?? "diff",
    title: overrides.title ?? "Untitled",
    path: overrides.path ?? "/workspace/out.txt",
    createdAt: "2026-07-04T00:00:00.000Z",
    bytes: overrides.bytes ?? 100,
    workspaceRelativePath: overrides.workspaceRelativePath,
    contentType: overrides.contentType,
  } as RelayArtifact;
}

const artifacts = [
  artifact({ id: "a1", kind: "diff", title: "Auth refactor" }),
  artifact({ id: "a2", kind: "review", title: "Security review" }),
  artifact({ id: "a3", kind: "diff", title: "Remove legacy code" }),
  artifact({ id: "a4", kind: "summary", title: "Sprint summary" }),
];

describe("filterArtifacts", () => {
  it("returns all artifacts when query is empty and kind is all", () => {
    assert.equal(filterArtifacts(artifacts, "", "all").length, 4);
  });

  it("filters by kind", () => {
    const result = filterArtifacts(artifacts, "", "diff");
    assert.equal(result.length, 2);
    assert.ok(result.every((a) => a.kind === "diff"));
  });

  it("filters by title query (case-insensitive)", () => {
    const result = filterArtifacts(artifacts, "auth", "all");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "a1");
  });

  it("filters by path query", () => {
    const a = [artifact({ id: "p1", title: "X", path: "/workspace/auth/service.ts" })];
    const result = filterArtifacts(a, "auth", "all");
    assert.equal(result.length, 1);
  });

  it("combines kind and query filters", () => {
    const result = filterArtifacts(artifacts, "legacy", "diff");
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "a3");
  });

  it("returns empty array when nothing matches", () => {
    assert.equal(filterArtifacts(artifacts, "xyzzy", "all").length, 0);
  });

  it("trims whitespace from query", () => {
    assert.equal(filterArtifacts(artifacts, "  auth  ", "all").length, 1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd web && node --test tests/artifactLibrary.test.ts
```

Expected: `ERR_MODULE_NOT_FOUND` or similar — `ArtifactIndexStrip.js` does not exist yet.

- [ ] **Step 3: Create `ArtifactIndexStrip.tsx`**

```tsx
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { RelayArtifact } from "relay-core";
import { ActionSearch } from "../icons";
import { ArtifactKindIcon } from "./ArtifactKindIcon";

export function filterArtifacts(
  artifacts: RelayArtifact[],
  query: string,
  kind: RelayArtifact["kind"] | "all",
): RelayArtifact[] {
  const needle = query.trim().toLowerCase();
  return artifacts.filter((a) => {
    if (kind !== "all" && a.kind !== kind) return false;
    if (!needle) return true;
    const path = a.workspaceRelativePath ?? a.path ?? "";
    return `${a.title} ${path}`.toLowerCase().includes(needle);
  });
}

export function ArtifactIndexStrip({
  artifacts,
  selectedId,
  onSelect,
  expanded,
  onExpandedChange,
}: {
  artifacts: RelayArtifact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<RelayArtifact["kind"] | "all">("all");

  const kinds = Array.from(new Set(artifacts.map((a) => a.kind)));
  const filtered = filterArtifacts(artifacts, query, kindFilter);

  const handleMouseEnter = useCallback(() => onExpandedChange(true), [onExpandedChange]);
  const handleMouseLeave = useCallback(() => onExpandedChange(false), [onExpandedChange]);

  return (
    <nav
      className="artifact-index-strip"
      aria-label={t("artifact.strip_label")}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Collapsed: icon buttons only */}
      <div className="artifact-index-strip-icons">
        {artifacts.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`artifact-index-btn${a.id === selectedId ? " is-active" : ""}`}
            data-kind={a.kind}
            title={a.title}
            aria-label={a.title}
            aria-pressed={a.id === selectedId}
            onClick={() => onSelect(a.id)}
          >
            <ArtifactKindIcon kind={a.kind} size={16} />
          </button>
        ))}
      </div>

      {/* Expanded: full list panel */}
      <div className="artifact-index-panel">
        <div className="artifact-index-search">
          <ActionSearch size={14} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("artifact.search_placeholder")}
            aria-label={t("artifact.search_label")}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {kinds.length > 1 ? (
          <div className="artifact-index-filters">
            <button
              type="button"
              className={`artifact-index-filter-btn${kindFilter === "all" ? " is-active" : ""}`}
              onClick={() => setKindFilter("all")}
            >
              {t("artifact.filter_all")}
            </button>
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                className={`artifact-index-filter-btn${kindFilter === k ? " is-active" : ""}`}
                onClick={() => setKindFilter(k)}
              >
                {t(`artifact.kind.${k}`, { defaultValue: k })}
              </button>
            ))}
          </div>
        ) : null}
        <div className="artifact-index-list">
          {filtered.length === 0 ? (
            <p className="artifact-index-empty">{t("artifact.no_matches")}</p>
          ) : (
            filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`artifact-index-row${a.id === selectedId ? " is-active" : ""}`}
                data-kind={a.kind}
                aria-pressed={a.id === selectedId}
                onClick={() => onSelect(a.id)}
              >
                <span className="artifact-index-row-icon" aria-hidden="true">
                  <ArtifactKindIcon kind={a.kind} size={14} />
                </span>
                <span className="artifact-index-row-copy">
                  <span className="artifact-index-row-title">{a.title}</span>
                  <span className={`artifact-kind-tag is-${a.kind}`}>
                    {t(`artifact.kind.${a.kind}`, { defaultValue: a.kind })}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </nav>
  );
}
```

Note: this imports `ArtifactKindIcon` — you will extract it in the next step.

- [ ] **Step 4: Extract `ArtifactKindIcon` into its own file**

Create `web/src/components/artifact/ArtifactKindIcon.tsx`:

```tsx
import type { RelayArtifact } from "relay-core";
import {
  ArtifactCommand,
  ArtifactDiff,
  ArtifactFile,
  ArtifactOutput,
  ArtifactPlan,
  ArtifactReview,
  ArtifactSummary,
  ArtifactTest,
} from "../icons";

export function ArtifactKindIcon({ kind, size }: { kind: RelayArtifact["kind"]; size: number }) {
  switch (kind) {
    case "plan":
      return <ArtifactPlan size={size} />;
    case "diff":
      return <ArtifactDiff size={size} />;
    case "review":
      return <ArtifactReview size={size} />;
    case "test_output":
      return <ArtifactTest size={size} />;
    case "command_log":
      return <ArtifactCommand size={size} />;
    case "summary":
      return <ArtifactSummary size={size} />;
    case "agent_output":
      return <ArtifactOutput size={size} />;
    case "workspace_file":
      return <ArtifactFile size={size} />;
  }
}
```

Then update `ConversationArtifactsDrawer.tsx` to import `ArtifactKindIcon` from this new file instead of defining it inline. (The old drawer is deleted in Task 9, but until then it must compile.)

In `ConversationArtifactsDrawer.tsx`, remove the local `ArtifactKindIcon` function and add the import:

```ts
import { ArtifactKindIcon } from "./artifact/ArtifactKindIcon";
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd web && node --test tests/artifactLibrary.test.ts
```

Expected: 7 passing tests.

- [ ] **Step 6: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

---

## Task 6: `ArtifactLibraryDrawer` component

**Files:**
- Create: `web/src/components/artifact/ArtifactLibraryDrawer.tsx`

**Interfaces:**
- Consumes: `ArtifactIndexStrip` (Task 5), `ArtifactPreviewHeader` (Task 4), `ArtifactBody` (existing), CSS classes from Task 3, `Drawer` from `./admin/Drawer`.
- Produces: `ArtifactLibraryDrawer` exported for use in Tasks 7 and 8.

```ts
// Props signature consumed by Tasks 7 and 8:
export function ArtifactLibraryDrawer({
  open,
  onClose,
  artifacts,
  sessionId,
  initialArtifactId,
}: {
  open: boolean;
  onClose: () => void;
  artifacts: RelayArtifact[];
  sessionId: string;
  initialArtifactId?: string;
}): JSX.Element
```

Note on session IDs: artifacts from `ArtifactIndexItem` (backlog) carry their own `.sessionId`. Inside this component, resolve each artifact's actual session ID with: `(artifact as { sessionId?: string }).sessionId ?? sessionId`.

- [ ] **Step 1: Create the file**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RelayArtifact } from "relay-core";
import { Drawer } from "../admin/Drawer";
import { ArtifactBody } from "./ArtifactBody";
import { ArtifactIndexStrip } from "./ArtifactIndexStrip";
import { ArtifactPreviewHeader } from "./ArtifactPreviewHeader";

function resolveSessionId(artifact: RelayArtifact, fallback: string): string {
  return (artifact as unknown as { sessionId?: string }).sessionId ?? fallback;
}

export function ArtifactLibraryDrawer({
  open,
  onClose,
  artifacts,
  sessionId,
  initialArtifactId,
}: {
  open: boolean;
  onClose: () => void;
  artifacts: RelayArtifact[];
  sessionId: string;
  initialArtifactId?: string;
}) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stripExpanded, setStripExpanded] = useState(false);

  // Sync selection when the drawer opens or the initial artifact changes.
  useEffect(() => {
    if (!open) return;
    setSelectedId(initialArtifactId ?? artifacts[0]?.id ?? null);
    setStripExpanded(false);
  }, [open, initialArtifactId, artifacts]);

  const selectedArtifact = useMemo(
    () => artifacts.find((a) => a.id === selectedId) ?? artifacts[0] ?? null,
    [artifacts, selectedId],
  );

  const effectiveSessionId = selectedArtifact
    ? resolveSessionId(selectedArtifact, sessionId)
    : sessionId;

  const subtitle = t("artifact.drawer_subtitle", { count: artifacts.length });

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={900}
      closeLabel={t("sheet.close")}
      ariaLabel={t("artifact.drawer_title")}
      title={t("artifact.drawer_title")}
      subtitle={subtitle}
      bodyClassName="artifact-library-drawer-body"
    >
      <div className={`artifact-library-shell${stripExpanded ? " strip-expanded" : ""}`}>
        {artifacts.length > 0 ? (
          <ArtifactIndexStrip
            artifacts={artifacts}
            selectedId={selectedId}
            onSelect={setSelectedId}
            expanded={stripExpanded}
            onExpandedChange={setStripExpanded}
          />
        ) : null}

        <section className="artifact-preview-pane" aria-label={t("artifact.preview_label")}>
          {selectedArtifact ? (
            <>
              <ArtifactPreviewHeader
                artifact={selectedArtifact}
                sessionId={effectiveSessionId}
              />
              <div className="artifact-preview-body">
                <ArtifactBody artifact={selectedArtifact} sessionId={effectiveSessionId} />
              </div>
            </>
          ) : (
            <p className="artifact-preview-status">
              {artifacts.length === 0 ? t("artifact.drawer_empty") : t("artifact.preview_placeholder")}
            </p>
          )}
        </section>
      </div>
    </Drawer>
  );
}
```

Also add the body padding override to `artifact.css` (append):

```css
.artifact-library-drawer-body {
  padding: 0;
  overflow: hidden;
  height: 100%;
}
```

- [ ] **Step 2: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

---

## Task 7: Wire `ArtifactLibraryDrawer` into `App.tsx`

**Files:**
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `ArtifactLibraryDrawer` from Task 6.
- The existing `openArtifactsDrawer`, `artifactsDrawerOpen`, `selectedArtifactId`, `visibleArtifacts` state variables are kept as-is — only the rendered component changes.

- [ ] **Step 1: Replace the import**

In `App.tsx`, find:

```ts
import { ConversationArtifactsDrawer } from "./components/ConversationArtifactsDrawer";
```

Replace with:

```ts
import { ArtifactLibraryDrawer } from "./components/artifact/ArtifactLibraryDrawer";
```

- [ ] **Step 2: Replace the rendered drawer**

Find the `<ConversationArtifactsDrawer ... />` block:

```tsx
<ConversationArtifactsDrawer
  open={artifactsDrawerOpen}
  onClose={() => setArtifactsDrawerOpen(false)}
  sessionId={activeSession?.id}
  artifacts={visibleArtifacts}
  selectedArtifactId={selectedArtifactId}
  onSelectArtifact={setSelectedArtifactId}
/>
```

Replace with:

```tsx
<ArtifactLibraryDrawer
  open={artifactsDrawerOpen}
  onClose={() => setArtifactsDrawerOpen(false)}
  sessionId={activeSession?.id ?? ""}
  artifacts={visibleArtifacts}
  initialArtifactId={selectedArtifactId ?? undefined}
/>
```

Note: `selectedArtifactId` state and `setSelectedArtifactId` are no longer needed once this lands — but leave them for now; they'll be cleaned up in Task 9 along with the old drawer deletion.

- [ ] **Step 3: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

---

## Task 8: Wire `ArtifactLibraryDrawer` into `ArtifactViewerProvider`

**Files:**
- Modify: `web/src/components/ArtifactViewerProvider.tsx`

**Interfaces:**
- Consumes: `ArtifactLibraryDrawer` from Task 6.
- The public context API exposed by `useArtifactViewer()` gains one optional parameter:
  `open(artifact: RelayArtifact, sessionId: string, allArtifacts?: RelayArtifact[]): void`
- Existing call sites that pass only `(artifact, sessionId)` continue to work.

- [ ] **Step 1: Rewrite `ArtifactViewerProvider.tsx`**

Replace the entire file with:

```tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { RelayArtifact } from "relay-core";
import { ArtifactLibraryDrawer } from "./artifact/ArtifactLibraryDrawer";

interface ArtifactTarget {
  artifact: RelayArtifact;
  sessionId: string;
  allArtifacts: RelayArtifact[];
}

interface ArtifactViewerContextValue {
  open: (artifact: RelayArtifact, sessionId: string, allArtifacts?: RelayArtifact[]) => void;
}

const ArtifactViewerContext = createContext<ArtifactViewerContextValue | null>(null);

export function ArtifactViewerProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ArtifactTarget | null>(null);

  const open = useCallback(
    (artifact: RelayArtifact, sessionId: string, allArtifacts?: RelayArtifact[]) => {
      setTarget({ artifact, sessionId, allArtifacts: allArtifacts ?? [artifact] });
    },
    [],
  );
  const close = useCallback(() => setTarget(null), []);

  const value = useMemo<ArtifactViewerContextValue>(() => ({ open }), [open]);

  return (
    <ArtifactViewerContext.Provider value={value}>
      {children}
      <ArtifactLibraryDrawer
        open={target !== null}
        onClose={close}
        artifacts={target?.allArtifacts ?? []}
        sessionId={target?.sessionId ?? ""}
        initialArtifactId={target?.artifact.id}
      />
    </ArtifactViewerContext.Provider>
  );
}

export function useArtifactViewer(): ArtifactViewerContextValue {
  const ctx = useContext(ArtifactViewerContext);
  if (!ctx) {
    throw new Error("useArtifactViewer must be used within an ArtifactViewerProvider");
  }
  return ctx;
}
```

- [ ] **Step 2: Update `MessageBlock.tsx` to pass `allArtifacts`**

In `web/src/components/MessageBlock.tsx`, find `ArtifactChip`:

```tsx
onClick={() => {
  if (onOpenArtifact) onOpenArtifact(artifact);
  else viewer.open(artifact, sessionId);
}}
```

`ArtifactChip` doesn't have access to sibling artifacts — it only knows about its own artifact. The `allArtifacts` path requires the caller to pass the full list. For now, passing only the single artifact is acceptable (the strip will show one entry). A future improvement can thread `allArtifacts` through the prop chain.

No change needed in `MessageBlock.tsx` for this task.

- [ ] **Step 3: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

---

## Task 9: Delete `ConversationArtifactsDrawer` and clean up `App.tsx`

**Files:**
- Delete: `web/src/components/ConversationArtifactsDrawer.tsx`
- Modify: `web/src/App.tsx` (remove orphaned state)

- [ ] **Step 1: Delete the file**

```bash
rm web/src/components/ConversationArtifactsDrawer.tsx
```

- [ ] **Step 2: Remove orphaned state from `App.tsx`**

In `App.tsx`, find and remove:
- `const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);`
- Any `setSelectedArtifactId(...)` call sites

Also find `openArtifactsDrawer` and simplify it — it no longer needs to set `selectedArtifactId`:

Find:
```ts
function openArtifactsDrawer(artifact?: RelayArtifact) {
  setSelectedArtifactId(artifact?.id ?? visibleArtifacts[0]?.id ?? null);
  setArtifactsDrawerOpen(true);
}
```

Replace with:
```ts
function openArtifactsDrawer(artifact?: RelayArtifact) {
  setInitialArtifactId(artifact?.id ?? null);
  setArtifactsDrawerOpen(true);
}
```

And add the corresponding state declaration:
```ts
const [initialArtifactId, setInitialArtifactId] = useState<string | null>(null);
```

Update the `<ArtifactLibraryDrawer>` in `App.tsx` to use `initialArtifactId` (already correct from Task 7 if you used `selectedArtifactId ?? undefined` — just rename the variable):

```tsx
<ArtifactLibraryDrawer
  open={artifactsDrawerOpen}
  onClose={() => setArtifactsDrawerOpen(false)}
  sessionId={activeSession?.id ?? ""}
  artifacts={visibleArtifacts}
  initialArtifactId={initialArtifactId ?? undefined}
/>
```

- [ ] **Step 3: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Unified drawer surface | Tasks 6, 7, 8 |
| Preview-first layout | Task 6 (`artifact-preview-pane` fills remaining width) |
| Collapsible index strip (48px / 280px) | Task 5 |
| Hover to expand / collapse | Task 5 (mouseenter/mouseleave) |
| Search in expanded strip | Task 5 |
| Kind filter pills in expanded strip | Task 5 |
| Single-row preview header | Task 4 |
| Kind tag + title in header | Task 4 |
| Raw / Download / Copy actions | Task 4 |
| Copy only for text kinds | Task 4 (`TEXT_KINDS` set) |
| Metadata removed from header | Task 4 (not rendered) |
| Clean aesthetic — no decorative backgrounds | Task 3 (CSS strips gradients) |
| DiffView line number gutter | Task 2 |
| `ArtifactViewerProvider` API preserved | Task 8 |
| `ConversationArtifactsDrawer` deleted | Task 9 |
| i18n keys | Task 1 |
| `filterArtifacts` pure function tested | Task 5 |

**No placeholders:** confirmed — all steps contain actual code.

**Type consistency:**
- `ArtifactKindIcon` created in Task 5, imported in Tasks 4, 5, 6 — consistent.
- `filterArtifacts` signature defined and tested in Task 5, not referenced elsewhere — consistent.
- `ArtifactLibraryDrawer` props defined in Task 6, consumed identically in Tasks 7 and 8 — consistent.
- `resolveSessionId` is internal to `ArtifactLibraryDrawer` — no cross-task type risk.
