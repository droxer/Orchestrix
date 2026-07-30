import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        /* Geometry is exact on the 4px grid: a 36px track with 2px padding
           leaves a 32px content box, so a 16px thumb travels exactly 16px
           (translate-x-4) and sits flush at both ends. The transparent border
           that used to wrap the track is gone — it stole 2px from that budget
           and its only job was focus/invalid state, which the shared
           box-shadow contract (--focus-ring / --focus-ring-danger) already
           carries. Keep the three numbers in sync if any one of them moves. */
        "group/switch relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-input p-0.5 transition-[background-color,box-shadow] outline-none after:absolute after:-inset-x-1 after:-inset-y-3 focus-visible:shadow-[var(--focus-ring)] data-checked:bg-[var(--action)] data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:shadow-(--focus-ring-danger)",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform data-checked:translate-x-4 data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
