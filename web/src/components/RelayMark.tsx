type RelayMarkProps = {
  className?: string;
  width?: number;
  height?: number;
};

export function RelayMark({ className, width = 32, height = 32 }: RelayMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
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
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 14 L32 32 L12 50" stroke="var(--color-primary)" />
        <path d="M32 14 L52 32 L32 50" stroke="currentColor" opacity="0.5" />
      </g>
    </svg>
  );
}
