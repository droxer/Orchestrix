"use client"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "@/lib/utils"

/* Table — the ARIA grid roles for this app's list surfaces, in one place.
   Five of them (the backlog, routines, and the admin nodes and employees
   views) each wrote `role="table"`, `role="row"`, `role="columnheader"`, and
   `role="cell"` by hand: 25 cells and 13 column headers of hand-typed ARIA,
   which is the kind of thing that goes wrong silently — a row that renders
   correctly with a cell missing its role reads as a row with fewer columns,
   and nothing on screen says so.

   These are DIVS, deliberately, not an HTML `<table>`. Every one of these
   lists restacks its rows into cards below a breakpoint and hides the header
   row entirely, which table layout cannot do — the roles are how the grid
   semantics survive the CSS that makes that restacking possible. Each part
   takes `render` so a surface can keep the element it already used (a `span`
   cell, an `article` row) without arguing about tag names.

   No chrome ships here on purpose. These lists are dense, virtualized, and
   individually laid out; a default padding or border would be overridden at
   every call site on its first day. */

function Table({ className, render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">({ role: "table", className: cn(className) }, props),
    render,
    state: { slot: "table" },
  })
}

/** Only needed where a surface groups rows into a head and a body; these
 *  lists mostly repeat one header row per group instead. */
function TableRowGroup({ className, render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">({ role: "rowgroup", className: cn(className) }, props),
    render,
    state: { slot: "table-row-group" },
  })
}

function TableRow({ className, render, ...props }: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">({ role: "row", className: cn(className) }, props),
    render,
    state: { slot: "table-row" },
  })
}

function TableHead({ className, render, ...props }: useRender.ComponentProps<"span">) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">({ role: "columnheader", className: cn(className) }, props),
    render,
    state: { slot: "table-head" },
  })
}

function TableCell({ className, render, ...props }: useRender.ComponentProps<"span">) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">({ role: "cell", className: cn(className) }, props),
    render,
    state: { slot: "table-cell" },
  })
}

export { Table, TableRowGroup, TableRow, TableHead, TableCell }
