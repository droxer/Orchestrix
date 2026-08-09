export type OutputStream = "stdout" | "stderr";

export type OutputEventBufferOptions = {
  delayMs?: number;
  maxChars?: number;
};

const DEFAULT_DELAY_MS = 25;
const DEFAULT_MAX_CHARS = 32_768;

/**
 * Coalesce raw subprocess chunks into a small ordered set of live-output
 * events. Chunks from each stream are safe to join within one latency window
 * because the backend and browser materialize stdout and stderr independently.
 */
export class OutputEventBuffer {
  private entries: Array<{ stream: OutputStream; text: string }> = [];
  private bufferedChars = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly delayMs: number;
  private readonly maxChars: number;

  constructor(
    private readonly emit: (stream: OutputStream, text: string) => void,
    options: OutputEventBufferOptions = {},
  ) {
    this.delayMs = Math.max(1, options.delayMs ?? DEFAULT_DELAY_MS);
    this.maxChars = Math.max(1, options.maxChars ?? DEFAULT_MAX_CHARS);
  }

  push(stream: OutputStream, text: string): void {
    if (!text) return;
    const existing = this.entries.find((entry) => entry.stream === stream);
    if (existing) existing.text += text;
    else this.entries.push({ stream, text });
    this.bufferedChars += text.length;

    if (this.bufferedChars >= this.maxChars) {
      this.flush();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.delayMs);
    this.timer.unref?.();
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.entries.length === 0) return;
    const entries = this.entries;
    this.entries = [];
    this.bufferedChars = 0;
    for (const entry of entries) this.emit(entry.stream, entry.text);
  }

  close(): void {
    this.flush();
  }
}
