import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { NavRefresh } from "@/components/icons"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-xs font-bold whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-(--t-fast) ease-(--ease) outline-none select-none focus-visible:border-ring focus-visible:[outline:var(--focus-outline)] focus-visible:[outline-offset:var(--focus-offset)] active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:[outline:var(--focus-outline-danger)] aria-invalid:[outline-offset:var(--focus-offset)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /* Disabled drops OUT of the fill rather than fading through it. The
           shared `disabled:opacity-50` is right for ghost/outline/link, where
           the label sits on the page's own surface, but half-opacity white on
           cobalt measures ~2.2:1 — and a filled CTA is exactly the button that
           spends most of its life disabled (admin Settings' Save is disabled
           until its field is dirty). */
        default:
          "bg-primary text-primary-foreground hover:bg-primary-active disabled:opacity-100 disabled:border-(--line-1) disabled:bg-(--surface-2) disabled:text-(--ink-4)",
        /* The neutral tiers wash with --control-fill rather than --surface-2.
           See the role's note in roles.css: a fixed surface step only lifts on
           the one plane it was sized against, and inverted on the --surface-3
           planes (dialog, drawer, popover) these buttons most often sit on. */
        /* `border-input` (--control-border) in BOTH registers, matching Input,
           Textarea, SelectTrigger, and Checkbox. This variant used to take
           --line-1 in light and --control-border in dark, which made it a
           visibly different control per register — and --line-1 is the
           STRUCTURAL hairline, too faint to carry a control boundary under
           WCAG 1.4.11. The border is an outline button's whole affordance. */
        outline:
          "border-input bg-(--control-fill) hover:bg-(--control-fill-hover) hover:text-foreground aria-expanded:bg-(--control-fill-hover) aria-expanded:text-foreground",
        secondary:
          "bg-(--control-fill) text-secondary-foreground hover:bg-(--control-fill-hover) aria-expanded:bg-(--control-fill-hover) aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-(--control-fill-hover) hover:text-foreground aria-expanded:bg-(--control-fill-hover) aria-expanded:text-foreground",
        /* Destructive reads in the source system's critical red: a hairline ring
           where ghost has none, --err ink, and a full inversion to the red
           fill with --on-err text on hover/focus. The shape signal (the ring)
           is kept alongside the hue so the variant survives forced-colors
           mode, where the red is dropped. */
        destructive:
          "border-destructive/45 text-destructive hover:border-destructive hover:bg-destructive hover:text-destructive-foreground focus-visible:border-destructive focus-visible:[outline:var(--focus-outline-danger)] focus-visible:[outline-offset:var(--focus-offset)] disabled:opacity-100 disabled:border-(--line-1) disabled:text-(--ink-4)",
        /* Circular icon-only action — the source system's 40px button-icon-circular:
           ink-3 idle; a control wash + line-2 + ink-1 on hover. Always paired
           with the round `icon-r` (--control-h) / `icon-r-sm` (--control-h-xs)
           sizes.
           `tinted` swaps the hover to an --action wash; a `danger` className
           re-tints it to --err. */
        icon: "text-(--ink-3) hover:border-(--line-2) hover:bg-(--control-fill-hover) hover:text-(--ink-1)",
      },
      size: {
        /* The source system's pill padding is `14px 30px` around a 14px label; at
           Relay's 44px --control-h the vertical half is the height, and the
           inline half rounds to the 24px step on the grid. */
        default:
          "h-(--control-h) gap-1.5 px-6 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        /* The text tier climbs with the size tier: xs 12px (caption) → sm and
           default 14px (the source system's button-md, the base `text-xs`).
           Every tier takes the CONTROL radius (--r-2, 6px) from the base, not
           a pill: see the radii block in palette.css for why this app squares
           off the brand's lozenge. These tiers restate it only to win the
           tailwind-merge conflict inside a button group. */
        xs: "h-(--control-h-2xs) gap-1 rounded-md px-3 text-micro in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-(--control-h-xs) gap-1 rounded-md px-4 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        /* One step ABOVE `default`, on the --control-h-lg rung, for hero and
           dual-CTA pairs where the pill carries a marketing weight. */
        lg: "h-(--control-h-lg) gap-2 px-7 has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5",
        /* Drawer/footer call-to-action: full control height with stronger
           label typography. Replaces the old `.adm-form-actions` descendant
           override so footer buttons are styled explicitly.

           Shares `default`'s 14px/700 label and differs from it by padding
           alone — in this system the button label is ALREADY the bold tier
           (the source system's button-md is 14px/700), so a commit action cannot
           emphasise itself by getting heavier. It leads through the cobalt
           fill of the `default` variant and a wider pill. */
        cta: "h-(--control-h) gap-2 px-7",
        /* Square counterpart of `default`: the toolbar refresh buttons sit
           directly beside default-size buttons, so the icon tier tracks
           --control-h instead of a fixed height that rendered 8px short.
           `icon-sm`/`icon-xs` remain the dense tiers for in-row chrome. */
        icon: "size-(--control-h)",
        "icon-xs":
          "size-(--control-h-2xs) rounded-md in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-(--control-h-xs) rounded-md in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-(--control-h-lg)",
        /* Formerly the ROUND footprints for the `icon` variant. A toolbar
           icon button is a control, not an avatar, so it now takes the same
           --r-2 corner as every other button and these are size aliases of
           `icon` / `icon-sm`. Kept rather than deleted because ~12 call sites
           name them; collapse them in a follow-up rather than mid-review. */
        "icon-r": "size-(--control-h) rounded-md",
        "icon-r-sm": "size-(--control-h-xs) rounded-md",
      },
      /* Tinted hover for the `icon` variant — the icon communicates a colored
         action instead of the neutral ink hover. Declared after `variant` so
         these classes win the tailwind-merge conflict. */
      tinted: {
        true: "hover:border-transparent hover:bg-[color-mix(in_srgb,var(--action)_10%,transparent)] hover:text-(--action) [&.danger]:hover:bg-[color-mix(in_srgb,var(--err)_10%,transparent)] [&.danger]:hover:text-(--err)",
        false: "",
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
  tinted = false,
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
      className={cn(buttonVariants({ variant, size, tinted, className }))}
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
