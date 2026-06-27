import { StreamCheck, StreamCommand, StreamError, StreamInfo, StreamTool, StreamWarn } from "./icons";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { AgentName } from "../types";
import { emptyAgentStreamSegments, parseAgentStream, parseAgentStderr, type AgentSegment } from "../lib/agentStream";
import { Markdown } from "./Markdown";

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
    () => [...parseAgentStream(agent, stdout), ...parseAgentStderr(stderr)],
    [agent, stdout, stderr],
  );

  if (segments.length === 0) {
    const emptySegments = emptyAgentStreamSegments(agent, streaming, t);
    if (emptySegments.length > 0) {
      return (
        <div className="agent-stream">
          {emptySegments.map((segment, i) => (
            <SegmentView key={i} segment={segment} />
          ))}
        </div>
      );
    }
    return <p className="msg-quiet">{streaming ? t("agent_stream.empty_working") : t("agent_stream.empty_done")}</p>;
  }

  return (
    <div className={`agent-stream ${streaming ? "streaming" : ""}`}>
      {segments.map((segment, i) => (
        <SegmentView key={i} segment={segment} />
      ))}
    </div>
  );
}

function SegmentView({ segment }: { segment: AgentSegment }) {
  const { t } = useTranslation();
  if (segment.kind === "text") {
    return <div className="agent-text">{renderProse(segment.text)}</div>;
  }
  if (segment.kind === "thinking") {
    return (
      <details className="agent-thinking">
        <summary>
          <span className="agent-segment-label">{t("agent_stream.thinking")}</span>
        </summary>
        <div className="agent-thinking-body">{renderProse(segment.text)}</div>
      </details>
    );
  }
  if (segment.kind === "tool") {
    return (
      <div className="agent-tool">
        <StreamTool size={13} aria-hidden="true" />
        <span className="agent-segment-label">{t("agent_stream.tool")}</span>
        <span className="agent-tool-name">{segment.name}</span>
      </div>
    );
  }
  if (segment.kind === "command") {
    return (
      <div className="agent-command">
        <StreamCommand size={13} aria-hidden="true" />
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
