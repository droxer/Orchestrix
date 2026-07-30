/**
 * Deterministic identity marks for entities that have no uploaded profile
 * image (agents, agent teams, task assignees).
 *
 * Both helpers are pure functions of the display name, so an identity keeps
 * the same monogram and the same hue everywhere it appears — and across
 * reloads — without storing anything server-side.
 */

/** Word boundaries used by handles (`growth.lead`, `claude-main`) and names. */
const NAME_SEPARATORS = /[._\-\s/]+/;

/**
 * Two-letter abbreviation of a display name: initials when the name has
 * several words (`Growth Team` → `GT`), otherwise the first two characters
 * of the single word (`claude` → `CL`, `研究组` → `研究`). Falls back to `?`
 * for an empty name so the mark never renders as an empty box.
 */
export function identityMonogram(name: string, maxLetters = 2): string {
  const parts = name.trim().split(NAME_SEPARATORS).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return [...parts[0]!].slice(0, maxLetters).join("").toUpperCase();
  return parts
    .slice(0, maxLetters)
    .map((part) => [...part][0]!.toUpperCase())
    .join("");
}

/**
 * Hue (0–359) derived from the name. Consumed as `--avatar-hue` by the CSS
 * that tints identity marks; the hue itself is the value, which is why those
 * rules are the sanctioned exception to the palette-token lint.
 */
export function identityHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360;
  }
  return hash;
}
