# Workspace Redesign — Inspection Surface

_Date: 2026-06-27 · Component: `web/src/components/EmployeeWorkspacePage.tsx` (`workspace` route) + one new backend endpoint._

## Context & motivation

The current workspace page is an employee **operations dashboard**: identity/node header, four metric tiles, then equal-weight panels for Active Runs, Agent Readiness, Tasks, and a tabbed Artifacts/Files panel (the Threads tab was just removed). Feedback: it's **too cluttered**, has the **wrong purpose**, and removing Threads left the layout unbalanced.

Decision (from brainstorming): the workspace's primary job is **inspecting outputs** — "review what this employee produced." It is re-centered as a **three-pane inspection surface**: an artifact feed, a file browser, and an inline preview pane. The operational panels are cut; identity moves entirely into the route header.

## Goals

- Make reviewing an employee's produced artifacts and workspace files the dominant, focused task.
- Preview artifacts and file contents **inline** (no context switch to a drawer) for an immersive inspection flow.
- Reduce clutter: remove panels that don't serve the inspect job.

## Non-goals

- No change to the global artifact viewer drawer (still used by chat and elsewhere).
- No write/edit of workspace files (read-only inspection).
- No change to how runs/tasks are driven (those live on other surfaces).

## Layout

```
┌───────────────────────────────────────────────────────────────┐
│ PageHeader:  Workspace · @employee                  ⟳ refresh   │
│ Metric strip:  ◷ N runs · N tasks · N sessions · N artifacts    │
├──────────────────┬──────────────────┬──────────────────────────┤
│ ARTIFACTS        │ FILES   / path   │ PREVIEW                   │
│ ▸ plan    2m     │ 📁 components     │  (rich artifact body, or  │
│ ▸ diff    5m     │ 📁 lib            │   file contents, or       │
│ ▸ test    8m     │ 📄 app.tsx  4 KB  │   empty-state prompt)     │
│ newest-first     │ navigate dirs     │                           │
└──────────────────┴──────────────────┴──────────────────────────┘
```

- **Kept:** the four metric counts (`brief.metrics`), slimmed into a single horizontal strip — not large tiles.
- **Cut:** the hero identity block (`workspace-hero`), node-status pill, Active Runs (`workspace-run-list`), Agent Readiness (`workspace-agent-grid`), and Tasks panel. Employee identity stays in `PageHeader` (title + `workspace.sub`).
- The existing **Artifacts** and **Files** tab bodies are promoted to permanent columns; the tab switcher (`workspace-tabs`) is removed.

## Interactions

- **Single active selection** across both lists: `selected: { type: "artifact"; id: string } | { type: "file"; path: string } | null`.
  - Click an artifact → preview renders the artifact body.
  - Click a file (non-directory) → preview renders file contents.
  - Click a directory → Files pane navigates into it (existing `setFilePath` + breadcrumb/up); selection unchanged.
  - Nothing selected → preview shows an empty prompt ("Select an artifact or file to preview").
- **Artifact preview reuses existing rendering** — `useArtifactBody(sessionId, artifactId)` + the `artifact/ArtifactBody` component — so plan/diff/test/log/summary render identically to the drawer, just inline. The workspace no longer calls `artifactViewer.open` for inline review (the drawer remains available globally elsewhere).
- The active list item shows a selected state; preview header shows the item title + kind/path + a "open in viewer" affordance for artifacts (optional, reuses `artifactViewer.open`).

## Data / backend

### New endpoint: `GET /workspace/file`

`backend/relay/api/session_routes.py`, mirroring `/workspace/files`:

- Auth: `request_actor_or_sandbox` + `employee_for_workspace_brief` (an employee can only read its own workspace unless admin).
- Path safety: reuse `workspace_target_path(root, relative_path)`; reject traversal, require `target.is_file()` (404 if missing, 400 if a directory).
- Read cap: `WORKSPACE_FILE_PREVIEW_LIMIT` (256 KB). Read up to the cap; set `truncated: true` if the file is larger.
- Binary detection: null byte in the read window or UTF-8 decode failure → `isBinary: true`, omit `content`.
- Response:
  ```json
  {
    "employeeId": "...", "workspacePath": "...", "path": "src/app.tsx",
    "exists": true, "isBinary": false, "bytes": 4096,
    "content": "…", "truncated": false, "limitBytes": 262144,
    "generatedAt": "…Z"
  }
  ```

### Frontend api

- Add `readWorkspaceFile({ employeeId, path }, signal)` in `web/src/api.ts` → `WorkspaceFileContentResponse` (new type in `web/src/types`).
- The preview pane uses a `useQuery` keyed on `["workspace-file", employeeId, path]`, enabled when a file is selected.
- Text → mono code block with a "truncated" note when applicable; binary → metadata + "binary file — no preview"; load error → inline message.

## Responsive

- **Wide (≥ ~1100px):** three columns (artifacts | files | preview), preview widest.
- **Mid:** artifacts + files stacked in a left column, preview in a right column.
- **Narrow / mobile:** lists stacked single-column; selecting an item opens the preview as a full-width overlay/drawer with a back affordance. Reuse the `@media (pointer: coarse)` 44px target rule already in `workspace.css`.

## Files touched

- `web/src/components/EmployeeWorkspacePage.tsx` — rework to the three-pane surface; add selection state + file-content query; remove hero/node/runs/readiness/tasks; promote artifacts/files to columns; inline preview.
- `web/src/styles/workspace.css` — new three-pane grid + preview styles; remove orphaned CSS for the cut sections (`workspace-hero`, `workspace-node-pill`, `workspace-run*`, `workspace-agent*`, `workspace-metric` tile styling if replaced by the strip, `workspace-tabs`/`workspace-tab*`).
- `web/src/api.ts`, `web/src/types` — `readWorkspaceFile` + `WorkspaceFileContentResponse`.
- `backend/relay/api/session_routes.py` — `GET /workspace/file` + `WORKSPACE_FILE_PREVIEW_LIMIT`.
- i18n: add `workspace.preview_*` / `workspace.binary_file` / `workspace.select_to_preview` keys; prune now-unused keys (`workspace.threads`, `workspace.no_sessions`, `workspace.artifact_count_short`, plus keys for cut sections — agent readiness, active runs, tasks — if no longer referenced).

## Testing

- **Backend** (`backend/tests/`): new endpoint — text file returns content; large file returns `truncated: true`; binary file returns `isBinary: true` without content; path traversal rejected; missing path 404; directory path 400; cross-employee access denied for non-admin.
- **Frontend** (`web/tests/`): selection → preview branch (artifact vs file); empty-state prompt when nothing selected; truncated/binary file rendering; directory click navigates without changing selection.
- Verify: `make web-test`, backend test run, `npm run build -w web`.

## Risks

- The `workspace` route is login-gated, so visual verification needs an authenticated session (`http://127.0.0.1:8790/`). Build + tests gate correctness; a visual pass confirms layout/responsive.
- File-content reads add a new attack surface — mitigated by the existing path-safety helper, the read cap, and the per-employee authz check. No directory escapes; no writes.
