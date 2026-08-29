import type { Tone } from "../types.js";
import type { NodeAgentPresence } from "./adminHelpers.js";

/**
 * How an executor's presence pip is drawn, in one place.
 *
 * The rule used to exist twice in CSS — `.adm-runtime-mark` on the fleet card
 * and row, `.computer-runtime-row` on the computer page — and the copies had
 * already drifted apart on the healthy fill (`var(--tone)` versus
 * `var(--ink-4)`). Both also rolled their own filled/hollow logic instead of
 * going through `StateMark`, where that shape grammar is written down.
 */

/**
 * The one difference the two copies were entitled to, made explicit.
 *
 * `bare` draws the glyph alone — no name, no state word — so hue is the only
 * thing a reader could get wrong: at 6px a good-green and a neutral grey are
 * the same dot, so healthy and unknown both settle for the calm ink fill and
 * only a problem earns a hue. `labeled` sits in a row that spells out the
 * agent's name, state and version, where hue restates a fact already written
 * and can therefore speak the full tone.
 */
export type RuntimeMarkVariant = "bare" | "labeled";

/**
 * Presence + tone → the pip's shape, and whether it carries hue at all.
 *
 * Shape is the load-bearing cue: FILLED = this runtime can take work right
 * now, HOLLOW = it cannot, because its computer is dark, because the daemon
 * never reported it ready, or because it failed. Hue then says which.
 *
 * A runtime switched off on purpose is never hued in either variant —
 * "disabled" is an administrative fact, not an alarm.
 */
export function runtimePip(
  presence: NodeAgentPresence,
  tone: Tone,
  variant: RuntimeMarkVariant,
): { shape: "solid" | "ring"; tone?: Tone } {
  const online = presence === "online";
  const shape = online && tone !== "bad" ? "solid" : ("ring" as const);
  const hued =
    presence === "disabled"
      ? false
      : online
        ? variant === "labeled" || tone === "bad"
        : tone === "warn" || tone === "bad";
  return { shape, tone: hued ? tone : undefined };
}
