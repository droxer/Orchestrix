import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// `default` and `secondary` share styling; both names stay public for callers.
const secondaryBadgeClasses =
  "border-transparent bg-secondary text-secondary-foreground [a]:hover:bg-secondary/90"

const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 truncate overflow-hidden rounded-sm border px-3 py-1 text-xs font-semibold whitespace-nowrap transition-[color,box-shadow,border-color,background-color] focus-visible:shadow-[var(--focus-ring)] focus-visible:ring-0 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: secondaryBadgeClasses,
        secondary: secondaryBadgeClasses,
        destructive:
          "border-destructive/30 bg-background text-danger-strong [a]:hover:border-destructive",
        outline:
          "text-foreground [a]:hover:bg-accent [a]:hover:text-accent-foreground",
        // Status tones — carry a leading dot so they read as live status
        // indicators (the former .pill good/info/warn/bad vocabulary).
        neutral:
          "border-hairline bg-surface-strong text-ink before:content-[''] before:size-1.5 before:rounded-full before:bg-muted-soft",
        success:
          "border-success/35 bg-background text-success-strong before:content-[''] before:size-1.5 before:rounded-full before:bg-success",
        info:
          "border-info/30 bg-background text-info before:content-[''] before:size-1.5 before:rounded-full before:bg-info",
        warning:
          "border-hairline bg-background text-muted-foreground before:content-[''] before:size-1.5 before:rounded-full before:bg-warning",
        danger:
          "border-danger/35 bg-background text-danger-strong before:content-[''] before:size-1.5 before:rounded-full before:bg-danger",
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
