# Artifact View Redesign

**Date:** 2026-07-04
**Status:** Approved
**Scope:** `web/` — React components and CSS only. No backend changes.

---

## Problem

The current artifact viewing experience has three compounding problems:

1. **Two separate surfaces.** `ArtifactViewerProvider` (single-artifact dark drawer, 680px) and `ConversationArtifactsDrawer` (list+preview library, 960px) are independent components with inconsistent layouts and no shared navigation. Clicking a chip and clicking "view all" feel like different products.

2. **Preview is buried.** The library drawer gives 30% of its width to a permanently-visible list pane. The content you came to read is always squeezed. The split feels co-equal when the artifact body is the primary value.

3. **Heavy decoration.** Lined-paper backgrounds, color-accent gradient fades in the preview header, bold left-edge accent bars, and a large metadata grid (created / size / path) in the header add visual weight without adding information. The result reads as cluttered rather than calm.

---

## Decision

**Approach: Preview-first, index on demand.**

One unified drawer surface replaces both existing surfaces. It opens to the full artifact preview immediately. Navigation between artifacts is available via a collapsible index strip on the left edge — collapsed by default, expanded on hover. The aesthetic is clean and minimal: no decorative backgrounds, whitespace and typography carry the hierarchy.

---

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  Artifacts  ·  8 items                              [✕]  │
├──┬───────────────────────────────────────────────────────┤
│  │  [diff]  Refactor auth middleware    [↓ raw]  [⧉ ⧉]  │
│  │───────────────────────────────────────────────────────│
│  │                                                       │
│i │                  PREVIEW CONTENT                      │
│n │                                                       │
│d │                                                       │
│e │                                                       │
│x │                                                       │
│  │                                                       │
└──┴───────────────────────────────────────────────────────┘
```

- **Drawer width:** 900px, dark variant.
- **Index strip:** 48px collapsed, 280px expanded.
- **Preview area:** flex-fills remaining width.

---

## Components

### `ArtifactLibraryDrawer` (new)

Replaces both `ArtifactViewerProvider`'s inner drawer and `ConversationArtifactsDrawer`.

**Props:**
```ts
interface ArtifactLibraryDrawerProps {
  open: boolean;
  onClose: () => void;
  artifacts: RelayArtifact[];
  sessionId: string;
  initialArtifactId?: string; // pre-selects on open; defaults to artifacts[0]
}
```

**Internal state:**
- `selectedId: string | null` — tracks active artifact
- `expanded: boolean` — index strip expanded state (hover-driven)
- `query: string` — search within the expanded strip
- `kindFilter: RelayArtifact["kind"] | "all"` — filter within the expanded strip

On open, `selectedId` is set to `initialArtifactId ?? artifacts[0]?.id`.

### `ArtifactIndexStrip` (new, internal)

The left-edge navigation panel.

**Collapsed (48px):**
- Vertically stacked 40×40px icon buttons, one per artifact
- Kind icon centered, tinted with kind accent color (`color-mix` at 70%)
- Active artifact: filled accent background, white icon
- Hover: browser tooltip (`title` attribute) with artifact title
- Independently scrollable if artifacts overflow
- Expands on `mouseenter`, collapses on `mouseleave` with 150ms ease transition

**Expanded (280px):**
- Search input at top
- Kind filter pills below (only if 2+ kinds present)
- List of artifact rows: kind icon + truncated title + kind tag chip
- Active row: subtle background highlight
- Collapses when cursor leaves the 280px panel

### `ArtifactPreviewHeader` (new, internal)

Single-row header above the preview body. Height ~44px.

```
[kind tag]  Title text…                    [↓ Download]  [⧉ Raw]  [⎘ Copy]
```

- Kind tag: colored pill (existing `.artifact-kind-tag` system)
- Title: `--type-label-strong`, truncated with ellipsis, fills available space
- Metadata (created, size, path): removed from header. Available as tooltip on the kind tag if needed in a future iteration.
- Actions (right-aligned):
  - **Raw** — opens raw artifact URL in new tab (existing behavior)
  - **Download** — triggers file download via `<a download>`
  - **Copy** — copies text body to clipboard (only shown for text artifact kinds: diff, review, summary, agent_output, command_log, test_output, plan)
- All actions are small ghost buttons (icon + label, 28px height)

### `ArtifactBody` (unchanged)

The existing renderers — `DiffView`, `TerminalBlock`, `SandboxedHtml`, `PlainBody`, `WorkspaceFileBody` — are kept exactly as-is. The redesign is purely the surrounding chrome.

**One additive change:** `DiffView` gains a line number gutter. A zero-based counter column (dimmed, tabular-nums, non-selectable) is prepended to each diff line. This requires no CSS variable changes — just an additional `<span>` in the existing `artifact-diff-line` grid.

---

## Entry Points

### From a message chip (`ArtifactChip` in `MessageBlock`)

The context API gains one optional parameter:

```ts
open(artifact: RelayArtifact, sessionId: string, allArtifacts?: RelayArtifact[]): void
```

When `allArtifacts` is provided, the library drawer shows all of them with `artifact` pre-selected. When omitted (legacy call sites), the drawer shows only the single artifact — the index strip has one entry, which is fine.

`MessageBlock` already receives `message.attachments` and can pass the full attachment list as `allArtifacts`. The `onOpenArtifact` prop path (used in `BacklogPage`) continues to work unchanged.

### From the task backlog (`BacklogPage`)

The existing `ConversationArtifactsDrawer` import is replaced with `ArtifactLibraryDrawer`. The "view all" button calls open with no `initialArtifactId`.

---

## What Gets Deleted

| File / Class | Fate |
|---|---|
| `ConversationArtifactsDrawer.tsx` | Deleted |
| Inner `<Drawer>` in `ArtifactViewerProvider.tsx` | Replaced by `ArtifactLibraryDrawer` |
| `.conversation-artifacts-shell` and all `.conversation-artifacts-*` CSS | Deleted |
| `.artifact-viewer-drawer-body`, `.artifact-viewer-sub`, `.artifact-viewer-raw` | Deleted |
| Lined-paper `repeating-linear-gradient` backgrounds | Deleted |
| Preview header gradient/accent-bar (`::before` pseudo-element) | Deleted |
| Large metadata `<dl>` block in the preview header | Deleted |
| `conversation-artifacts-preview-head` grid layout | Deleted |

The `.artifact-chip`, `.artifact-kind-tag`, and `.artifact-diff` CSS blocks are kept.

---

## CSS Strategy

New CSS lives in `artifact.css` (existing file). The removed blocks free significant space.

New classes needed:
- `.artifact-library-shell` — outer container, `display: grid; grid-template-columns: 48px 1fr`
- `.artifact-index-strip` — left pane, transitions width between 48px and 280px
- `.artifact-index-strip.is-expanded` — 280px state
- `.artifact-index-btn` — individual icon button in collapsed strip
- `.artifact-index-row` — full list row in expanded strip
- `.artifact-preview-header` — single-row header bar
- `.artifact-preview-body` — content area, `overflow: auto; flex: 1`

No new CSS variables needed — all values come from the existing design token set.

---

## i18n

New keys needed (English):

```json
"artifact.strip_expand": "Browse artifacts",
"artifact.action_download": "Download",
"artifact.action_copy": "Copy",
"artifact.action_raw": "Raw",
"artifact.copied": "Copied!"
```

Existing keys are kept unchanged.

---

## States

| State | Behavior |
|---|---|
| Loading body | Single centered spinner, no text |
| Empty body | "Nothing to preview" in `--color-muted`, centered |
| Error | Error message in `--color-semantic-down` + "Try raw" link |
| No artifacts | Drawer should not be opened; call sites guard against empty `artifacts` array |
| Single artifact | Index strip shows one button; strip expansion still works but is less useful |

---

## Out of Scope

- Artifact editing or commenting
- Artifact comparison (diff between two artifacts)
- Persistent artifact selection across sessions
- Mobile breakpoint (the drawer is desktop-only at 900px; the existing mobile collapse behavior is removed with the old CSS)
