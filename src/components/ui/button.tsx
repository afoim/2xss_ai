import * as React from "react"

import { cn } from "@/lib/utils"

type ButtonVariant =
  | "default"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive"
  | "link"

type ButtonSize =
  | "default"
  | "xs"
  | "sm"
  | "lg"
  | "icon"
  | "icon-xs"
  | "icon-sm"
  | "icon-lg"

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // 反色选择：主按钮即「终端选区」，白底黑字
  default:
    "border-primary bg-primary text-primary-foreground hover:bg-transparent hover:text-foreground",
  // 空心块：hover 时反色
  outline:
    "border-border bg-transparent text-foreground hover:border-foreground hover:bg-foreground hover:text-background aria-expanded:bg-foreground aria-expanded:text-background",
  // 灰色堆栈块
  secondary:
    "border-secondary bg-secondary text-secondary-foreground hover:bg-foreground hover:border-foreground",
  ghost:
    "border-transparent text-muted-foreground hover:bg-foreground hover:text-background aria-expanded:bg-foreground aria-expanded:text-background",
  destructive:
    "border-destructive bg-transparent text-destructive hover:bg-destructive hover:text-background",
  link: "border-transparent text-foreground underline-offset-4 hover:underline",
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  default: "h-8 gap-1.5 px-3",
  xs: "h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
  sm: "h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
  lg: "h-9 gap-1.5 px-4",
  icon: "size-8",
  "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
  "icon-sm": "size-7",
  "icon-lg": "size-9",
}

function buttonVariants({
  variant = "default",
  size = "default",
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
} = {}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap border font-mono text-sm font-medium tracking-tight transition-colors duration-75 outline-none select-none focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className
  )
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<"button"> & {
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  return (
    <button
      data-slot="button"
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  )
}

export { Button, buttonVariants }
