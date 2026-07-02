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
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".svg": "image/svg+xml",
  ".tsv": "text/tab-separated-values",
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

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function listCandidates(workspacePath: string | undefined): GeneratedFileCandidate[] {
  if (!workspacePath) return [];
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
        if (!GENERATED_FILE_EXCLUDED_DIRS.has(entry.name)) pending.push(path);
        continue;
      }
      if (!entry.isFile() || entry.name.startsWith("~$")) continue;
      const extension = fileExtension(entry.name);
      if (!GENERATED_FILE_EXTENSIONS.has(extension)) continue;
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      files.push({
        path,
        relativePath: relative(workspacePath, path).split(sep).join("/"),
        title: entry.name,
        bytes: stat.size,
        mtimeMs: stat.mtimeMs,
        contentType: CONTENT_TYPES[extension] ?? "application/octet-stream",
      });
    }
  }
  return files;
}

export function snapshotGeneratedFiles(workspacePath: string | undefined): GeneratedFileSnapshot {
  const snapshot: GeneratedFileSnapshot = {};
  for (const item of listCandidates(workspacePath)) {
    snapshot[item.path] = { mtimeMs: item.mtimeMs, bytes: item.bytes };
  }
  return snapshot;
}

export function diffGeneratedFiles(
  workspacePath: string | undefined,
  before: GeneratedFileSnapshot,
): DaemonGeneratedFile[] {
  const changed = listCandidates(workspacePath)
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
