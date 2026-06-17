const NOISE_MARKERS = ["○ ", "⏺ "];

export function extractLastAssistantText(transcript: string): string | null {
  if (!transcript || !transcript.trim()) return null;
  const segments = transcript.split(/\n?● /).slice(1);
  for (let i = segments.length - 1; i >= 0; i--) {
    const cleaned = segments[i]
      .split("\n")
      .filter((line) => !NOISE_MARKERS.some((m) => line.startsWith(m)))
      .join("\n")
      .trim();
    if (cleaned.length > 0) return cleaned;
  }
  return null;
}
