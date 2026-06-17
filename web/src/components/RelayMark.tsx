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
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 50 V14 H44 C56 14 64 21 64 31 C64 41 56 47 44 47 H18" />
      </g>
      <g
        stroke="var(--color-primary)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M44 47 L70 56" />
      </g>
    </svg>
  );
}
