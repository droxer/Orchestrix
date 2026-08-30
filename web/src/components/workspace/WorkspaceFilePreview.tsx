"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProjectWorkspaceFileResponse } from "../../types";
import { formatBytes } from "../../lib/workspaceFormat";
import { WorkspaceLoading } from "./WorkspacePrimitives";
import {
  CodeView,
  imageMimeForFile,
  isHtmlFile,
  isMarkdownFile,
  isPdfFile,
  isRenderableFile,
  languageForFile,
} from "../CodeView";
import { Markdown } from "../Markdown";

/* One workspace file on screen — rendered when the type has a presentation,
   source otherwise. Shared by the full-page workspace tab and the thread
   output panel so a file reads the same wherever it is opened. */

export function WorkspaceFilePreview({
  name,
  data,
  isLoading,
  error,
}: {
  name: string;
  data?: ProjectWorkspaceFileResponse;
  isLoading: boolean;
  error: unknown;
}) {
  const { t, i18n } = useTranslation();
  const renderable = isRenderableFile(name);
  const [rendered, setRendered] = useState(renderable);
  useEffect(() => {
    setRendered(renderable);
  }, [name, renderable]);

  if (isLoading) {
    return <WorkspaceLoading label={t("workspace.loading_preview")} />;
  }
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    return <p className="artifact-viewer-status artifact-viewer-error">{message}</p>;
  }
  if (!data) return null;
  if (data.isBinary) {
    const imageMime = imageMimeForFile(name);
    const media = data.contentBase64
      ? imageMime
        ? { kind: "image" as const, src: `data:${imageMime};base64,${data.contentBase64}` }
        : isPdfFile(name)
          ? { kind: "pdf" as const, src: `data:application/pdf;base64,${data.contentBase64}` }
          : null
      : null;
    if (!media) {
      return <p className="artifact-viewer-status">{t("workspace.binary_file")}</p>;
    }
    return (
      <div className="workspace-preview-viewport is-bleed">
        <div className="artifact-viewer-body is-bleed">
          {media.kind === "image" ? (
            <img className="artifact-image-preview" src={media.src} alt={name} />
          ) : (
            <iframe className="artifact-frame-preview" title={name} src={media.src} />
          )}
          {data.truncated ? (
            <p className="workspace-preview-truncated">{t("workspace.file_truncated", { limit: formatBytes(data.limitBytes, i18n.language) })}</p>
          ) : null}
        </div>
      </div>
    );
  }
  if (!data.content || !data.content.trim()) {
    return <p className="artifact-viewer-status">{t("workspace.empty_file")}</p>;
  }
  const showRendered = renderable && rendered;
  const bleed = showRendered && (isMarkdownFile(name) || isHtmlFile(name));
  return (
    <div className={`workspace-preview-viewport${bleed ? " is-bleed" : ""}`}>
      {renderable ? (
        // Always in-flow, never floating: a floating variant made the toggle
        // overlay the content in Rendered mode but sit in normal flow in
        // Source mode, so the control visibly jumped position on toggle.
        <div
          className="code-view-toolbar"
          role="group"
          aria-label={t("workspace.view_mode")}
        >
          <button
            type="button"
            className={`code-view-toggle${rendered ? " is-active" : ""}`}
            aria-pressed={rendered}
            onClick={() => setRendered(true)}
          >
            {t("workspace.view_rendered")}
          </button>
          <button
            type="button"
            className={`code-view-toggle${rendered ? "" : " is-active"}`}
            aria-pressed={!rendered}
            onClick={() => setRendered(false)}
          >
            {t("workspace.view_source")}
          </button>
        </div>
      ) : null}
      <div className={`artifact-viewer-body${bleed ? " is-bleed" : ""}`}>
        {showRendered && isMarkdownFile(name) ? (
          <Markdown text={data.content} variant="document" />
        ) : showRendered && isHtmlFile(name) ? (
          <HtmlPreview html={data.content} title={name} />
        ) : (
          <CodeView code={data.content} language={languageForFile(name)} />
        )}
        {data.truncated ? (
          <p className="workspace-preview-truncated">{t("workspace.file_truncated", { limit: formatBytes(data.limitBytes, i18n.language) })}</p>
        ) : null}
      </div>
    </div>
  );
}

function HtmlPreview({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      className="html-preview"
      title={title}
      sandbox=""
      srcDoc={html}
    />
  );
}
