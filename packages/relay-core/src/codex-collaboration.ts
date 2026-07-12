export type CodexCollaborationTool = "spawnAgent" | "sendInput" | "resumeAgent" | "wait" | "closeAgent";
export type CodexCollaborationCallStatus = "inProgress" | "completed" | "failed";
export type CodexSubagentStatus =
  | "pendingInit"
  | "running"
  | "interrupted"
  | "completed"
  | "errored"
  | "shutdown"
  | "notFound";

export interface CodexSubagentState {
  status: CodexSubagentStatus;
  message: string | null;
}

export interface CodexCollaborationEvent {
  id: string;
  tool: CodexCollaborationTool;
  status: CodexCollaborationCallStatus;
  senderThreadId: string;
  receiverThreadIds: string[];
  prompt: string | null;
  model: string | null;
  reasoningEffort: string | null;
  agentsStates: Record<string, CodexSubagentState>;
}

/** Normalizes Codex app-server and `exec --json` collaboration items. */
export class CodexCollaborationStream {
  private buffer = "";

  feed(chunk: string): CodexCollaborationEvent[] {
    this.buffer += chunk;
    const events: CodexCollaborationEvent[] = [];
    while (this.buffer.includes("\n")) {
      const index = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      const event = parseCodexCollaborationLine(line);
      if (event) events.push(event);
    }
    return events;
  }
}

export function parseCodexCollaborationLine(line: string): CodexCollaborationEvent | null {
  if (!line) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const record = asRecord(value);
  const params = asRecord(record.params);
  const directItem = asRecord(record.item);
  const item = Object.keys(directItem).length > 0 ? directItem : asRecord(params.item);
  const type = item.type;
  if (
    type !== "collabAgentToolCall"
    && type !== "collab_agent_tool_call"
    && type !== "collab_tool_call"
  ) return null;

  const tool = normalizeTool(item.tool);
  const status = normalizeCallStatus(item.status);
  const id = stringValue(item.id);
  const senderThreadId = stringValue(item.senderThreadId ?? item.sender_thread_id);
  if (!tool || !status || !id || !senderThreadId) return null;

  const receiverIds = item.receiverThreadIds ?? item.receiver_thread_ids;
  const agentsStates = asRecord(item.agentsStates ?? item.agents_states);
  const normalizedStates: Record<string, CodexSubagentState> = {};
  for (const [threadId, stateValue] of Object.entries(agentsStates)) {
    const state = asRecord(stateValue);
    const agentStatus = normalizeAgentStatus(state.status);
    if (agentStatus) normalizedStates[threadId] = {
      status: agentStatus,
      message: typeof state.message === "string" ? state.message : null,
    };
  }

  return {
    id,
    tool,
    status,
    senderThreadId,
    receiverThreadIds: Array.isArray(receiverIds) ? receiverIds.filter((entry): entry is string => typeof entry === "string") : [],
    prompt: nullableString(item.prompt),
    model: nullableString(item.model),
    reasoningEffort: nullableString(item.reasoningEffort ?? item.reasoning_effort),
    agentsStates: normalizedStates,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeTool(value: unknown): CodexCollaborationTool | null {
  const aliases: Record<string, CodexCollaborationTool> = {
    spawnAgent: "spawnAgent", spawn_agent: "spawnAgent",
    sendInput: "sendInput", send_input: "sendInput",
    resumeAgent: "resumeAgent", resume_agent: "resumeAgent",
    wait: "wait",
    closeAgent: "closeAgent", close_agent: "closeAgent",
  };
  return typeof value === "string" ? aliases[value] ?? null : null;
}

function normalizeCallStatus(value: unknown): CodexCollaborationCallStatus | null {
  if (value === "inProgress" || value === "in_progress") return "inProgress";
  if (value === "completed" || value === "failed") return value;
  return null;
}

function normalizeAgentStatus(value: unknown): CodexSubagentStatus | null {
  const aliases: Record<string, CodexSubagentStatus> = {
    pendingInit: "pendingInit", pending_init: "pendingInit",
    running: "running", interrupted: "interrupted", completed: "completed",
    errored: "errored", shutdown: "shutdown",
    notFound: "notFound", not_found: "notFound",
  };
  return typeof value === "string" ? aliases[value] ?? null : null;
}
