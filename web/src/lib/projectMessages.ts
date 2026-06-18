import type { TFunction } from "i18next";
import type { RelayArtifact } from "relay-core";
import type { AgentName, RelaySession, Tone } from "../types.js";

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

export function projectMessages(session: RelaySession | undefined, t: TFunction): DerivedMessage[] {
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
      attachmentIds: Set<string>;
      stdout: string;
      stderr: string;
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
      attachmentIds: new Set(),
      stdout: "",
      stderr: "",
    });
    return index;
  };

  for (const event of session.events) {
    switch (event.type) {
      case "session.created":
        break;
      case "agent.started": {
        ensureRun(event.runId, event.agent, event.timestamp);
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
        if (event.artifact.kind === "command_log") break;
        const runId = event.artifact.agentRunId;
        const state = runId ? runState.get(runId) : undefined;
        if (runId && state) {
          const block = out[state.index];
          if (!state.attachmentIds.has(event.artifact.id) && block.kind === "agent") {
            state.attachmentIds.add(event.artifact.id);
            out[state.index] = { ...block, attachments: [...block.attachments, event.artifact] };
          }
        } else {
          out.push({
            kind: "system",
            id: event.id,
            timestamp: event.timestamp,
            tone: "neutral",
            label: t("message.artifact", { kind: t(`artifact.kind.${event.artifact.kind}`, { defaultValue: event.artifact.kind }) }),
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
          label: t("message.decision", { kind: t(`decision.${event.decision.kind}`, { defaultValue: event.decision.kind }) }),
          detail: event.decision.note,
        });
        break;
      }
      case "agent.completed": {
        const state = runState.get(event.runId);
        if (state) {
          const block = out[state.index];
          if (block.kind === "agent") {
            out[state.index] = { ...block, streaming: false };
          }
        }
        break;
      }
      case "review.verdict": {
        out.push({
          kind: "system",
          id: event.id,
          timestamp: event.timestamp,
          tone: event.verdict === "approved" ? "good" : "bad",
          label: t("message.review_verdict", {
            agent: event.agent,
            verdict: t(`verdict.${event.verdict}`, { defaultValue: event.verdict }),
          }),
          detail: event.feedback,
        });
        break;
      }
      case "session.status":
      case "session.completed":
      case "session.failed":
        break;
    }
  }
  return out;
}
