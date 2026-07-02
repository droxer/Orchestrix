"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared route header — fixes the header height, spacing, and typography in
// one place so per-route copies can't drift. Title sits on the baseline with
// an optional mono count; `actions` render right-aligned (refresh + primary).
export function PageHeader({
  title,
  count,
  actions,
  titleVariant = "default",
}: {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  /** `display` — admin page title per design system (`--type-display-lg`). */
  titleVariant?: "default" | "display";
}) {
  return (
    <header className="flex min-h-[var(--header-h)] shrink-0 items-center justify-between gap-base border-b border-hairline px-xl max-[820px]:px-base">
      <div className="flex min-w-0 items-baseline gap-sm">
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
      {actions ? <div className="flex shrink-0 items-center gap-xs">{actions}</div> : null}
    </header>
  );
}
