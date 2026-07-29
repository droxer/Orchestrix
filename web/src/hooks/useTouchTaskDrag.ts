import { useCallback, useEffect, useRef, useState } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";

import { LONG_PRESS_MS, movedBeyondSlop, type DragPoint } from "../lib/touchDrag";

interface TouchTaskDragOptions {
  /** The hold completed: the card is now travelling with the finger. */
  onStart: (taskId: string) => void;
  onMove: (point: DragPoint) => void;
  /** Finger lifted after a real drag — commit wherever it landed. */
  onDrop: () => void;
  /** The gesture never became a drag, or was interrupted. */
  onCancel: () => void;
}

/**
 * Press-and-hold dragging for touch input, which HTML5 drag-and-drop does not
 * serve at all. A swipe that starts before the hold elapses is left alone so
 * lanes and the board still scroll normally.
 */
export function useTouchTaskDrag(options: TouchTaskDragOptions): {
  onTouchStart: (taskId: string, event: ReactTouchEvent<HTMLElement>) => void;
  point: DragPoint | null;
} {
  const [point, setPoint] = useState<DragPoint | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const originRef = useRef<DragPoint | null>(null);
  const timerRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback((cancelled: boolean) => {
    clearTimer();
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    originRef.current = null;
    setPoint(null);
    if (!wasDragging) return;
    if (cancelled) optionsRef.current.onCancel();
    else optionsRef.current.onDrop();
  }, [clearTimer]);

  const onTouchStart = useCallback((taskId: string, event: ReactTouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    if (!touch || event.touches.length > 1) return;
    const origin = { x: touch.clientX, y: touch.clientY };
    originRef.current = origin;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      draggingRef.current = true;
      setPoint(origin);
      optionsRef.current.onStart(taskId);
    }, LONG_PRESS_MS);
  }, [clearTimer]);

  useEffect(() => {
    // Listeners live on the document and are explicitly non-passive: React
    // registers touchmove passively, so preventDefault() there is ignored and
    // the page would scroll away underneath a card that is being dragged.
    function handleMove(event: TouchEvent) {
      const touch = event.touches[0];
      const origin = originRef.current;
      if (!touch || !origin) return;
      const next = { x: touch.clientX, y: touch.clientY };
      if (!draggingRef.current) {
        // Still waiting on the hold — a finger that travels is scrolling.
        if (movedBeyondSlop(origin, next)) reset(true);
        return;
      }
      event.preventDefault();
      setPoint(next);
      optionsRef.current.onMove(next);
    }

    function handleEnd() {
      reset(false);
    }

    function handleCancel() {
      reset(true);
    }

    document.addEventListener("touchmove", handleMove, { passive: false });
    document.addEventListener("touchend", handleEnd);
    document.addEventListener("touchcancel", handleCancel);
    return () => {
      document.removeEventListener("touchmove", handleMove);
      document.removeEventListener("touchend", handleEnd);
      document.removeEventListener("touchcancel", handleCancel);
    };
  }, [reset]);

  useEffect(() => clearTimer, [clearTimer]);

  return { onTouchStart, point };
}
