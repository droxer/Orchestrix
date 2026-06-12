import { Paperclip } from "lucide-react";
import { AgentStream } from "./AgentStream";
import type { AgentName, RelaySession, Tone } from "../types";
import type { RelayArtifact } from "relay-backend";

export type DerivedMessage =
  | {
      kind: "user";
      id: string;
      timestamp: string;
      text: string;
    }
  | {
      kind: "agent";
      id: string;
      timestamp: string;
      agent: AgentName;
      runId: string;
      streaming: boolean;
      stdout: string;
      stderr: string;
      attachments: RelayArtifact[];
    }
  | {
      kind: "system";
      id: string;
      timestamp: string;
      tone: Tone;
      label: string;
      detail?: string;
    };

export function isGroupedContinuation(messages: DerivedMessage[], index: number): boolean {
  const message = messages[index];
  if (message.kind !== "agent") return false;
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = messages[i];
    if (prev.kind === "system") continue;
    return prev.kind === "agent" && prev.agent === message.agent;
  }
  return false;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

const AGENT_INITIALS: Record<AgentName, string> = { claude: "C", pi: "π", codex: "X" };

function AgentAvatarIcon({ agent }: { agent: AgentName }) {
  return (
    <span className="agent-avatar" data-agent={agent} aria-hidden="true">
      {AGENT_INITIALS[agent]}
    </span>
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
  if (message.kind === "user") {
    return (
      <article className="msg msg-user">
        <span className="user-avatar" aria-hidden="true">Y</span>
        <div className="bubble">
          <header>
            <span>you</span>
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
              {employeeId}'s {message.agent}
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
                <a
                  key={artifact.id}
                  className="attachment-card"
                  href={`/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifact.id)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Paperclip size={14} />
                  <span className="attachment-meta">
                    <span className="attachment-kind">{artifact.kind}</span>
                    <strong>{artifact.title}</strong>
                  </span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <div className={`msg msg-system tone-${message.tone}`}>
      <span className="msg-system-rule" aria-hidden="true" />
      <span className="msg-system-label">
        <span>{message.label}</span>
        {message.detail ? (
          <span className="msg-system-detail">{message.detail}</span>
        ) : null}
      </span>
      <time className="mono">{formatTime(message.timestamp)}</time>
    </div>
  );
}

export function projectMessages(session: RelaySession | undefined): DerivedMessage[] {
  if (!session) return [];
  const out: DerivedMessage[] = [];
  out.push({
    kind: "user",
    id: `${session.id}:goal`,
    timestamp: session.createdAt,
    text: session.taskGoal,
  });

  const runState = new Map<
    string,
    {
      index: number;
      agent: AgentName;
      streaming: boolean;
      stdout: string;
      stderr: string;
      attachmentIds: Set<string>;
      timestamp: string;
    }
  >();

  const ensureRun = (runId: string, agent: AgentName, timestamp: string): number => {
    const existing = runState.get(runId);
    if (existing) return existing.index;
    const block: DerivedMessage = {
      kind: "agent",
      id: `${session.id}:run:${runId}`,
      timestamp,
      agent,
      runId,
      streaming: true,
      stdout: "",
      stderr: "",
      attachments: [],
    };
    out.push(block);
    const index = out.length - 1;
    runState.set(runId, {
      index,
      agent,
      streaming: true,
      stdout: "",
      stderr: "",
      attachmentIds: new Set(),
      timestamp,
    });
    return index;
  };

  for (const event of session.events) {
    switch (event.type) {
      case "session.created":
        break;
      case "agent.started": {
        ensureRun(event.runId, event.agent, event.timestamp);
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: "neutral",
          label: `${event.agent} - ${event.mode} started`,
        });
        break;
      }
      case "agent.output": {
        const index = ensureRun(event.runId, event.agent, event.timestamp);
        const state = runState.get(event.runId);
        if (!state) break;
        if (event.stream === "stdout") state.stdout += event.text;
        else state.stderr += event.text;
        const block = out[index];
        if (block.kind === "agent") {
          out[index] = { ...block, stdout: state.stdout, stderr: state.stderr };
        }
        break;
      }
      case "artifact.created": {
        const runId = event.artifact.agentRunId;
        if (runId) {
          const index = ensureRun(runId, session.currentAgent ?? "claude", event.timestamp);
          const state = runState.get(runId);
          const block = out[index];
          if (
            state &&
            !state.attachmentIds.has(event.artifact.id) &&
            block.kind === "agent"
          ) {
            state.attachmentIds.add(event.artifact.id);
            out[index] = { ...block, attachments: [...block.attachments, event.artifact] };
          }
        } else {
          out.push({
            kind: "system",
            id: event.id,
            timestamp: event.timestamp,
            tone: "neutral",
            label: `artifact - ${event.artifact.kind}`,
            detail: event.artifact.title,
          });
        }
        break;
      }
      case "human.decision": {
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: "info",
          label: `you - ${event.decision.kind.replace("_", " ")}`,
          detail: event.decision.note,
        });
        break;
      }
      case "agent.completed": {
        const state = runState.get(event.runId);
        if (state) {
          state.streaming = false;
          const block = out[state.index];
          if (block.kind === "agent") {
            out[state.index] = { ...block, streaming: false };
          }
        }
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone:
            event.status === "completed"
              ? "good"
              : event.status === "failed"
              ? "bad"
              : "neutral",
          label: `${event.agent} - ${event.status}`,
          detail: `exit ${event.exitCode}`,
        });
        break;
      }
      case "review.verdict": {
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: event.verdict === "approved" ? "good" : "bad",
          label: `codex verdict - ${event.verdict}`,
          detail: event.feedback,
        });
        break;
      }
      case "session.status": {
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: "neutral",
          label: `status - ${event.phase}`,
        });
        break;
      }
      case "session.completed":
      case "session.failed": {
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: event.type === "session.completed" ? "good" : "bad",
          label:
            event.type === "session.completed" ? "session completed" : "session failed",
          detail: event.outcome,
        });
        break;
      }
    }
  }
  return out;
}
