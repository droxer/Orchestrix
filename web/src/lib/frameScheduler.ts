// Coalesce work onto an animation frame without making progress depend on one.
//
// Browsers stop delivering animation frames whenever the page is not painting:
// a background tab, a minimized window, or a window fully occluded by another.
// Streamed agent output is committed from these callbacks, so an rAF-only
// scheduler silently stalls the transcript in exactly those states and then
// flushes the whole reply at once when the page repaints — the run reads as
// "nothing, then everything". Racing a timer against the frame keeps the
// frame-aligned batching when the page paints and still commits when it does
// not.

/** The timing surface, injected so the scheduler is testable without a DOM. */
export type FrameSchedulerHost = {
  requestAnimationFrame: (callback: (time: number) => void) => number;
  cancelAnimationFrame: (handle: number) => void;
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (handle: number) => void;
  now: () => number;
};

export type FrameScheduler = {
  /** Schedule `callback`; ignored while an earlier request is still pending. */
  request: (callback: (time: number) => void) => void;
  cancel: () => void;
  pending: () => boolean;
};

// Slower than a 60fps frame so a painting page always wins the race, short
// enough that a non-painting page still reads as live streaming.
const FALLBACK_DELAY_MS = 100;

export function browserFrameSchedulerHost(): FrameSchedulerHost {
  return {
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (handle) => window.clearTimeout(handle),
    now: () => performance.now(),
  };
}

export function createFrameScheduler(
  host: FrameSchedulerHost,
  fallbackMs: number = FALLBACK_DELAY_MS,
): FrameScheduler {
  let frame: number | undefined;
  let timer: number | undefined;

  const clear = (): void => {
    if (frame !== undefined) host.cancelAnimationFrame(frame);
    if (timer !== undefined) host.clearTimeout(timer);
    frame = undefined;
    timer = undefined;
  };

  return {
    request(callback) {
      if (frame !== undefined || timer !== undefined) return;
      // Whichever of the two arrives first clears the other, so the callback
      // runs exactly once per request.
      frame = host.requestAnimationFrame((time) => {
        clear();
        callback(time);
      });
      timer = host.setTimeout(() => {
        clear();
        callback(host.now());
      }, fallbackMs);
    },
    cancel: clear,
    pending: () => frame !== undefined || timer !== undefined,
  };
}
