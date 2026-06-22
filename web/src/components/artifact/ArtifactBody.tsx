import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { RelayArtifact } from "relay-core";

import { useArtifactBody } from "../../lib/useArtifactBody";

type DiffLineKind = "add" | "del" | "meta" | "hunk" | "context";

function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
    return "meta";
  }
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

/** Unified diff with per-line add/delete coloring and a gutter. */
function DiffView({ text }: { text: string }) {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  return (
    <div className="artifact-diff" role="img" aria-label="diff">
      {lines.map((line, index) => {
        const kind = classifyDiffLine(line);
        const sign = kind === "add" ? "+" : kind === "del" ? "-" : " ";
        return (
          <div key={index} className={`artifact-diff-line is-${kind}`}>
            <span className="artifact-diff-sign" aria-hidden="true">{sign}</span>
            <span className="artifact-diff-text">{line || " "}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Terminal-styled block for command logs and test output. */
function TerminalBlock({ text }: { text: string }) {
  return (
    <pre className="artifact-terminal">
      <code>{text}</code>
    </pre>
  );
}

/** Plain monospace fallback for summaries, reviews, and raw agent output. */
function PlainBody({ text }: { text: string }) {
  return <pre className="artifact-plain">{text}</pre>;
}

function renderBody(kind: RelayArtifact["kind"], text: string) {
  switch (kind) {
    case "diff":
      return <DiffView text={text} />;
    case "command_log":
    case "test_output":
      return <TerminalBlock text={text} />;
    default:
      return <PlainBody text={text} />;
  }
}

export function ArtifactBody({ artifact, sessionId }: { artifact: RelayArtifact; sessionId: string }) {
  const { t } = useTranslation();
  const query = useArtifactBody(sessionId, artifact.id);

  if (query.isLoading) {
    return <p className="artifact-viewer-status">{t("artifact.loading_preview")}</p>;
  }
  if (query.isError) {
    const message = query.error instanceof Error ? query.error.message : String(query.error);
    return (
      <p className="artifact-viewer-status artifact-viewer-error">
        {t("artifact.preview_error", { message })}
      </p>
    );
  }
  const text = query.data ?? "";
  if (!text.trim()) {
    return <p className="artifact-viewer-status">{t("artifact.preview_empty")}</p>;
  }
  return <div className="artifact-viewer-body">{renderBody(artifact.kind, text)}</div>;
}
