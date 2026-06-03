export function extractCodexFeedback(stdout: string): string {
  const messages: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: unknown } };
      if (event.type !== "item.completed") continue;
      if (event.item?.type === "agent_message") {
        const text = String(event.item.text ?? "").trim();
        if (text) messages.push(text);
      }
    } catch {
      continue;
    }
  }
  return messages.length > 0 ? messages.join("\n\n") : stdout.trim().slice(-4000);
}

export function classifyCodexReview(exitCode: number, feedback: string): "approved" | "rejected" | "failed" {
  if (exitCode !== 0) return "failed";
  let verdict = "";
  for (const rawLine of feedback.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("ORCHESTRIX_REVIEW_VERDICT:")) {
      verdict = line.split(":", 2)[1].trim().toUpperCase();
    }
  }
  if (verdict === "APPROVED") return "approved";
  if (verdict === "REJECTED") return "rejected";
  return "failed";
}
