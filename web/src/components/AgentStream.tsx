import { StreamCheck, StreamError, StreamInfo, StreamWarn } from "./icons";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CodexCollaborationEvent } from "relay-core";

import type { AgentName } from "../types";
import {
  AgentStreamAccumulator,
  displayAgentSegments,
  emptyAgentStreamSegments,
  hasStreamingTextCaret,
  hasTerminalOutcome,
  parseAgentStderr,
  type AgentSegment,
} from "../lib/agentStream";
import { Markdown } from "./Markdown";
import { buildCollaborationTree } from "../lib/collaborationTree";
import { SubagentTree } from "./SubagentTree";

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
  const segments = useMemo(
    () => displayAgentSegments([...accumulator.update(stdout), ...parseAgentStderr(stderr)], streaming),
    [accumulator, stdout, stderr, streaming],
  );
  const workingLabel = t("agent_stream.empty_working");
  // The run stays `streaming` until the daemon posts `agent.completed`, which
  // lands after the CLI's own end-of-turn frame — don't keep pulsing "Working…"
  // beneath a line that already says the agent finished.
  const showActivity = streaming && !hasStreamingTextCaret(segments) && !hasTerminalOutcome(segments);
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
        <SegmentView key={key} segment={segment} live={streaming && index === segments.length - 1} />
      ))}
      {showActivity ? <StreamActivity label={workingLabel} /> : null}
    </div>
  );
}

function SegmentView({ segment, live = false }: { segment: AgentSegment; live?: boolean }) {
  const { t } = useTranslation();
  if (segment.kind === "text") {
    return (
      <div className="agent-text">
        {live
          ? <div className="agent-prose agent-prose-live"><p>{segment.text}</p></div>
          : renderProse(segment.text)}
      </div>
    );
  }
  if (segment.kind === "thinking") {
    return null;
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

function StatusIcon({ tone }: { tone: "good" | "bad" | "warn" | "info" }) {
  if (tone === "good") return <StreamCheck size={13} aria-hidden="true" />;
  if (tone === "bad") return <StreamError size={13} aria-hidden="true" />;
  if (tone === "warn") return <StreamWarn size={13} aria-hidden="true" />;
  return <StreamInfo size={13} aria-hidden="true" />;
}

function renderProse(text: string): ReactNode {
  return <Markdown text={text} />;
}
