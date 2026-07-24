type TeamMarkProps = {
  size?: number;
  className?: string;
};

/**
 * Relay's default team identity mark.
 *
 * The solid diamond is the dispatch lead. Its routing stem fans out to two
 * outlined member nodes, making the lead-first team model legible without
 * relying on a generic "users" silhouette or a vendor color.
 */
export function TeamMark({ size = 16, className }: TeamMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
    >
      <path d="M12 1.5 17 6.5 12 11.5 7 6.5 12 1.5Z" fill="currentColor" />
      <path
        d="M12 11.5v2m0 0H6v2m6-2h6v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="2.5" y="15.5" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2" />
      <rect x="14.5" y="15.5" width="7" height="7" rx="2" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
