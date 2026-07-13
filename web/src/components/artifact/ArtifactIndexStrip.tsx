import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { RelayArtifact } from "relay-core";
import {
  ActionSearch,
  ArtifactCommand,
  ArtifactDiff,
  ArtifactFile,
  ArtifactOutput,
  ArtifactPlan,
  ArtifactReview,
  ArtifactSummary,
  ArtifactTest,
} from "../icons";
import { filterArtifacts } from "../../lib/artifactFilters";
import { Button } from "../ui/button";
export { filterArtifacts } from "../../lib/artifactFilters";

function ArtifactKindIcon({ kind, size }: { kind: RelayArtifact["kind"]; size: number }) {
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
      className={`artifact-index-strip${expanded ? " is-expanded" : ""}`}
      aria-label={t("artifact.strip_label")}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Collapsed: icon buttons only */}
      <div className="artifact-index-strip-icons">
        {artifacts.map((a) => (
          <Button variant="ghost"
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
          </Button>
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
            <Button variant="ghost"
              type="button"
              className={`artifact-index-filter-btn${kindFilter === "all" ? " is-active" : ""}`}
              onClick={() => setKindFilter("all")}
            >
              {t("artifact.filter_all")}
            </Button>
            {kinds.map((k) => (
              <Button variant="ghost"
                key={k}
                type="button"
                className={`artifact-index-filter-btn${kindFilter === k ? " is-active" : ""}`}
                onClick={() => setKindFilter(k)}
              >
                {t(`artifact.kind.${k}`, { defaultValue: k })}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="artifact-index-list">
          {filtered.length === 0 ? (
            <p className="artifact-index-empty">{t("artifact.no_matches")}</p>
          ) : (
            filtered.map((a) => (
              <Button variant="ghost"
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
              </Button>
            ))
          )}
        </div>
      </div>
    </nav>
  );
}
