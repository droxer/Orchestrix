"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * A GFM table in its own horizontal scroll region.
 *
 * A table is the one block that cannot be reflowed to fit a narrow column, so
 * past a few columns it scrolls. That makes the wrapper a scrollable region,
 * and a scrollable region has to be reachable: without `tabindex` the clipped
 * columns are mouse-only, which is how a seven-column table ends up with three
 * columns no keyboard user can see. `role="region"` plus a name is what tells
 * a screen reader the thing it just focused is scrollable rather than stray
 * chrome (the pattern from Adrian Roselli's responsive-table write-up).
 */
export function MarkdownTable({
  children,
  // react-markdown passes its internal AST `node` to every component override;
  // spread onto the DOM it renders as `node="[object Object]"`.
  node: _node,
  ...rest
}: { children?: ReactNode; node?: unknown } & ComponentPropsWithoutRef<"table">) {
  const { t } = useTranslation();
  return (
    <div className="md-table" role="region" aria-label={t("message.table")} tabIndex={0}>
      <table {...rest}>{children}</table>
    </div>
  );
}
