import { useCallback, useEffect, useRef } from "react";

import { edgeScrollVelocity } from "../lib/edgeAutoScroll";

/**
 * Scrolls a horizontal container while a drag hovers near its edges.
 *
 * The scroll runs on its own animation frame rather than on `dragover`: that
 * event only fires as the pointer moves, so a card held still against the edge
 * would otherwise stall mid-scroll.
 */
export function useEdgeAutoScroll(): {
  track: (element: HTMLElement, clientX: number) => void;
  stop: () => void;
} {
  const elementRef = useRef<HTMLElement | null>(null);
  const velocityRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    velocityRef.current = 0;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    elementRef.current = null;
  }, []);

  const step = useCallback(() => {
    const element = elementRef.current;
    if (!element || velocityRef.current === 0) {
      frameRef.current = null;
      return;
    }
    element.scrollLeft += velocityRef.current;
    frameRef.current = requestAnimationFrame(step);
  }, []);

  const track = useCallback((element: HTMLElement, clientX: number) => {
    const rect = element.getBoundingClientRect();
    elementRef.current = element;
    velocityRef.current = edgeScrollVelocity(rect, clientX);
    if (velocityRef.current !== 0 && frameRef.current === null) {
      frameRef.current = requestAnimationFrame(step);
    }
  }, [step]);

  useEffect(() => stop, [stop]);

  return { track, stop };
}
