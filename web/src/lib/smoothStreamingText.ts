// Pure reveal arithmetic for streamed agent text. The React hooks that drive it
// live in hooks/useSmoothStreamingText.ts; keeping this module free of runtime
// imports lets the node test build consume it directly.

const MIN_CHARS_PER_SECOND = 80;
const MAX_CHARS_PER_SECOND = 1_200;
const CATCH_UP_SECONDS = 0.22;
const MAX_FRAME_SECONDS = 0.05;
const MAX_INITIAL_REVEAL_CHARS = 120;

const graphemeSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

/** Pick the next approximate UTF-16 length; callers align it to a grapheme. */
export function nextStreamingTextLength(
  currentLength: number,
  targetLength: number,
  elapsedMs: number,
): number {
  if (targetLength <= currentLength) return targetLength;
  const backlog = targetLength - currentLength;
  const charsPerSecond = Math.min(
    MAX_CHARS_PER_SECOND,
    Math.max(MIN_CHARS_PER_SECOND, backlog / CATCH_UP_SECONDS),
  );
  const elapsedSeconds = Math.min(
    MAX_FRAME_SECONDS,
    Math.max(0.001, elapsedMs / 1_000),
  );
  const step = Math.max(1, Math.floor(charsPerSecond * elapsedSeconds));
  return Math.min(targetLength, currentLength + step);
}

function fallbackBoundary(text: string, length: number, direction: "before" | "after"): number {
  if (length <= 0 || length >= text.length) return length;
  const previous = text.charCodeAt(length - 1);
  const next = text.charCodeAt(length);
  const splitsSurrogatePair =
    previous >= 0xd800 && previous <= 0xdbff
    && next >= 0xdc00 && next <= 0xdfff;
  if (!splitsSurrogatePair) return length;
  return direction === "before" ? length - 1 : length + 1;
}

function graphemeBoundary(
  text: string,
  length: number,
  direction: "before" | "after",
): number {
  if (length <= 0 || length >= text.length) return length;
  if (!graphemeSegmenter) return fallbackBoundary(text, length, direction);
  const segment = graphemeSegmenter.segment(text).containing(length);
  if (!segment || segment.index === length) return length;
  return direction === "before" ? segment.index : segment.index + segment.segment.length;
}

/**
 * Preserve existing running-thread history on mount while leaving a short live
 * tail to reveal. A genuinely new first chunk is smaller than the cap and is
 * therefore smoothed from the beginning.
 */
export function initialStreamingText(
  text: string,
  streaming: boolean,
  reducedMotion: boolean,
): string {
  if (!streaming || reducedMotion) return text;
  const requestedLength = Math.max(0, text.length - MAX_INITIAL_REVEAL_CHARS);
  return text.slice(0, graphemeBoundary(text, requestedLength, "before"));
}

/** Keep append-only progress, but settle immediately on corrections or opt-out. */
export function reconcileStreamingText(
  visibleText: string,
  targetText: string,
  streaming: boolean,
  reducedMotion: boolean,
): string {
  if (!streaming || reducedMotion) return targetText;
  return targetText.startsWith(visibleText) ? visibleText : targetText;
}

/** Advance the visible prefix without cutting a user-visible grapheme cluster. */
export function advanceStreamingText(
  visibleText: string,
  targetText: string,
  elapsedMs: number,
): string {
  if (!targetText.startsWith(visibleText)) return targetText;
  const requestedLength = nextStreamingTextLength(
    visibleText.length,
    targetText.length,
    elapsedMs,
  );
  const nextLength = graphemeBoundary(targetText, requestedLength, "after");
  return targetText.slice(0, nextLength);
}
