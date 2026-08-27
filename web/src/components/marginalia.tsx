// Field-notes marginalia — the Relay double-chevron » sketched in the
// notebook margin: neutral-ink linework, dashed construction lines, small
// annotation arrows and ticks. This is the identity's entire decorative
// layer, so the rules are strict:
//
//   - Strokes only — no fills, no gradients, geometricPrecision throughout.
//   - Neutral ink ONLY (currentColor / var(--ink-3) / var(--ink-4)). The
//     accent hues (--action cobalt, --live purple) are reserved for
//     actionable and live work by system rule; a mascot must never spend
//     them.
//   - Decorative: every vignette is aria-hidden and unfocusable, and the
//     empty-state CSS positions them absolutely so they never shift layout.
//   - No animation, in any motion preference.

type MarginaliaProps = {
  className?: string;
};

const shared = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 120 120",
  fill: "none",
  "aria-hidden": true,
  focusable: "false",
  shapeRendering: "geometricPrecision",
} as const;

/** The mark under construction: both chevrons over a dashed centre cross,
 *  with endpoint ticks and a small annotation arrow pointing at the apex. */
export function RelayDoodleChevron({ className }: MarginaliaProps) {
  return (
    <svg {...shared} className={className}>
      {/* construction cross */}
      <path d="M14 60 H106" stroke="var(--ink-4)" strokeWidth="1.5" strokeDasharray="3 5" />
      <path d="M60 14 V106" stroke="var(--ink-4)" strokeWidth="1.5" strokeDasharray="3 5" />
      {/* endpoint ticks on the horizontal line */}
      <path d="M14 55 V65 M106 55 V65" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" />
      {/* the mark — second chevron steps down to ink-4 like the logo's 45% twin */}
      <path
        d="M34 32 L58 60 L34 88"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M62 32 L86 60 L62 88"
        stroke="var(--ink-4)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* annotation arrow up to the first chevron's apex */}
      <path
        d="M22 102 C 30 92, 40 80, 52 68"
        stroke="var(--ink-4)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M52 68 L42 68 M52 68 L50 78"
        stroke="var(--ink-4)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The mark mid-orbit: chevrons centred inside a dotted arc (gap at the
 *  bottom, as if the pencil lifted), with two ticks riding the arc. */
export function RelayDoodleOrbit({ className }: MarginaliaProps) {
  return (
    <svg {...shared} className={className}>
      {/* dotted arc over the top, gap at the bottom */}
      <path
        d="M22 42 A 42 42 0 1 0 98 42"
        stroke="var(--ink-4)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="0.1 7"
      />
      {/* ticks on the arc */}
      <path d="M22 42 L30 48 M98 42 L90 48" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" />
      {/* the mark */}
      <path
        d="M44 42 L62 60 L44 78"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M64 42 L82 60 L64 78"
        stroke="var(--ink-4)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* annotation arrow in from the lower-left */}
      <path
        d="M20 100 C 28 94, 34 88, 42 82"
        stroke="var(--ink-4)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M42 82 L33 84 M42 82 L42 91"
        stroke="var(--ink-4)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The mark annotated: a small chevron pair at the top with ruled note
 *  lines beneath and an arrow tying the notes back to the mark. */
export function RelayDoodleNotes({ className }: MarginaliaProps) {
  return (
    <svg {...shared} className={className}>
      {/* the mark, small, top-right */}
      <path
        d="M62 22 L80 38 L62 54"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M82 22 L100 38 L82 54"
        stroke="var(--ink-4)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* ruled note lines, uneven like a jot */}
      <path
        d="M20 82 H66 M20 93 H84 M20 104 H52"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* annotation arrow from the notes up to the mark */}
      <path
        d="M44 76 C 50 66, 56 58, 64 50"
        stroke="var(--ink-4)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M64 50 L55 52 M64 50 L64 59"
        stroke="var(--ink-4)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* margin ticks */}
      <path d="M22 24 V36 M16 30 H28" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
