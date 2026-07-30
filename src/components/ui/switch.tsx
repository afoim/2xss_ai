import * as React from "react"

import { cn } from "@/lib/utils"

interface SwitchProps
  extends Omit<React.ComponentProps<"button">, "onClick" | "role" | "aria-checked"> {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  size?: "sm" | "default"
}

function Switch({
  className,
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  size = "default",
  ...props
}: SwitchProps) {
  const [internal, setInternal] = React.useState(defaultChecked)
  const isChecked = checked ?? internal

  const toggle = () => {
    const next = !isChecked
    if (checked === undefined) setInternal(next)
    onCheckedChange?.(next)
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      data-slot="switch"
      data-size={size}
      data-checked={isChecked ? "" : undefined}
      disabled={disabled}
      onClick={toggle}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center border border-input bg-background p-px transition-colors duration-75 outline-none after:absolute after:-inset-x-2 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-primary data-[size=default]:h-[18px] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6",
        className
      )}
      {...props}
    >
      {/* 块状滑块：选中即反色白块滑到右侧 */}
      <span
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block bg-muted-foreground transition-transform duration-75",
          size === "default" ? "size-3.5" : "size-2.5",
          isChecked &&
            "bg-primary " +
            (size === "default" ? "translate-x-[14px]" : "translate-x-[10px]")
        )}
      />
    </button>
  )
}

export { Switch }
