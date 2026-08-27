import type { CSSProperties } from "react"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@/lib/utils"

/* Table — the ruled-row list language that backlog.css, teams.css,
   admin-v2-views.css (×3), and agents.css each re-declared by hand: a sticky
   column header over hairline-ruled rows with a wash on hover.

   Why this is div+ARIA and not shadcn's `<table>` DOM
   ---------------------------------------------------
   Every one of these lists collapses into a stacked card below 820px, where the
   column header is hidden and each cell grows its own micro-label. A real
   `<table>` cannot restack without `display: block`, which drops the row/cell
   semantics that make the desktop layout accessible in the first place. So this
   keeps the explicit ARIA grid roles (which the surfaces already used) and
   adopts shadcn's slot vocabulary and metrics instead of its element structure.

   One grid declaration, not two
   -----------------------------
   `columns` sets --table-cols on the root; the header and every row read that
   same variable. Previously each surface declared the template twice — once on
   the head, once on the row — and they drifted (gap --sp-3 vs --sp-4 vs --sp-6,
   head padding `--sp-2 --sp-3` vs `0 0 --sp-3`). */

type TableProps = useRender.ComponentProps<"div"> & {
  /** grid-template-columns shared by the header and every row. */
  columns: string
}

function Table({ className, columns, style, render, ...props }: TableProps) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        role: "table",
        className: cn("min-w-0 text-sm", className),
        style: { "--table-cols": columns, ...style } as CSSProperties,
      },
      props
    ),
    render,
    state: { slot: "table" },
  })
}

/* Sticky header. `bg-background` is required, not decorative — rows scroll
   underneath it. */
function TableHeader({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        role: "row",
        className: cn(
          "sticky top-0 z-1 grid grid-cols-(--table-cols) items-center gap-3 border-b border-hairline bg-background px-3 py-2",
          className
        ),
      },
      props
    ),
    render,
    state: { slot: "table-header" },
  })
}

/* Micro-caps column label — the one type role these lists already shared. */
function TableHead({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        role: "columnheader",
        className: cn(
          "min-w-0 truncate text-micro font-bold tracking-(--track-caps) text-muted-foreground uppercase",
          className
        ),
      },
      props
    ),
    render,
    state: { slot: "table-head" },
  })
}

function TableBody({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      { role: "rowgroup", className: cn("min-w-0", className) },
      props
    ),
    render,
    state: { slot: "table-body" },
  })
}

/* Rows rule with the SOFT hairline while the header rules with the structural
   one, so the header edge stays the strongest horizontal line in the list.
   `data-selected` carries the selection wash and the 2px leading accent; the
   transparent default border reserves the accent's space so selecting a row
   never shifts its content sideways. */
function TableRow({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        role: "row",
        className: cn(
          "grid min-w-0 grid-cols-(--table-cols) items-center gap-3 border-b border-l-2 border-hairline-soft border-l-transparent px-3 py-3 transition-[background-color,border-color] duration-(--t-fast) ease-(--ease)",
          "hover:bg-row-hover",
          "data-[selected=true]:border-l-primary data-[selected=true]:bg-brand-soft",
          className
        ),
      },
      props
    ),
    render,
    state: { slot: "table-row" },
  })
}

function TableCell({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      { role: "cell", className: cn("min-w-0", className) },
      props
    ),
    render,
    state: { slot: "table-cell" },
  })
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow }
