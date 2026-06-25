"use client";

import type { ReactNode } from "react";

// Shared route header — fixes the header height, spacing, and typography in
// one place so per-route copies can't drift. Title sits on the baseline with
// an optional mono count; `actions` render right-aligned (refresh + primary).
export function PageHeader({
  title,
  count,
  actions,
}: {
  title: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex min-h-[var(--header-h)] shrink-0 items-center justify-between gap-base border-b border-hairline px-xl max-[820px]:px-base">
      <div className="flex min-w-0 items-baseline gap-sm">
        <h1 className="m-0 text-lg font-semibold leading-[1.25] text-balance text-ink">{title}</h1>
        {count != null ? (
          <span className="mono truncate text-xs font-medium text-muted-foreground">{count}</span>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-xs">{actions}</div> : null}
    </header>
  );
}
