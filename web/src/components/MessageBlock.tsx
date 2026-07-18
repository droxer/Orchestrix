import { StreamAttachment } from "./icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { UserRound } from "lucide-react";
import { AgentMark } from "./AgentMark";
import { AgentStream } from "./AgentStream";
import { MessageTurnActions } from "./MessageTurnActions";
import type { AgentName, AgentTaskMode } from "../types";
import { AGENT_NAMES } from "../types";
import { labelForExecutor } from "../lib/agentDisplayNames";
import { parsePlanSteps, type PlanStep } from "../lib/plan";
import type { RelayArtifact } from "relay-core";
import { useArtifactBody } from "../lib/useArtifactBody";
import { summarizeArtifact } from "../lib/artifactStats";
import { useArtifactViewer } from "./ArtifactViewerProvider";
import type { DerivedMessage } from "../lib/projectMessages";
import { Button } from "./ui/button";
export { isGroupedContinuation, projectMessages } from "../lib/projectMessages";
export type { DerivedMessage } from "../lib/projectMessages";

function formatTime(value: string): string {
  const date = new Date(value);
  // A malformed event timestamp must not throw mid-render and take the whole
  // transcript down with it.
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
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

function PlanSummary({ steps, agentDisplayNames }: { steps: PlanStep[]; agentDisplayNames?: Partial<Record<AgentName, string>> }) {
  const { t } = useTranslation();
  return (
    <ol className="artifact-plan-summary">
      {steps.map((step, index) => (
        <li key={`${step.agent}-${step.mode}-${index}`} className="artifact-plan-item">
          {index > 0 ? <span className="artifact-plan-arrow" aria-hidden="true">→</span> : null}
          <span className="artifact-plan-step">
            <AgentMark agent={step.agent} size={14} />
            <span className="artifact-plan-agent">{labelForExecutor(step.agent, agentDisplayNames)}</span>
            <span className="artifact-plan-mode">{t(`mode.${step.mode}`)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

// Plan artifacts render inline as a human-readable step summary; they carry a
// short JSON assignment list rather than a body worth opening in the viewer.
function PlanCard({ artifact, sessionId, agentDisplayNames }: { artifact: RelayArtifact; sessionId: string; agentDisplayNames?: Partial<Record<AgentName, string>> }) {
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
      <PlanSummary steps={planSteps} agentDisplayNames={agentDisplayNames} />
    </div>
  );
}

function ArtifactCard({ artifact, sessionId, allArtifacts, onOpenArtifact, agentDisplayNames }: { artifact: RelayArtifact; sessionId: string; allArtifacts?: RelayArtifact[]; onOpenArtifact?: (artifact: RelayArtifact) => void; agentDisplayNames?: Partial<Record<AgentName, string>> }) {
  if (artifact.kind === "plan") {
    return <PlanCard artifact={artifact} sessionId={sessionId} agentDisplayNames={agentDisplayNames} />;
  }
  return <ArtifactChip artifact={artifact} sessionId={sessionId} allArtifacts={allArtifacts} onOpenArtifact={onOpenArtifact} />;
}

// Chips only fetch bodies small enough that the stat is worth the transfer;
// beyond this the chip shows byte size and the drawer fetches on demand.
const ARTIFACT_STAT_FETCH_MAX_BYTES = 256 * 1024;

function ArtifactChip({ artifact, sessionId, allArtifacts, onOpenArtifact }: { artifact: RelayArtifact; sessionId: string; allArtifacts?: RelayArtifact[]; onOpenArtifact?: (artifact: RelayArtifact) => void }) {
  const { t } = useTranslation();
  const viewer = useArtifactViewer();
  const shouldLoadBody =
    artifact.kind !== "workspace_file" &&
    (artifact.bytes === undefined || artifact.bytes <= ARTIFACT_STAT_FETCH_MAX_BYTES);

  // The body is loaded once (shared with the viewer drawer) so the chip can
  // show a semantic stat — +/−, pass/fail — instead of raw byte size.
  const body = useArtifactBody(sessionId, artifact.id, { enabled: shouldLoadBody });
  const stat = shouldLoadBody && body.isSuccess ? summarizeArtifact(artifact.kind, body.data ?? "") : null;
  const kindLabel = t(`artifact.kind.${artifact.kind}`, { defaultValue: artifact.kind });

  return (
    <article className="artifact-chip" data-kind={artifact.kind}>
      <Button variant="ghost"
        type="button"
        className="artifact-chip-main"
        onClick={() => {
          if (onOpenArtifact) onOpenArtifact(artifact);
          else viewer.open(artifact, sessionId, allArtifacts);
        }}
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
      </Button>
    </article>
  );
}

type MessageBlockProps = {
  message: DerivedMessage;
  sessionId: string;
  grouped?: boolean;
  agentDisplayNames?: Partial<Record<AgentName, string>>;
  onOpenArtifact?: (artifact: RelayArtifact) => void;
  onRetryAgent?: (agent: AgentName, mode: AgentTaskMode) => void;
  retryDisabled?: boolean;
};

export function MessageBlock({
  message,
  sessionId,
  grouped = false,
  agentDisplayNames,
  onOpenArtifact,
  onRetryAgent,
  retryDisabled = false,
}: MessageBlockProps) {
  const { t } = useTranslation();
  if (message.kind === "user") {
    return (
      <article className="msg msg-user" aria-label={t("message.user_label")}>
        <span className="rail-node rail-node-user" aria-hidden="true">
          <UserRound size={13} strokeWidth={1.9} />
        </span>
        <div className="turn-body">
          <p className="user-text">{message.text}</p>
        </div>
        <time className="msg-time mono" dateTime={message.timestamp}>{formatTime(message.timestamp)}</time>
      </article>
    );
  }

  if (message.kind === "agent") {
    const agentName = labelForExecutor(message.agent, agentDisplayNames);
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
              {agentName}
            </span>
            {message.streaming ? (
              <span className="agent-live-pulse" aria-label={t("agent_stream.empty_working")} />
            ) : null}
          </header>
          <AgentStream
            agent={message.agent}
            stdout={message.stdout}
            stderr={message.stderr}
            streaming={message.streaming}
            collaborations={message.collaborations}
          />
          {message.attachments.length > 0 ? (
            <div className="attachment-list">
              {message.attachments.map((artifact) => (
                <ArtifactCard key={artifact.id} artifact={artifact} sessionId={sessionId} allArtifacts={message.attachments} onOpenArtifact={onOpenArtifact} agentDisplayNames={agentDisplayNames} />
              ))}
            </div>
          ) : null}
          <MessageTurnActions
            agent={message.agent}
            mode={message.mode}
            stdout={message.stdout}
            stderr={message.stderr}
            streaming={message.streaming}
            retryDisabled={retryDisabled}
            onRetry={onRetryAgent}
          />
        </div>
        <time className="msg-time mono" dateTime={message.timestamp}>{formatTime(message.timestamp)}</time>
      </article>
    );
  }

  // Artifacts created outside an agent run (assignment plans, most notably)
  // render as their card — a plan reads as its step summary, not a bare
  // "Artifact — Plan" line.
  if (message.artifact) {
    return (
      <div className={`msg msg-system msg-system-artifact tone-${message.tone}`}>
        <span className={`rail-node rail-node-system tone-${message.tone}`} aria-hidden="true" />
        <div className="msg-system-body">
          <ArtifactCard artifact={message.artifact} sessionId={sessionId} onOpenArtifact={onOpenArtifact} />
        </div>
        <time className="msg-time mono" dateTime={message.timestamp}>{formatTime(message.timestamp)}</time>
      </div>
    );
  }

  return (
    <div className={`msg msg-system tone-${message.tone}`}>
      <span className={`rail-node rail-node-system tone-${message.tone}`} aria-hidden="true" />
      <div className="msg-system-body">
        <span className="msg-system-label">
          <span>{message.label}</span>
        </span>
        {message.detail ? (
          <span className="msg-system-detail">{message.detail}</span>
        ) : null}
      </div>
      <time className="msg-time mono" dateTime={message.timestamp}>{formatTime(message.timestamp)}</time>
    </div>
  );
}
