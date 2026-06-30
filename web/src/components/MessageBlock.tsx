import { StreamAttachment } from "./icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AgentMark } from "./AgentMark";
import { AgentStream } from "./AgentStream";
import type { AgentName } from "../types";
import { AGENT_NAMES } from "../types";
import { agentLabel, parsePlanSteps, type PlanStep } from "../lib/plan";
import type { RelayArtifact } from "relay-core";
import { useArtifactBody } from "../lib/useArtifactBody";
import { summarizeArtifact } from "../lib/artifactStats";
import { useArtifactViewer } from "./ArtifactViewerProvider";
import type { DerivedMessage } from "../lib/projectMessages";
export { isGroupedContinuation, projectMessages } from "../lib/projectMessages";
export type { DerivedMessage } from "../lib/projectMessages";

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

// Plan artifacts render inline as a human-readable step summary; they carry a
// short JSON assignment list rather than a body worth opening in the viewer.
function PlanCard({ artifact, sessionId }: { artifact: RelayArtifact; sessionId: string }) {
  const body = useArtifactBody(sessionId, artifact.id);
  const planSteps = body.isSuccess ? parsePlanSteps(body.data ?? "", AGENT_NAMES) : null;

  // Until the body resolves, render a compact placeholder so the common
  // single-step case never flashes wider chrome.
  if (!planSteps) {
    return <div className="artifact-plan-note artifact-plan-note-loading">{artifact.title}</div>;
  }
  return (
    <div className="artifact-plan-note">
      <span className="artifact-plan-note-label">{artifact.title}</span>
      <PlanSummary steps={planSteps} />
    </div>
  );
}

function ArtifactCard({ artifact, sessionId }: { artifact: RelayArtifact; sessionId: string }) {
  if (artifact.kind === "plan") {
    return <PlanCard artifact={artifact} sessionId={sessionId} />;
  }
  return <ArtifactChip artifact={artifact} sessionId={sessionId} />;
}

function ArtifactChip({ artifact, sessionId }: { artifact: RelayArtifact; sessionId: string }) {
  const { t } = useTranslation();
  const viewer = useArtifactViewer();
  const shouldLoadBody = artifact.kind !== "workspace_file";

  // The body is loaded once (shared with the viewer drawer) so the chip can
  // show a semantic stat — +/−, pass/fail — instead of raw byte size.
  const body = useArtifactBody(sessionId, artifact.id, { enabled: shouldLoadBody });
  const stat = shouldLoadBody && body.isSuccess ? summarizeArtifact(artifact.kind, body.data ?? "") : null;
  const kindLabel = t(`artifact.kind.${artifact.kind}`, { defaultValue: artifact.kind });

  return (
    <article className="artifact-chip" data-kind={artifact.kind}>
      <button
        type="button"
        className="artifact-chip-main"
        onClick={() => viewer.open(artifact, sessionId)}
        aria-label={t("artifact.view_named", { title: artifact.title })}
      >
        <span className="artifact-chip-icon" aria-hidden="true">
          <StreamAttachment size={15} />
        </span>
        <span className="artifact-chip-copy">
          <span className="artifact-chip-kicker">
            <span className={`artifact-kind-tag is-${artifact.kind}`}>{kindLabel}</span>
            {stat ? (
              <span className={`artifact-stat tone-${stat.tone}`}>{t(`artifact.stat.${stat.key}`, stat.vars)}</span>
            ) : (
              <span className="artifact-stat tone-neutral">{formatArtifactSize(artifact.bytes, t)}</span>
            )}
            <span aria-hidden="true">·</span>
            <time dateTime={artifact.createdAt}>{formatTime(artifact.createdAt)}</time>
          </span>
          <strong>{artifact.title}</strong>
        </span>
        <span className="artifact-chip-cta" aria-hidden="true">{t("artifact.view")}</span>
      </button>
    </article>
  );
}

type MessageBlockProps = {
  message: DerivedMessage;
  sessionId: string;
  grouped?: boolean;
};

export function MessageBlock({
  message,
  sessionId,
  grouped = false,
}: MessageBlockProps) {
  const { t } = useTranslation();
  if (message.kind === "user") {
    return (
      <article className="msg msg-user">
        <span className="rail-node rail-node-user" aria-hidden="true" />
        <div className="turn-body">
          <header>
            <span className="turn-who" translate="no">{t("message.user_label")}</span>
            <time className="mono">{formatTime(message.timestamp)}</time>
          </header>
          <p className="user-text">{message.text}</p>
        </div>
      </article>
    );
  }

  if (message.kind === "agent") {
    return (
      <article
        className={`msg msg-agent ${message.streaming ? "streaming" : ""} ${grouped ? "grouped" : ""}`}
      >
        <span className="rail-node rail-node-agent" aria-hidden="true">
          <AgentMark agent={message.agent} size={12} />
        </span>
        <div className="turn-body">
          <header>
            <span className="agent-title" translate="no">
              {message.agent}
              <span className="agent-mode" data-mode={message.mode}>{message.mode}</span>
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
