import { StatusError, StatusInfo, StatusOk, StatusWarn } from "./icons";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CodexCollaborationEvent } from "relay-core";

import type { AgentName } from "../types";
import {
  AgentStreamAccumulator,
  displayAgentStreamSegments,
  emptyAgentStreamSegments,
  hasTerminalOutcome,
  parseAgentStderr,
  reasoningDisplay,
  type AgentSegment,
} from "../lib/agentStream";
import { MarkdownContent } from "./Markdown";
import { buildCollaborationTree } from "../lib/collaborationTree";
import { SubagentTree } from "./SubagentTree";
import { useDebouncedStreamingAnnouncement, useSmoothStreamingText } from "../hooks/useSmoothStreamingText";

function StreamActivity({ label }: { label: string }) {
  return (
    <div className="agent-stream-activity" role="status">
      <span className="agent-stream-pulse" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

// Segments carry no ids; stream order is append-mostly, so kind + per-kind
// occurrence is a cheap stable key for React's reconciliation.
function keyedSegments(segments: AgentSegment[]): Array<{ key: string; segment: AgentSegment }> {
  const counts = new Map<string, number>();
  return segments.map((segment) => {
    const seen = counts.get(segment.kind) ?? 0;
    counts.set(segment.kind, seen + 1);
    return { key: `${segment.kind}-${seen}`, segment };
  });
}

type AgentStreamProps = {
  agent: AgentName;
  stdout: string;
  stderr: string;
  streaming: boolean;
  collaborations: CodexCollaborationEvent[];
};

export function AgentStream({ agent, stdout, stderr, streaming, collaborations }: AgentStreamProps) {
  const { t } = useTranslation();
  // Settling can append a completed-log fallback that overlaps live output;
  // rebuild once at that boundary so the final transcript is canonical.
  const accumulator = useMemo(() => new AgentStreamAccumulator(agent), [agent, streaming]);
  // Completed turns stay checkpointed in the accumulator; only the unfinished
  // suffix is reparsed as new SSE output arrives.
  const displayed = useMemo(
    () => displayAgentStreamSegments(accumulator.update(stdout), parseAgentStderr(stderr), streaming),
    [accumulator, stdout, stderr, streaming],
  );
  const { segments, liveTextIndex } = displayed;
  const workingLabel = t("agent_stream.empty_working");
  // The run stays `streaming` until the daemon posts `agent.completed`, which
  // lands after the CLI's own end-of-turn frame — don't keep pulsing "Working…"
  // beneath a line that already says the agent finished.
  const showActivity = streaming && liveTextIndex < 0 && !hasTerminalOutcome(segments);
  const collaborationNodes = useMemo(
    () => buildCollaborationTree(collaborations, { settled: !streaming }),
    [collaborations, streaming],
  );

  if (segments.length === 0) {
    const emptySegments = emptyAgentStreamSegments(agent, streaming, t);
    if (emptySegments.length > 0) {
      return (
        <div className={`agent-stream ${streaming ? "streaming" : ""}`}>
          <SubagentTree nodes={collaborationNodes} />
          {keyedSegments(emptySegments).map(({ key, segment }) => (
            <SegmentView key={key} segment={segment} />
          ))}
          {showActivity ? <StreamActivity label={workingLabel} /> : null}
        </div>
      );
    }
    if (streaming) {
      return (
        <div className="agent-stream streaming">
          <SubagentTree nodes={collaborationNodes} />
          <StreamActivity label={workingLabel} />
        </div>
      );
    }
    if (collaborationNodes.length > 0) {
      return (
        <div className="agent-stream">
          <SubagentTree nodes={collaborationNodes} />
        </div>
      );
    }
    return <p className="msg-quiet">{t("agent_stream.empty_done")}</p>;
  }

  return (
    <div className={`agent-stream ${streaming ? "streaming" : ""}`}>
      <SubagentTree nodes={collaborationNodes} />
      {keyedSegments(segments).map(({ key, segment }, index) => (
        <SegmentView
          key={key}
          segment={segment}
          live={index === liveTextIndex}
          streaming={streaming}
          last={index === segments.length - 1}
        />
      ))}
      {showActivity ? <StreamActivity label={workingLabel} /> : null}
    </div>
  );
}

function SegmentView({
  segment,
  live = false,
  streaming = false,
  last = false,
}: { segment: AgentSegment; live?: boolean; streaming?: boolean; last?: boolean }) {
  const { t } = useTranslation();
  if (segment.kind === "text") {
    return <TextSegment text={segment.text} live={live} />;
  }
  if (segment.kind === "thinking") {
    // Only the trailing block of a running stream is still being written; every
    // earlier one has settled and collapses like any finished reasoning.
    return <ThinkingSegment text={segment.text} live={streaming && last} />;
  }
  if (segment.kind === "tool") {
    // A tool call is a single inline `⏺` mono line — the tool name plus the
    // file/command it acted on (design-system.md agent-turn: "⏺ for tool
    // lines"). No bordered chip; consecutive calls read as a compact log.
    return (
      <div className="agent-tool">
        <span className="agent-tool-marker" aria-hidden="true">⏺</span>
        <span className="agent-tool-name">{segment.name}</span>
        {segment.target ? <span className="agent-tool-target">{segment.target}</span> : null}
      </div>
    );
  }
  if (segment.kind === "command") {
    return (
      <div className="agent-command">
        <span className="agent-tool-marker" aria-hidden="true">⏺</span>
        <code>{segment.command}</code>
      </div>
    );
  }
  if (segment.kind === "narration") {
    return (
      <div className={`agent-status agent-status-${segment.params?.tone ?? "info"}`}>
        <StatusIcon tone={(segment.params?.tone as "good" | "bad" | "warn" | "info") ?? "info"} />
        <span>{t(segment.key, segment.params)}</span>
      </div>
    );
  }
  if (segment.kind === "status") {
    return (
      <div className={`agent-status agent-status-${segment.tone}`}>
        <StatusIcon tone={segment.tone} />
        <span>{segment.text}</span>
      </div>
    );
  }
  return <pre className="agent-raw">{segment.text}</pre>;
}

// Reasoning is a `○` marker plus dim italic body (design-system.md agent-turn).
// It is verbatim model output rather than prose to reflow — its own line breaks
// carry the structure (enumerations, steps) — so every line becomes a paragraph
// instead of collapsing into one run-on block. That also keeps the live caret,
// which the stylesheet hangs off the body's last `p`, tracking the end of the
// reasoning.
//
// A settled block is collapsed to its toggle alone so a long deliberation
// cannot bury the answer; the reader opens it deliberately. A live block stays
// open — it is where the turn's only visible progress is happening.
function ThinkingSegment({ text, live }: { text: string; live: boolean }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const lines = useMemo(() => text.split(/\n+/).filter((line) => line.trim()), [text]);
  const { lines: shown, toggle } = reasoningDisplay(lines, { live, expanded });

  return (
    <div className={`agent-thinking ${shown.length === 0 ? "is-collapsed" : ""}`}>
      <span className="agent-thinking-marker" aria-hidden="true">○</span>
      <div className="agent-thinking-body">
        {shown.map((line, index) => (
          <p key={`thinking-${index}`}>{line}</p>
        ))}
        {toggle ? (
          <button
            type="button"
            className="agent-thinking-toggle"
            aria-expanded={toggle === "collapse"}
            onClick={() => setExpanded((open) => !open)}
          >
            {t(toggle === "collapse" ? "agent_stream.reasoning_collapse" : "agent_stream.reasoning_expand")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TextSegment({ text, live }: { text: string; live: boolean }) {
  const visibleText = useSmoothStreamingText(text, live);
  const announcement = useDebouncedStreamingAnnouncement(text, live);
  return (
    <div className={`agent-text ${live ? "is-live" : ""}`}>
      {/* `md-body` is not optional decoration: every markdown element rule
          (headings, paragraphs, lists, blockquotes, inline code) in
          styles/markdown.css is scoped to it. Without it the transcript
          renders unstyled — headings collapse to body-sized plain text. */}
      <div className="md-body agent-prose" aria-hidden={live || undefined}>
        <MarkdownContent text={visibleText} live={live} />
      </div>
      {live ? (
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </span>
      ) : null}
    </div>
  );
}

function StatusIcon({ tone }: { tone: "good" | "bad" | "warn" | "info" }) {
  if (tone === "good") return <StatusOk size={13} aria-hidden="true" />;
  if (tone === "bad") return <StatusError size={13} aria-hidden="true" />;
  if (tone === "warn") return <StatusWarn size={13} aria-hidden="true" />;
  return <StatusInfo size={13} aria-hidden="true" />;
}
