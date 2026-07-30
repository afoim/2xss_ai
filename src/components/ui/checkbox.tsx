import * as React from "react"

import { cn } from "@/lib/utils"

interface CheckboxProps
  extends Omit<React.ComponentProps<"button">, "onClick" | "role" | "aria-checked"> {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

function Checkbox({
  className,
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  ...props
}: CheckboxProps) {
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
      role="checkbox"
      aria-checked={isChecked}
      data-slot="checkbox"
      data-checked={isChecked ? "" : undefined}
      disabled={disabled}
      onClick={toggle}
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center border border-input bg-background transition-colors duration-75 outline-none after:absolute after:-inset-x-2 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground",
        className
      )}
      {...props}
    >
      {isChecked && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="square"
          className="size-3"
          aria-hidden="true"
        >
          <path d="M4 12l6 6L20 6" />
        </svg>
      )}
    </button>
  )
}

export { Checkbox }
