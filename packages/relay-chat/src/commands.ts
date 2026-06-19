import { isAgentName, type AgentName, type AgentTaskMode } from "relay-core";
import type { ChatAgentRequest, ChatCommand, ChatConversationRef } from "./types.js";

const DEFAULT_AGENT: AgentName = "codex";
const DEFAULT_MODE: AgentTaskMode = "implement";

export function parseChatCommand(text: string): ChatCommand | undefined {
  const tokens = splitCommand(text.trim());
  if (tokens.length === 0) return undefined;
  if (tokens[0] === "/relay") tokens.shift();
  const action = stripCommandSuffix(tokens.shift() ?? "");
  if (action === "run") return parseRunCommand(tokens);
  if (action === "status") {
    const sessionId = tokens[0];
    return sessionId ? { kind: "status", sessionId } : undefined;
  }
  if (action === "cancel") {
    const sessionId = tokens.shift();
    if (!sessionId) return undefined;
    const parsed = parseKnownOptions(tokens, new Set(["sandbox"]));
    return {
      kind: "cancel",
      sessionId,
      sandboxId: stringOption(parsed.options, "sandbox"),
      reason: parsed.rest.join(" ").trim() || undefined,
    };
  }
  return undefined;
}

export function commandToAgentRequest(ref: ChatConversationRef, command: ChatCommand): ChatAgentRequest | undefined {
  if (command.kind !== "run") return undefined;
  return {
    ...ref,
    taskGoal: command.taskGoal,
    agent: command.agent,
    mode: command.mode,
    sandboxId: command.sandboxId,
    sessionId: command.sessionId,
  };
}

function parseRunCommand(tokens: string[]): ChatCommand | undefined {
  const parsed = parseKnownOptions(tokens, new Set(["agent", "mode", "sandbox", "session"]));
  const agent = agentOption(parsed.options) ?? DEFAULT_AGENT;
  const mode = modeOption(parsed.options) ?? DEFAULT_MODE;
  const taskGoal = parsed.rest.join(" ").trim();
  if (!taskGoal) return undefined;
  return {
    kind: "run",
    taskGoal,
    agent,
    mode,
    sandboxId: stringOption(parsed.options, "sandbox"),
    sessionId: stringOption(parsed.options, "session"),
  };
}

function parseKnownOptions(tokens: string[], names: Set<string>): { options: Map<string, string>; rest: string[] } {
  const options = new Map<string, string>();
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const match = /^--?([a-zA-Z][\w-]*)(?:=(.*))?$/.exec(token);
    if (match && names.has(match[1])) {
      if (match[2] !== undefined) {
        options.set(match[1], match[2]);
        continue;
      }
      const value = tokens[i + 1];
      if (value && !value.startsWith("-")) {
        options.set(match[1], value);
        i += 1;
      }
      continue;
    }
    rest.push(token);
  }
  return { options, rest };
}

function splitCommand(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "\"" | "'" | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function stripCommandSuffix(value: string): string {
  return value.replace(/^\/+/, "").split("@", 1)[0];
}

function agentOption(options: Map<string, string>): AgentName | undefined {
  const value = stringOption(options, "agent");
  return isAgentName(value) ? value : undefined;
}

function modeOption(options: Map<string, string>): AgentTaskMode | undefined {
  const value = stringOption(options, "mode");
  if (value === "implement" || value === "review") return value;
  return undefined;
}

function stringOption(options: Map<string, string>, name: string): string | undefined {
  return options.get(name)?.trim() || undefined;
}
