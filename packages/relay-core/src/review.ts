import type { ReviewVerdict } from "./state.js";

export function extractReviewFeedback(stdout: string): string {
  const messages: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as unknown;
      const text = reviewMessageText(event).trim();
      if (text) messages.push(text);
    } catch {
      continue;
    }
  }
  return messages.length > 0 ? messages.join("\n\n") : stdout.trim().slice(-4000);
}

const VERDICT_LINE = /^\s*RELAY_REVIEW_VERDICT:\s*(APPROVED|REJECTED)\s*[.!]?\s*$/i;

export function classifyReview(exitCode: number, feedback: string): ReviewVerdict {
  if (exitCode !== 0) return "failed";
  let verdict: ReviewVerdict | undefined;
  for (const rawLine of feedback.split(/\r?\n/)) {
    const match = VERDICT_LINE.exec(rawLine);
    if (!match) continue;
    const value = match[1].toUpperCase();
    if (value === "APPROVED") verdict = "approved";
    else if (value === "REJECTED") verdict = "rejected";
  }
  return verdict ?? "failed";
}

function reviewMessageText(value: unknown): string {
  if (value === null || typeof value !== "object") return "";
  const event = value as Record<string, unknown>;
  if (event.type === "stream_event") {
    const streamEvent = asRecord(event.event);
    const delta = asRecord(streamEvent.delta);
    if (delta.type === "text_delta") return String(delta.text ?? "");
    return "";
  }
  if (event.type === "item.completed") {
    const item = event.item;
    if (item !== null && typeof item === "object") {
      const itemRecord = item as Record<string, unknown>;
      if (itemRecord.type === "agent_message") return textFromRecord(itemRecord);
    }
  }
  if (event.type === "assistant") {
    return textFromRecord(asRecord(event.message));
  }
  if (event.type === "message" || event.type === "assistant_message") {
    return textFromRecord(event);
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function textFromRecord(record: Record<string, unknown>): string {
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (!Array.isArray(record.content)) return "";
  return record.content
    .map((chunk) => {
      if (chunk === null || typeof chunk !== "object") return "";
      const chunkRecord = chunk as Record<string, unknown>;
      if (typeof chunkRecord.text === "string") return chunkRecord.text;
      if (typeof chunkRecord.content === "string") return chunkRecord.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
