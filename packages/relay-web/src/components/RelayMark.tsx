type RelayMarkProps = {
  className?: string;
  width?: number;
  height?: number;
};

export function RelayMark({ className, width = 40, height = 27 }: RelayMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 96 64"
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label="Relay"
      style={{ shapeRendering: "geometricPrecision" }}
    >
      <title>Relay</title>
      <g
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 14 H22 L32 24 H40" />
        <path d="M10 50 H22 L32 40 H40" />
      </g>
      <g fill="var(--color-ink)">
        <circle cx="10" cy="14" r="4" />
        <circle cx="10" cy="50" r="4" />
      </g>
      <g
        stroke="var(--color-primary)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <line x1="32" y1="32" x2="76" y2="32" />
        <polyline points="68,24 80,32 68,40" />
      </g>
    </svg>
  );
}
