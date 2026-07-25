function parseCssTime(value: string): number {
  const trimmed = value.trim();
  if (trimmed.endsWith("ms")) return Number.parseFloat(trimmed);
  if (trimmed.endsWith("s")) return Number.parseFloat(trimmed) * 1000;
  return Number.NaN;
}

/** Reads the longest active CSS animation, including its delay. */
export function readAnimationDurationMs(element: Element | null, fallbackMs = 160): number {
  if (!element) return fallbackMs;
  const style = getComputedStyle(element);
  const durations = style.animationDuration.split(",").map(parseCssTime);
  const delays = style.animationDelay.split(",").map(parseCssTime);
  const totals = durations.map((duration, index) => {
    const delay = delays[index % delays.length] ?? 0;
    return duration + delay;
  });
  const longest = Math.max(...totals.filter(Number.isFinite));
  return Number.isFinite(longest) ? longest : fallbackMs;
}
