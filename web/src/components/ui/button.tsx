import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { NavRefresh } from "@/components/icons"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] outline-none select-none focus-visible:border-ring focus-visible:shadow-[var(--focus-ring)] active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:shadow-(--focus-ring-danger) [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-active",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-surface-raised aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        /* Destructive is encoded by SHAPE, not hue. Phosphor allows exactly one
           colour (--live), and --destructive/--err resolves to the same value as
           --action, so a tinted wash would be indistinguishable from `ghost`.
           Danger therefore reads through three non-chromatic signals: a visible
           hairline ring where ghost has none, --err ink (a step brighter than
           inherited body ink), and a full contrast inversion on hover/focus.
           Same substitution StatusPill makes for its `bad` tone.
           `text-on-primary` is the correct ink on an --err fill in both
           registers: --err and --action share a value, so they share a contrast
           partner. */
        destructive:
          "border-destructive/45 text-destructive hover:border-destructive hover:bg-destructive hover:text-on-primary focus-visible:border-destructive focus-visible:shadow-(--focus-ring-danger)",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-(--control-h) gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        /* The text tier climbs with the size tier: xs 11px → sm 13px →
           default 14px (the base `text-sm`). `sm` previously carried an
           arbitrary text-[0.8rem] (11.2px), which put it BELOW xs's 13px and
           inverted the ladder. */
        xs: "h-6 gap-1 rounded-md px-2 text-micro in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-md px-3 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        /* One step ABOVE `default`: 44px against a 40px --control-h, which
           also clears --touch-target on fine pointers. */
        lg: "h-11 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        /* Drawer/footer call-to-action: full control height with stronger
           label typography. Replaces the old `.adm-form-actions` descendant
           override so footer buttons are styled explicitly. */
        cta: "h-(--control-h) gap-1.5 px-4 text-2xs font-semibold",
        /* Square counterpart of `default`: the toolbar refresh buttons sit
           directly beside default-size buttons, so the icon tier tracks
           --control-h instead of a fixed 32px that rendered 8px short.
           `icon-sm`/`icon-xs` remain the dense tiers for in-row chrome. */
        icon: "size-(--control-h)",
        "icon-xs":
          "size-6 rounded-md in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-md in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Marks an in-flight action and adds the shared progress glyph. */
    loading?: boolean
    /** Optional replacement copy while loading; existing children stay visible by default. */
    loadingLabel?: ReactNode
  }

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  loadingLabel,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ variant, size, className }))}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <NavRefresh className="spin" aria-hidden="true" /> : null}
      {loading && loadingLabel !== undefined ? loadingLabel : children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants, type ButtonProps }
