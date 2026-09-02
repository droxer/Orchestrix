"use client";

import { useTranslation } from "react-i18next";

import { sortIndicator, type SortDirection, type SortState } from "../../lib/listSort";
import { ICON, SortAscending, SortDescending, SortInactive } from "../icons";
import { TableHead } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

/**
 * A sortable column header for the app's ruled list surfaces.
 *
 * It renders the column-header element itself (a `TableHead`) and takes the surface's
 * own head-cell class through `className`, because the column WIDTHS live in
 * each list's stylesheet — `.backlog-rows-head-due` is 116px there and
 * nowhere else, and duplicating the track here is exactly the head/row drift
 * the backlog stylesheet already warns about. What this owns is the
 * affordance: the button, the caret, `aria-sort`, and the announced label.
 *
 * `aria-sort` goes on the columnheader (where assistive tech reads it) while
 * the button carries a full-sentence `aria-label` saying what the NEXT click
 * does — "Sort by Due, descending" — since the visible label alone tells a
 * screen-reader user nothing about the control's effect.
 */
export function SortableColumnHeader<K extends string>({
  className,
  label,
  sortKey,
  sort,
  onSort,
  align = "start",
  defaultDirection = "asc",
}: {
  className?: string;
  label: string;
  sortKey: K;
  sort: SortState<K> | null;
  onSort: (key: K) => void;
  /** Match the column's own text alignment — numeric columns sit flush right. */
  align?: "start" | "end";
  /**
   * The direction this column opens on — must match the `SortColumn` entry,
   * or the announced label promises a direction the click will not produce.
   */
  defaultDirection?: SortDirection;
}) {
  const { t } = useTranslation();
  const { active, direction, ariaSort } = sortIndicator(sort, sortKey);

  return (
    <TableHead className={className} aria-sort={ariaSort}>
      <Button
        variant="ghost"
        type="button"
        className="list-sort-button"
        data-active={active ? "true" : "false"}
        data-align={align}
        onClick={() => onSort(sortKey)}
        aria-label={sortActionLabel(t, label, direction, defaultDirection)}
      >
        <span className="list-sort-label">{label}</span>
        <SortCaret direction={direction} />
      </Button>
    </TableHead>
  );
}

/**
 * The caret reserves its box on every sortable column, active or not — an
 * icon that appears only on the sorted column shifts the other labels
 * sideways the moment you click one.
 */
function SortCaret({ direction }: { direction: SortDirection | null }) {
  const Glyph = direction === "asc" ? SortAscending : direction === "desc" ? SortDescending : SortInactive;
  return <Glyph className="list-sort-caret" size={ICON.xs} aria-hidden="true" />;
}

function sortActionLabel(
  t: ReturnType<typeof useTranslation>["t"],
  label: string,
  direction: SortDirection | null,
  defaultDirection: SortDirection,
): string {
  // Announces the outcome of the NEXT press, so it has to mirror the cycle in
  // `nextSortState` exactly: unsorted → the column's default direction →
  // reversed → unsorted.
  if (direction === null) return sortDirectionLabel(t, label, defaultDirection);
  if (direction === defaultDirection) {
    return sortDirectionLabel(t, label, defaultDirection === "asc" ? "desc" : "asc");
  }
  return t("list.sort_clear", { column: label });
}

function sortDirectionLabel(
  t: ReturnType<typeof useTranslation>["t"],
  label: string,
  direction: SortDirection,
): string {
  return direction === "desc"
    ? t("list.sort_by_descending", { column: label })
    : t("list.sort_by_ascending", { column: label });
}
