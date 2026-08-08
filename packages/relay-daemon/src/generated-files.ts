import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { DaemonGeneratedFile } from "relay-core";

/**
 * Workspace document detection for daemon runs.
 *
 * The daemon snapshots document-type files before a run and diffs after a
 * successful one, reporting new/changed files in its run.completed event so
 * the backend can index them as workspace artifacts without needing access to
 * this machine's filesystem. Small files are shipped inline (base64) so the
 * backend can keep serving them after the workspace copy changes or is
 * deleted.
 */

export const GENERATED_FILE_EXTENSIONS = new Set([
  ".csv",
  ".doc",
  ".docx",
  ".gif",
  ".html",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".ppt",
  ".pptx",
  ".svg",
  ".tsv",
  ".webp",
  ".xls",
  ".xlsx",
  ".zip",
]);

const OUTPUT_FILE_TEXT_EXTENSIONS = new Set([
  ".json",
  ".log",
  ".md",
  ".txt",
]);

export const GENERATED_FILE_EXCLUDED_DIRS = new Set([
  ".cache",
  ".git",
  ".gradle",
  ".mypy_cache",
  ".next",
  ".oci",
  ".pytest_cache",
  ".relay",
  ".ruff_cache",
  ".tox",
  ".turbo",
  ".venv",
  "__pycache__",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "venv",
]);

export const GENERATED_FILE_LIMIT = 20;
/** Per-file inline snapshot cap; larger files are reported metadata-only. */
export const GENERATED_FILE_CONTENT_MAX_BYTES = 2 * 1024 * 1024;
/** Total inline content budget per run.completed event. */
export const GENERATED_FILE_CONTENT_TOTAL_MAX_BYTES = 8 * 1024 * 1024;
/** Walk bound so a pathological workspace cannot stall the daemon. */
export const GENERATED_FILE_WALK_MAX_ENTRIES = 50_000;

const CONTENT_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".svg": "image/svg+xml",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};

export interface GeneratedFileCandidate {
  path: string;
  relativePath: string;
  title: string;
  bytes: number;
  mtimeMs: number;
  contentType: string;
}

export type GeneratedFileSnapshot = Record<string, { mtimeMs: number; bytes: number }>;

export interface GeneratedFileScanOptions {
  /**
   * The running agent's own personal-home subdir (slash-separated, e.g.
   * "agents/agent-<b64>"). When set, sibling agents/* homes are skipped so a
   * concurrent agent's private files are never attributed to this run.
   */
  ownAgentHomeSubdir?: string;
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * Text documents count only near a workspace root: directly in the thread
 * workspace, directly in the running agent's own home, or under an `output/`
 * directory in either. Paths are thread-relative here, so an agent that writes
 * `guide.md` beside its work is reported, while `somecheckout/README.md` — a
 * repo file the run merely touched — is not. Mirrored in
 * `_is_generated_artifact_path` (backend/relay/daemon_registry/artifacts.py);
 * change both together.
 */
function isTextDocumentFile(relativePath: string, extension: string): boolean {
  if (!OUTPUT_FILE_TEXT_EXTENSIONS.has(extension)) return false;
  const parts = relativePath.split("/");
  const scoped =
    parts.length >= 3 && parts[0] === "agents" && parts[1].startsWith("agent-")
      ? parts.slice(2)
      : parts;
  return scoped.length === 1 || scoped[0] === "output";
}

function isSiblingAgentHome(relativeDir: string, ownAgentHomeSubdir: string | undefined): boolean {
  if (!ownAgentHomeSubdir) return false;
  if (!/^agents\/[^/]+$/.test(relativeDir)) return false;
  return relativeDir !== ownAgentHomeSubdir;
}

function listCandidates(
  workspacePath: string | undefined,
  options: GeneratedFileScanOptions = {},
): GeneratedFileCandidate[] {
  if (!workspacePath) return [];
  const ownAgentHomeSubdir = options.ownAgentHomeSubdir?.split(sep).join("/");
  const files: GeneratedFileCandidate[] = [];
  let visited = 0;
  const pending: string[] = [workspacePath];
  try {
    if (!lstatSync(workspacePath).isDirectory()) return [];
  } catch {
    return [];
  }
  while (pending.length > 0) {
    const dir = pending.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (visited >= GENERATED_FILE_WALK_MAX_ENTRIES) return files;
      visited += 1;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        const relativeDir = relative(workspacePath, path).split(sep).join("/");
        if (GENERATED_FILE_EXCLUDED_DIRS.has(entry.name)) continue;
        if (isSiblingAgentHome(relativeDir, ownAgentHomeSubdir)) continue;
        pending.push(path);
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith("~$")) continue;
      const extension = fileExtension(entry.name);
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const relativePath = relative(workspacePath, path).split(sep).join("/");
      if (!GENERATED_FILE_EXTENSIONS.has(extension) && !isTextDocumentFile(relativePath, extension)) continue;
      files.push({
        path,
        relativePath,
        title: entry.name,
        bytes: stat.size,
        mtimeMs: stat.mtimeMs,
        contentType: CONTENT_TYPES[extension] ?? "application/octet-stream",
      });
    }
  }
  return files;
}

export function snapshotGeneratedFiles(
  workspacePath: string | undefined,
  options: GeneratedFileScanOptions = {},
): GeneratedFileSnapshot {
  const snapshot: GeneratedFileSnapshot = {};
  for (const item of listCandidates(workspacePath, options)) {
    snapshot[item.path] = { mtimeMs: item.mtimeMs, bytes: item.bytes };
  }
  return snapshot;
}

export function diffGeneratedFiles(
  workspacePath: string | undefined,
  before: GeneratedFileSnapshot,
  options: GeneratedFileScanOptions = {},
): DaemonGeneratedFile[] {
  const changed = listCandidates(workspacePath, options)
    .filter((item) => {
      const previous = before[item.path];
      return !previous || previous.mtimeMs !== item.mtimeMs || previous.bytes !== item.bytes;
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, GENERATED_FILE_LIMIT);

  let contentBudget = GENERATED_FILE_CONTENT_TOTAL_MAX_BYTES;
  return changed.map((item) => {
    const file: DaemonGeneratedFile = {
      relativePath: item.relativePath,
      title: item.title,
      bytes: item.bytes,
      contentType: item.contentType,
    };
    if (item.bytes <= GENERATED_FILE_CONTENT_MAX_BYTES && item.bytes <= contentBudget) {
      try {
        const body = readFileSync(item.path);
        file.contentBase64 = body.toString("base64");
        file.bytes = body.length;
        contentBudget -= body.length;
      } catch {
        // The file vanished between the walk and the read; report metadata only.
      }
    }
    return file;
  });
}
