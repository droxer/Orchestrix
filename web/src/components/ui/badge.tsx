import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-sm border px-3 py-1 text-xs font-semibold w-fit whitespace-nowrap shrink-0 gap-1 overflow-hidden [&>svg]:size-3 pointer-events-none focus-visible:shadow-[var(--ring-focus)] focus-visible:ring-0 transition-[color,box-shadow,border-color,background]",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        secondary: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive: "border-destructive/30 bg-background text-destructive [a&]:hover:border-destructive",
        outline: "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        // Status tones — carry a leading dot so they read as live status
        // indicators (the former .pill good/info/warn/bad vocabulary).
        neutral:
          "border-hairline bg-surface-strong text-ink before:content-[''] before:size-1.5 before:rounded-full before:bg-muted-soft",
        success:
          "border-success/35 bg-background text-success before:content-[''] before:size-1.5 before:rounded-full before:bg-success",
        info:
          "border-primary/25 bg-background text-primary before:content-[''] before:size-1.5 before:rounded-full before:bg-primary",
        warning:
          "border-hairline bg-background text-muted-foreground before:content-[''] before:size-1.5 before:rounded-full before:bg-warning",
        danger:
          "border-danger/35 bg-background text-destructive before:content-[''] before:size-1.5 before:rounded-full before:bg-danger",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
