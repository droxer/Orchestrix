import { useEffect, useRef, useState } from "react";

import { browserFrameSchedulerHost, createFrameScheduler, type FrameScheduler } from "../lib/frameScheduler";
import {
  advanceStreamingText,
  initialStreamingText,
  reconcileStreamingText,
} from "../lib/smoothStreamingText";

const STREAM_ANNOUNCEMENT_DELAY_MS = 600;

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

/**
 * Smooth irregular SSE chunks without restarting the reveal loop for each target
 * update. The loop reads the latest refs, so continuous streams still advance.
 */
export function useSmoothStreamingText(text: string, streaming: boolean): string {
  const reducedMotion = usePrefersReducedMotion();
  const [visibleText, setVisibleText] = useState(() => initialStreamingText(text, streaming, false));
  const visibleRef = useRef(visibleText);
  const targetRef = useRef(text);
  const streamingRef = useRef(streaming);
  const reducedMotionRef = useRef(reducedMotion);
  // The reveal is frame-driven, but a page that is not painting (background
  // tab, occluded window) delivers no frames at all. Without the scheduler's
  // timer fallback the visible prefix freezes and the reply only appears once
  // the run settles — the whole answer arrives in one jump.
  const schedulerRef = useRef<FrameScheduler | undefined>(undefined);
  schedulerRef.current ??= createFrameScheduler(browserFrameSchedulerHost());
  const previousTimeRef = useRef<number | undefined>(undefined);
  const advanceRef = useRef<(time: number) => void>(() => undefined);
  const scheduleRef = useRef<() => void>(() => undefined);

  targetRef.current = text;
  streamingRef.current = streaming;
  reducedMotionRef.current = reducedMotion;

  const commitVisibleText = (next: string) => {
    if (next === visibleRef.current) return;
    visibleRef.current = next;
    setVisibleText(next);
  };

  scheduleRef.current = () => {
    schedulerRef.current?.request((time) => advanceRef.current(time));
  };

  advanceRef.current = (time: number) => {
    const reconciled = reconcileStreamingText(
      visibleRef.current,
      targetRef.current,
      streamingRef.current,
      reducedMotionRef.current,
    );
    commitVisibleText(reconciled);
    if (
      !streamingRef.current
      || reducedMotionRef.current
      || reconciled.length >= targetRef.current.length
    ) {
      previousTimeRef.current = undefined;
      return;
    }

    const elapsed = previousTimeRef.current === undefined ? 16 : time - previousTimeRef.current;
    previousTimeRef.current = time;
    const next = advanceStreamingText(reconciled, targetRef.current, elapsed);
    commitVisibleText(next);
    if (next.length < targetRef.current.length) scheduleRef.current();
    else previousTimeRef.current = undefined;
  };

  useEffect(() => {
    const reconciled = reconcileStreamingText(
      visibleRef.current,
      text,
      streaming,
      reducedMotion,
    );
    commitVisibleText(reconciled);
    if (!streaming || reducedMotion || reconciled.length >= text.length) {
      schedulerRef.current?.cancel();
      previousTimeRef.current = undefined;
      return;
    }
    scheduleRef.current();
  }, [reducedMotion, streaming, text]);

  useEffect(() => {
    const scheduler = schedulerRef.current;
    return () => scheduler?.cancel();
  }, []);

  return streaming
    ? reconcileStreamingText(visibleText, text, streaming, reducedMotion)
    : text;
}

/** Debounce screen-reader announcements independently from the visual reveal. */
export function useDebouncedStreamingAnnouncement(text: string, streaming: boolean): string {
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!streaming) {
      setAnnouncement("");
      return;
    }
    const timeout = window.setTimeout(() => setAnnouncement(text), STREAM_ANNOUNCEMENT_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [streaming, text]);

  return streaming ? announcement : "";
}
