import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-12 w-full min-w-0 rounded-md border border-input bg-background px-4 py-[14px] text-md transition-[color,box-shadow,border-color] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-ring focus-visible:shadow-[var(--ring-focus)] focus-visible:ring-0",
        "aria-invalid:border-destructive aria-invalid:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-semantic-down)_28%,transparent)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
