import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// `default` and `secondary` share styling; both names stay public for callers.
const secondaryBadgeClasses =
  "border-transparent bg-secondary text-secondary-foreground [a]:hover:bg-secondary/90"

const badgeVariants = cva(
  /* Badge chrome: caption-bold (12px/700) on a `4px 8px` pad inside the
     CONTROL radius (--r-2, 6px), not a pill. The source system squares
     nothing, but at 20px badge heights a --r-full lozenge has more curve than
     edge and stops reading as a distinct shape next to the chips and buttons
     around it — see the radii block in palette.css. The source system's 10px
     inline pad has no token on the --sp-* grid (2.5 is a banned half-step),
     and the 12px step — carried over from the pill, where it cleared the
     curve — reads wide against a 6px radius, so the badge takes the 8px step.
     The dot-carrying status tones below keep their leading dot perfectly
     round; the dot is the part that is supposed to be a circle. */
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 truncate overflow-hidden rounded-md border px-2 py-0.5 text-micro font-bold whitespace-nowrap transition-[color,box-shadow,border-color,background-color] duration-(--t-fast) ease-(--ease) focus-visible:[outline:var(--focus-outline)] focus-visible:[outline-offset:var(--focus-offset)] focus-visible:ring-0 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: secondaryBadgeClasses,
        secondary: secondaryBadgeClasses,
        destructive:
          "border-destructive/30 bg-background text-danger [a]:hover:border-destructive",
        outline:
          "text-foreground [a]:hover:bg-accent [a]:hover:text-accent-foreground",
        // Status tones — carry a leading dot so they read as live status
        // indicators (the former .pill good/info/warn/bad vocabulary).
        neutral:
          "border-hairline bg-surface-strong text-ink before:content-[''] before:size-1.5 before:rounded-full before:bg-muted-soft",
        success:
          "border-success/35 bg-background text-success before:content-[''] before:size-1.5 before:rounded-full before:bg-success",
        info:
          "border-info/30 bg-background text-info before:content-[''] before:size-1.5 before:rounded-full before:bg-info",
        warning:
          "border-warning/30 bg-background text-warning before:content-[''] before:size-1.5 before:rounded-full before:bg-warning",
        danger:
          "border-danger/35 bg-background text-danger before:content-[''] before:size-1.5 before:rounded-full before:bg-transparent before:shadow-[inset_0_0_0_1px_var(--err)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
