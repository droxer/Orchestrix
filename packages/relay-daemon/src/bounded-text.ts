import { agentTranscriptLimit } from "relay-core";

/**
 * Retains only the most recent text so long-running agents cannot exhaust RAM.
 *
 * The budget is the shared agent transcript limit rather than a private
 * constant: this capture sits upstream of the completed-run log, so a smaller
 * cap here would silently discard text before the log could keep it, making
 * RELAY_AGENT_RESULT_LOG_LIMIT look broken.
 */
export class BoundedTextCapture {
  private text = "";
  private readonly limit: number;

  constructor(limit = agentTranscriptLimit()) {
    this.limit = limit;
  }

  append(value: string): void {
    if (!value) return;
    if (value.length >= this.limit) {
      this.text = value.slice(-this.limit);
      return;
    }
    this.text += value;
    if (this.text.length > this.limit) this.text = this.text.slice(-this.limit);
  }

  toString(): string {
    return this.text;
  }
}
