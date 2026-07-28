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
      shapeRendering="geometricPrecision"
    >
      <g
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Ink, not --action: under Phosphor --action means "this is a button",
            and colour is reserved for live agent work. The logo is neither. */}
        <path d="M12 14 L32 32 L12 50" stroke="var(--ink-1)" />
        <path d="M32 14 L52 32 L32 50" stroke="currentColor" opacity="0.45" />
      </g>
    </svg>
  );
}
