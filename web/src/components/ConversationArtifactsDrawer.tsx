"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RelayArtifact } from "../types";
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
} from "./icons";
import { Drawer } from "./admin/Drawer";
import { ArtifactBody } from "./artifact/ArtifactBody";
import { artifactRawHref } from "../lib/artifactPreview";

type ConversationArtifactsDrawerProps = {
  open: boolean;
  onClose: () => void;
  sessionId: string | undefined;
  artifacts: RelayArtifact[];
  selectedArtifactId: string | null;
  onSelectArtifact: (artifactId: string | null) => void;
};

function formatArtifactTime(value: string, language: string): string {
  return new Intl.DateTimeFormat(language || undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatArtifactSize(bytes: number | undefined, language: string, t: ReturnType<typeof useTranslation>["t"]): string {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) return t("artifact.size_unknown");
  const units = [
    { key: "mb", value: 1024 * 1024 },
    { key: "kb", value: 1024 },
  ] as const;
  const unit = units.find((item) => bytes >= item.value);
  if (unit) {
    const count = new Intl.NumberFormat(language || undefined, {
      maximumFractionDigits: bytes >= unit.value * 10 ? 0 : 1,
    }).format(bytes / unit.value);
    return t(`artifact.size_${unit.key}`, { count });
  }
  return t("artifact.size_bytes", {
    count: new Intl.NumberFormat(language || undefined).format(bytes),
  });
}

function artifactDetail(artifact: RelayArtifact, language: string, t: ReturnType<typeof useTranslation>["t"]): { size: string; path: string } {
  const rawPath = artifact.workspaceRelativePath ?? artifact.path;
  const path = rawPath.split("/").filter(Boolean).at(-1) ?? rawPath;
  return {
    size: formatArtifactSize(artifact.bytes, language, t),
    path,
  };
}

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

export function ConversationArtifactsDrawer({
  open,
  onClose,
  sessionId,
  artifacts,
  selectedArtifactId,
  onSelectArtifact,
}: ConversationArtifactsDrawerProps) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<RelayArtifact["kind"] | "all">("all");

  const kinds = useMemo(() => {
    const seen = new Set<RelayArtifact["kind"]>();
    for (const artifact of artifacts) seen.add(artifact.kind);
    return Array.from(seen);
  }, [artifacts]);

  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? artifacts[0],
    [artifacts, selectedArtifactId],
  );

  useEffect(() => {
    if (!open) return;
    if (!selectedArtifact) {
      onSelectArtifact(null);
      return;
    }
    if (selectedArtifact.id !== selectedArtifactId) {
      onSelectArtifact(selectedArtifact.id);
    }
  }, [onSelectArtifact, open, selectedArtifact, selectedArtifactId]);

  const filteredArtifacts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return artifacts.filter((artifact) => {
      if (kind !== "all" && artifact.kind !== kind) return false;
      if (!needle) return true;
      const path = artifact.workspaceRelativePath ?? artifact.path;
      return `${artifact.title} ${path ?? ""}`.toLowerCase().includes(needle);
    });
  }, [artifacts, kind, query]);

  const subtitle = t("artifact.drawer_subtitle", { count: artifacts.length });
  const selectedKindLabel = selectedArtifact
    ? t(`artifact.kind.${selectedArtifact.kind}`, { defaultValue: selectedArtifact.kind })
    : "";
  const selectedPath = selectedArtifact?.workspaceRelativePath ?? selectedArtifact?.path;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={960}
      closeLabel={t("sheet.close")}
      ariaLabel={t("artifact.drawer_title")}
      title={t("artifact.drawer_title")}
      subtitle={subtitle}
      bodyClassName="conversation-artifacts-drawer-body"
    >
      <div className="conversation-artifacts-shell">
        <aside className="conversation-artifacts-list-pane" aria-label={t("artifact.drawer_list_label")}>
          <form className="conversation-artifacts-search" onSubmit={(event) => event.preventDefault()}>
            <ActionSearch size={15} />
            <input
              aria-label={t("artifact.search_label")}
              autoComplete="off"
              spellCheck={false}
              value={query}
              placeholder={t("artifact.search_placeholder")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </form>
          {kinds.length > 1 ? (
            <div className="conversation-artifacts-filters" aria-label={t("artifact.filter_label")}>
              <button
                type="button"
                className={kind === "all" ? "is-active" : ""}
                aria-pressed={kind === "all"}
                onClick={() => setKind("all")}
              >
                {t("artifact.filter_all")}
              </button>
              {kinds.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={kind === item ? "is-active" : ""}
                  aria-pressed={kind === item}
                  onClick={() => setKind(item)}
                >
                  {t(`artifact.kind.${item}`, { defaultValue: item })}
                </button>
              ))}
            </div>
          ) : null}
          <div className="conversation-artifacts-list">
            {filteredArtifacts.length > 0 ? (
              filteredArtifacts.map((artifact) => {
                const active = artifact.id === selectedArtifact?.id;
                const kindLabel = t(`artifact.kind.${artifact.kind}`, { defaultValue: artifact.kind });
                const detail = artifactDetail(artifact, i18n.language, t);
                return (
                  <button
                    key={artifact.id}
                    type="button"
                    className={`conversation-artifact-row${active ? " is-active" : ""}`}
                    data-kind={artifact.kind}
                    aria-pressed={active}
                    onClick={() => onSelectArtifact(artifact.id)}
                  >
                    <span className="conversation-artifact-row-icon" aria-hidden="true">
                      <ArtifactKindIcon kind={artifact.kind} size={16} />
                    </span>
                    <span className="conversation-artifact-row-copy">
                      <span className="conversation-artifact-row-meta">
                        <span className={`artifact-kind-tag is-${artifact.kind}`}>{kindLabel}</span>
                        <time dateTime={artifact.createdAt}>
                          {formatArtifactTime(artifact.createdAt, i18n.language)}
                        </time>
                      </span>
                      <strong>{artifact.title}</strong>
                      <span className="conversation-artifact-row-detail">
                        <span>{detail.size}</span>
                        <span aria-hidden="true">·</span>
                        <span>{detail.path}</span>
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="conversation-artifacts-empty">
                {artifacts.length === 0 ? t("artifact.drawer_empty") : t("artifact.no_matches")}
              </p>
            )}
          </div>
        </aside>

        <section className="conversation-artifacts-preview" data-kind={selectedArtifact?.kind} aria-label={t("artifact.preview_label")}>
          {selectedArtifact && sessionId ? (
            <>
              <header className="conversation-artifacts-preview-head" data-kind={selectedArtifact.kind}>
                <div className="conversation-artifacts-preview-title">
                  <span className="conversation-artifacts-preview-icon" aria-hidden="true">
                    <ArtifactKindIcon kind={selectedArtifact.kind} size={20} />
                  </span>
                  <div className="conversation-artifacts-preview-copy">
                    <span className={`artifact-kind-tag is-${selectedArtifact.kind}`}>{selectedKindLabel}</span>
                    <h3>{selectedArtifact.title}</h3>
                  </div>
                </div>
                <dl className="conversation-artifacts-preview-meta">
                  <div>
                    <dt>{t("artifact.created")}</dt>
                    <dd>
                      <time dateTime={selectedArtifact.createdAt}>
                        {formatArtifactTime(selectedArtifact.createdAt, i18n.language)}
                      </time>
                    </dd>
                  </div>
                  <div>
                    <dt>{t("artifact.size")}</dt>
                    <dd>{formatArtifactSize(selectedArtifact.bytes, i18n.language, t)}</dd>
                  </div>
                  {selectedPath ? (
                    <div className="conversation-artifacts-preview-path">
                      <dt>{t("artifact.path")}</dt>
                      <dd>{selectedPath}</dd>
                    </div>
                  ) : null}
                </dl>
                <a
                  className="conversation-artifacts-raw"
                  href={artifactRawHref(sessionId, selectedArtifact.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("artifact.open_raw")}
                </a>
              </header>
              <div className="conversation-artifacts-preview-body">
                <ArtifactBody artifact={selectedArtifact} sessionId={sessionId} />
              </div>
            </>
          ) : (
            <p className="conversation-artifacts-empty conversation-artifacts-empty-preview">
              {t("artifact.preview_placeholder")}
            </p>
          )}
        </section>
      </div>
    </Drawer>
  );
}
