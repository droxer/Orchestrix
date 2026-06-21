import { useEffect, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, StreamAttachment } from "./icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AgentMark } from "./AgentMark";
import { AgentStream } from "./AgentStream";
import type { AgentName } from "../types";
import { AGENT_NAMES } from "../types";
import { agentLabel, parsePlanSteps, type PlanStep } from "../lib/plan";
import type { RelayArtifact } from "relay-core";
import { readArtifactText } from "../api";
import type { DerivedMessage } from "../lib/projectMessages";
export { isGroupedContinuation, projectMessages } from "../lib/projectMessages";
export type { DerivedMessage } from "../lib/projectMessages";

const ARTIFACT_PREVIEW_LIMIT = 12_000;

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatArtifactSize(bytes: number | undefined, t: TFunction): string {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) return t("artifact.size_unknown");
  const units = [
    { key: "mb", value: 1024 * 1024 },
    { key: "kb", value: 1024 },
  ] as const;
  const unit = units.find((item) => bytes >= item.value);
  if (unit) {
    const value = new Intl.NumberFormat(document.documentElement.lang || undefined, {
      maximumFractionDigits: bytes >= unit.value * 10 ? 0 : 1,
    }).format(bytes / unit.value);
    return t(`artifact.size_${unit.key}`, { count: value });
  }
  return t("artifact.size_bytes", {
    count: new Intl.NumberFormat(document.documentElement.lang || undefined).format(bytes),
  });
}

function artifactRawHref(sessionId: string, artifactId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}`;
}

function AgentAvatarIcon({ agent }: { agent: AgentName }) {
  return (
    <span className="agent-avatar" data-agent={agent} aria-hidden="true">
      <AgentMark agent={agent} size={18} />
    </span>
  );
}

type ArtifactLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "error"; message: string };

function PlanSummary({ steps }: { steps: PlanStep[] }) {
  const { t } = useTranslation();
  return (
    <ol className="artifact-plan-summary">
      {steps.map((step, index) => (
        <li key={`${step.agent}-${step.mode}-${index}`} className="artifact-plan-item">
          {index > 0 ? <span className="artifact-plan-arrow" aria-hidden="true">→</span> : null}
          <span className="artifact-plan-step">
            <AgentMark agent={step.agent} size={14} />
            <span className="artifact-plan-agent">{agentLabel(step.agent)}</span>
            <span className="artifact-plan-mode">{t(`mode.${step.mode}`)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function ArtifactCard({ artifact, sessionId }: { artifact: RelayArtifact; sessionId: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [loadState, setLoadState] = useState<ArtifactLoadState>({ status: "idle" });
  const previewId = `artifact-preview-${artifact.id}`;
  const kindLabel = t(`artifact.kind.${artifact.kind}`, { defaultValue: artifact.kind });
  const isPlan = artifact.kind === "plan";

  function loadPreview(): void {
    if (loadState.status !== "idle") return;
    setLoadState({ status: "loading" });
    void readArtifactText(sessionId, artifact.id)
      .then((text) => setLoadState({ status: "ready", text }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setLoadState({ status: "error", message });
      });
  }

  // Plan artifacts carry a short JSON assignment list; eagerly load it so the
  // human-readable step summary can render inline without an extra click.
  useEffect(() => {
    if (isPlan) loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlan]);

  const planSteps = isPlan && loadState.status === "ready"
    ? parsePlanSteps(loadState.text, AGENT_NAMES)
    : null;

  function togglePreview(): void {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded) loadPreview();
  }

  const preview = loadState.status === "ready"
    ? loadState.text.length > ARTIFACT_PREVIEW_LIMIT
      ? `${loadState.text.slice(0, ARTIFACT_PREVIEW_LIMIT)}\n\n${t("artifact.preview_truncated")}`
      : loadState.text
    : "";

  // Plan bodies load eagerly; until they resolve render a compact placeholder so
  // the common single-step case never flashes the full card chrome.
  if (isPlan && loadState.status !== "ready" && loadState.status !== "error") {
    return <div className="artifact-plan-note artifact-plan-note-loading">{artifact.title}</div>;
  }

  // A single-step assignment (e.g. the default Claude → action) carries little
  // information, so collapse it to a compact inline note instead of a full card.
  if (planSteps && planSteps.length === 1) {
    return (
      <div className="artifact-plan-note">
        <span className="artifact-plan-note-label">{artifact.title}</span>
        <PlanSummary steps={planSteps} />
      </div>
    );
  }

  return (
    <article className={`artifact-card ${expanded ? "expanded" : ""}`}>
      <div className="artifact-card-main">
        <span className="artifact-card-icon" aria-hidden="true">
          <StreamAttachment size={15} />
        </span>
        <span className="artifact-card-copy">
          <span className="artifact-card-kicker">
            <span>{kindLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{formatArtifactSize(artifact.bytes, t)}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={artifact.createdAt}>{formatTime(artifact.createdAt)}</time>
          </span>
          <strong>{artifact.title}</strong>
        </span>
        <span className="artifact-card-actions">
          <a
            className="artifact-card-link"
            href={artifactRawHref(sessionId, artifact.id)}
            target="_blank"
            rel="noreferrer"
          >
            {t("artifact.open_raw")}
          </a>
          <button
            type="button"
            className="artifact-card-toggle"
            aria-expanded={expanded}
            aria-controls={previewId}
            onClick={togglePreview}
          >
            {expanded ? <ChevronUpIcon size={14} /> : <ChevronDownIcon size={14} />}
            <span>{expanded ? t("artifact.hide_preview") : t("artifact.show_preview")}</span>
          </button>
        </span>
      </div>
      {planSteps ? <PlanSummary steps={planSteps} /> : null}
      {expanded ? (
        <div id={previewId} className="artifact-preview">
          {loadState.status === "loading" ? (
            <p>{t("artifact.loading_preview")}</p>
          ) : loadState.status === "error" ? (
            <p className="artifact-preview-error">{t("artifact.preview_error", { message: loadState.message })}</p>
          ) : (
            <pre>{preview || t("artifact.preview_empty")}</pre>
          )}
        </div>
      ) : null}
    </article>
  );
}

type MessageBlockProps = {
  message: DerivedMessage;
  employeeId: string;
  sessionId: string;
  grouped?: boolean;
};

export function MessageBlock({
  message,
  employeeId,
  sessionId,
  grouped = false,
}: MessageBlockProps) {
  const { t } = useTranslation();
  if (message.kind === "user") {
    return (
      <article className="msg msg-user">
        <span className="user-avatar" aria-hidden="true">{t("message.user_avatar")}</span>
        <div className="bubble">
          <header>
            <span>{t("message.user_label")}</span>
            <time className="mono">{formatTime(message.timestamp)}</time>
          </header>
          <p>{message.text}</p>
        </div>
      </article>
    );
  }

  if (message.kind === "agent") {
    return (
      <article
        className={`msg msg-agent ${message.streaming ? "streaming" : ""} ${grouped ? "grouped" : ""}`}
      >
        <AgentAvatarIcon agent={message.agent} />
        <div className="bubble">
          <header>
            <span>
              {employeeId
                ? t("message.agent_header", { employee: employeeId, agent: message.agent })
                : message.agent}
            </span>
            <time className="mono">{formatTime(message.timestamp)}</time>
          </header>
          <AgentStream
            agent={message.agent}
            stdout={message.stdout}
            stderr={message.stderr}
            streaming={message.streaming}
          />
          {message.attachments.length > 0 ? (
            <div className="attachment-list">
              {message.attachments.map((artifact) => (
                <ArtifactCard key={artifact.id} artifact={artifact} sessionId={sessionId} />
              ))}
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <div className={`msg msg-system tone-${message.tone}`}>
      <span className="msg-system-label">
        <span>{message.label}</span>
      </span>
      {message.detail ? (
        <span className="msg-system-detail">{message.detail}</span>
      ) : null}
      <time className="mono">{formatTime(message.timestamp)}</time>
    </div>
  );
}
