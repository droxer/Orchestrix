import { Check, CircleAlert, Info, Terminal, TriangleAlert, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import type { AgentName } from "../types";
import { parseAgentStream, parseAgentStderr, type AgentSegment } from "../lib/agentStream";

type AgentStreamProps = {
  agent: AgentName;
  stdout: string;
  stderr: string;
  streaming: boolean;
};

export function AgentStream({ agent, stdout, stderr, streaming }: AgentStreamProps) {
  const segments = [
    ...parseAgentStream(agent, stdout),
    ...parseAgentStderr(stderr),
  ];

  if (segments.length === 0) {
    return <p className="msg-quiet">{streaming ? "Working…" : "No output."}</p>;
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
  if (segment.kind === "text") {
    return <div className="agent-text">{renderProse(segment.text)}</div>;
  }
  if (segment.kind === "thinking") {
    return (
      <details className="agent-thinking">
        <summary>
          <span className="agent-segment-label">Thinking</span>
        </summary>
        <div className="agent-thinking-body">{renderProse(segment.text)}</div>
      </details>
    );
  }
  if (segment.kind === "tool") {
    return (
      <div className="agent-tool">
        <Wrench size={13} aria-hidden="true" />
        <span className="agent-segment-label">Tool</span>
        <span className="agent-tool-name">{segment.name}</span>
      </div>
    );
  }
  if (segment.kind === "command") {
    return (
      <div className="agent-command">
        <Terminal size={13} aria-hidden="true" />
        <code>{segment.command}</code>
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
  if (tone === "good") return <Check size={13} aria-hidden="true" />;
  if (tone === "bad") return <CircleAlert size={13} aria-hidden="true" />;
  if (tone === "warn") return <TriangleAlert size={13} aria-hidden="true" />;
  return <Info size={13} aria-hidden="true" />;
}

function renderProse(text: string): ReactNode {
  const parts = splitFences(text);
  return parts.map((part, i) => {
    if (part.kind === "code") {
      return (
        <pre className="agent-code" key={i}>
          {part.lang ? <span className="agent-code-lang">{part.lang}</span> : null}
          <code>{part.text}</code>
        </pre>
      );
    }
    return (
      <div className="agent-prose" key={i}>
        {part.text.split(/\n{2,}/).map((para, j) => (
          <p key={j}>{renderInline(para)}</p>
        ))}
      </div>
    );
  });
}

type ProseChunk = { kind: "text"; text: string } | { kind: "code"; lang: string | null; text: string };

function splitFences(text: string): ProseChunk[] {
  const out: ProseChunk[] = [];
  const pattern = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }
    out.push({ kind: "code", lang: match[1] || null, text: match[2].replace(/\n+$/, "") });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    out.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return out;
}

function renderInline(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(renderLineBreaks(text.slice(lastIndex, match.index), key++));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={key++}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    nodes.push(renderLineBreaks(text.slice(lastIndex), key++));
  }
  return nodes;
}

function renderLineBreaks(text: string, key: number): ReactNode {
  const lines = text.split("\n");
  return (
    <span key={key}>
      {lines.map((line, i) => (
        <span key={i}>
          {line}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </span>
  );
}
