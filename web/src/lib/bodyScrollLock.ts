type ScrollLockTarget = {
  style: {
    overflow: string;
  };
};

/**
 * Creates a reference-counted body scroll lock. Every caller receives an
 * idempotent release function; the original overflow value is restored only
 * after the final overlapping drawer/dialog releases its lock.
 */
export function createBodyScrollLock(getTarget: () => ScrollLockTarget): () => () => void {
  let lockCount = 0;
  let target: ScrollLockTarget | null = null;
  let originalOverflow = "";

  return function acquireBodyScrollLock(): () => void {
    if (lockCount === 0) {
      target = getTarget();
      originalOverflow = target.style.overflow;
      target.style.overflow = "hidden";
    }
    lockCount += 1;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount !== 0 || !target) return;

      target.style.overflow = originalOverflow;
      target = null;
      originalOverflow = "";
    };
  };
}

export const acquireBodyScrollLock = createBodyScrollLock(() => document.body);
