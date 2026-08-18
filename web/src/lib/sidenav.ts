import { TRANSCRIPT_MIN_WIDTH } from "./threadSpace.ts";

/** Expanded-rail width. The collapsed rail is not resizable — it is a fixed
 *  icon column (--sidenav-w), sized by the 48px control square rather than by
 *  content, so there is nothing for a drag to reveal. */
export const SIDENAV_WIDTH_DEFAULT = 228;
/** Below this the label column cannot hold a two-word route name beside the
 *  icon, and the rail reads as a broken version of the collapsed state. */
export const SIDENAV_WIDTH_MIN = 180;
export const SIDENAV_WIDTH_MAX = 320;

/** How wide the rail may grow right now: whatever the chat column can give up
 *  before hitting its floor, capped by the absolute maximum. Mirrors
 *  maxThreadListWidth in ./threadList — measure both widths once at gesture
 *  start so the ceiling doesn't drift as the grid re-lays out mid-drag. */
export function maxSidenavWidth(currentWidth: number, chatWidth: number | null): number {
  if (chatWidth === null || !Number.isFinite(chatWidth)) return SIDENAV_WIDTH_MAX;
  const room = currentWidth + (chatWidth - TRANSCRIPT_MIN_WIDTH);
  return Math.min(SIDENAV_WIDTH_MAX, Math.max(SIDENAV_WIDTH_MIN, Math.round(room)));
}

export function clampSidenavWidth(width: number, max: number = SIDENAV_WIDTH_MAX): number {
  if (typeof width !== "number" || Number.isNaN(width)) return SIDENAV_WIDTH_DEFAULT;
  const ceiling = Math.min(SIDENAV_WIDTH_MAX, Math.max(SIDENAV_WIDTH_MIN, max));
  return Math.min(ceiling, Math.max(SIDENAV_WIDTH_MIN, Math.round(width)));
}
