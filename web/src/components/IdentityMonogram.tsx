import type { CSSProperties } from "react";
import { identityHue, identityMonogram } from "../lib/identity";

type IdentityMonogramProps = {
  /** Display name of the agent or team the mark stands for. */
  name: string;
  /** Monogram type size in px; the mark itself fills its profile-image box. */
  size?: number;
  className?: string;
};

/**
 * Relay's default profile image for an agent or an agent team: the name's
 * two-letter abbreviation on a background tinted by a hue derived from that
 * same name.
 *
 * The hue is identity, never status — a monogram tells you *which* agent, and
 * the readiness pip beside it still carries the only status color. It is
 * decorative markup: every call site already names the identity in adjacent
 * visible text or an `aria-label` on the wrapper.
 */
export function IdentityMonogram({ name, size = 12, className }: IdentityMonogramProps) {
  return (
    <span
      className={`identity-monogram${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      translate="no"
      style={
        {
          "--avatar-hue": identityHue(name),
          "--monogram-size": `${size}px`,
        } as CSSProperties
      }
    >
      {identityMonogram(name)}
    </span>
  );
}
