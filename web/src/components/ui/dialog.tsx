"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"

/* Dialog — base-ui, replacing the app's hand-rolled modal contract.
   `useModalDrawer` implemented Escape, a Tab focus trap, autofocus, focus
   restore, and a body scroll lock by hand, and `useOverlayVisibility` plus
   `lib/drawerStack` implemented exit-animation-aware unmounting and a stack
   of underlaid panels on top of that. All of it was careful, and none of it
   was app-specific — it is the contract every dialog implementation has to
   satisfy, and hand-written focus traps are where accessibility regressions
   hide, because a broken one looks exactly like a working one.

   The mapping, so the CSS keeps making sense:

   - `.is-closing`  → `[data-ending-style]`. base-ui holds the element in the
     DOM for the exit animation and removes it when the animation ends, which
     is what `useOverlayVisibility` was measuring `--t-slow` to emulate.
   - `.is-underlay` → `[data-nested-dialog-open]`. base-ui knows a dialog has
     a nested one open, which is what `drawerStack` was tracking; it also
     scopes Escape and the focus trap to the innermost dialog, which is the
     other half of what the stack existed for.
   - `[data-modal-initial-focus]` → the popup's `initialFocus` prop.

   Backdrop and Viewport are separate elements here, where the old markup had
   one div doing both: the scrim paints, the viewport positions. Keeping them
   apart is what lets a nested drawer composite its own scrim over the one
   below without also re-running the positioning. */

const Dialog = DialogPrimitive.Root
const DialogPortal = DialogPrimitive.Portal
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

function DialogBackdrop({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-backdrop"
      className={cn("overlay-backdrop", className)}
      {...props}
    />
  )
}

/** Positions the popup. Transparent to the pointer so a click that misses the
 *  panel reaches the backdrop's dismissal, not this element. */
function DialogViewport({ className, ...props }: DialogPrimitive.Viewport.Props) {
  return (
    <DialogPrimitive.Viewport
      data-slot="dialog-viewport"
      className={cn("overlay-viewport", className)}
      {...props}
    />
  )
}

function DialogContent({ className, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Popup
      data-slot="dialog-content"
      className={cn(className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
}
