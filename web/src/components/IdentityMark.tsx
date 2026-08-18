type IdentityMarkProps = {
  /** Which class of identity the mark stands for. */
  kind: "agent" | "team";
  /** `chip` (default) draws the glyph on the profile-image surface; `bare`
      draws the glyph alone, for empty states that supply their own frame. */
  variant?: "chip" | "bare";
  /** Bare marks size themselves; chip marks always fill their profile box. */
  size?: number;
  className?: string;
};

/**
 * Relay's default profile image for an agent or an agent team.
 *
 * One primitive, two compositions. The solid diamond is a dispatch node: on
 * its own it is a single agent; with a stem fanning to two filled members it
 * is a team led by one. Silhouette carries the class — one shape versus three
 * — which survives down to the 16px chips in the composer and mention popup
 * where stroked detail would turn to mud.
 *
 * The mark is deliberately identical for every agent. It says *what kind of
 * thing this is*, not which one; the display name beside it carries identity,
 * and an uploaded image replaces the mark entirely. It draws in currentColor
 * so it never introduces a hue — under Phosphor, colour means live work.
 */
const AGENT_PATHS = ["M12 3.5 20.5 12 12 20.5 3.5 12 12 3.5Z"] as const;

const TEAM_PATHS = [
  "M12 1.5 18 7.5 12 13.5 6 7.5 12 1.5Z",
  "M11 13.5h2v2h7v2H4v-2h7v-2Z",
  "M2.5 19h6v4.5h-6V19Z",
  "M15.5 19h6v4.5h-6V19Z",
] as const;

export function IdentityMark({ kind, variant = "chip", size, className }: IdentityMarkProps) {
  const paths = kind === "team" ? TEAM_PATHS : AGENT_PATHS;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={variant === "bare" ? size : undefined}
      height={variant === "bare" ? size : undefined}
      data-variant={variant}
      className={`identity-mark${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
