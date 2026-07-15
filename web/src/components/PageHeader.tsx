"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared route header — fixes the header height, spacing, and typography in
// one place so per-route copies can't drift. Title sits on the baseline with
// an optional mono count; `actions` render right-aligned (refresh + primary).
export function PageHeader({
  title,
  count,
  kicker,
  subtitle,
  toolbar,
  actions,
  titleVariant = "default",
  layout = "inline",
}: {
  title: ReactNode;
  count?: ReactNode;
  kicker?: ReactNode;
  subtitle?: ReactNode;
  toolbar?: ReactNode;
  actions?: ReactNode;
  /** `display` — stacked route title (`--type-title-lg`). */
  titleVariant?: "default" | "display";
  /** `stacked` — kicker, title, subtitle, and toolbar in a left column (admin). */
  layout?: "inline" | "stacked";
}) {
  const stacked = layout === "stacked";

  return (
    <header
      className={cn(
        "page-header surface-header flex shrink-0 justify-between gap-base px-xl max-[820px]:px-base",
        stacked ? "items-start py-lg" : "min-h-[var(--header-h)] items-center max-[820px]:py-sm",
      )}
    >
      <div
        className={cn(
          "page-header-lead flex min-w-0",
          stacked ? "flex-col gap-xs" : "items-baseline gap-sm",
        )}
      >
        {kicker ? <span className="page-header-kicker">{kicker}</span> : null}
        <div className={cn("flex min-w-0 items-baseline gap-sm", stacked && "flex-wrap")}>
          <h1
            className={cn(
              "m-0 text-balance text-ink",
              titleVariant === "display"
                ? "page-header-title--display"
                : "text-lg font-semibold leading-[1.25]",
            )}
          >
            {title}
          </h1>
          {count != null ? (
            <span className="mono truncate text-xs font-medium text-muted-foreground">{count}</span>
          ) : null}
        </div>
        {subtitle ? <p className="page-header-subtitle">{subtitle}</p> : null}
        {toolbar ? <div className="page-header-toolbar">{toolbar}</div> : null}
      </div>
      {actions ? (
        <div className={cn("page-header-actions flex shrink-0 flex-wrap items-center justify-end gap-xs", stacked && "pt-0.5")}>
          {actions}
        </div>
      ) : null}
    </header>
  );
}
