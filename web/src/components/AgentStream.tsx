import { StreamCheck, StreamError, StreamInfo, StreamWarn } from "./icons";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { AgentName } from "../types";
import {
  displayAgentSegments,
  emptyAgentStreamSegments,
  hasStreamingTextCaret,
  parseAgentStderr,
  parseAgentStream,
  type AgentSegment,
} from "../lib/agentStream";
import { Markdown } from "./Markdown";

function StreamActivity({ label }: { label: string }) {
  return (
    <div className="agent-stream-activity" aria-live="polite">
      <span className="agent-stream-pulse" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

type AgentStreamProps = {
  agent: AgentName;
  stdout: string;
  stderr: string;
  streaming: boolean;
};

export function AgentStream({ agent, stdout, stderr, streaming }: AgentStreamProps) {
  const { t } = useTranslation();
  // The parser scans the whole accumulated stdout char-by-char; without
  // memoization every streamed delta would re-parse the full string from
  // scratch (O(n²) over a run). Key the parse on its raw inputs only.
  const segments = useMemo(
    () => displayAgentSegments([...parseAgentStream(agent, stdout), ...parseAgentStderr(stderr)], streaming),
    [agent, stdout, stderr, streaming],
  );
  const workingLabel = t("agent_stream.empty_working");
  const showActivity = streaming && !hasStreamingTextCaret(segments);

  if (segments.length === 0) {
    const emptySegments = emptyAgentStreamSegments(agent, streaming, t);
    if (emptySegments.length > 0) {
      return (
        <div className={`agent-stream ${streaming ? "streaming" : ""}`}>
          {emptySegments.map((segment, i) => (
            <SegmentView key={i} segment={segment} />
          ))}
          {showActivity ? <StreamActivity label={workingLabel} /> : null}
        </div>
      );
    }
    if (streaming) {
      return (
        <div className="agent-stream streaming">
          <StreamActivity label={workingLabel} />
        </div>
      );
    }
    return <p className="msg-quiet">{t("agent_stream.empty_done")}</p>;
  }

  return (
    <div className={`agent-stream ${streaming ? "streaming" : ""}`}>
      {segments.map((segment, i) => (
        <SegmentView key={i} segment={segment} />
      ))}
      {showActivity ? <StreamActivity label={workingLabel} /> : null}
    </div>
  );
}

function SegmentView({ segment }: { segment: AgentSegment }) {
  const { t } = useTranslation();
  if (segment.kind === "text") {
    return <div className="agent-text">{renderProse(segment.text)}</div>;
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
