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
      <path d="M12 2.25 16.25 6.25 12 10.25 7.75 6.25 12 2.25Z" fill="currentColor" />
      <path
        d="M12 10.25v2.5m0 0H6.25v2.1m5.75-2.1h5.75v2.1"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="3.25" y="14.75" width="6" height="6" rx="1.75" stroke="currentColor" strokeWidth="1.75" />
      <rect x="14.75" y="14.75" width="6" height="6" rx="1.75" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}
