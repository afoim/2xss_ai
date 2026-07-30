import * as React from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

/** SSR 阶段退化为 useEffect（服务端不存在布局，React 也会对 useLayoutEffect 告警） */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect

type MenuAlign = "start" | "center" | "end"
type MenuSide = "top" | "bottom" | "left" | "right"

interface MenuContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
}

const MenuContext = React.createContext<MenuContextValue | null>(null)

function useMenuContext() {
  const ctx = React.useContext(MenuContext)
  if (!ctx)
    throw new Error("DropdownMenu components must be used within <DropdownMenu>")
  return ctx
}

interface DropdownMenuProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

function DropdownMenu({
  open,
  defaultOpen = false,
  onOpenChange,
  children,
}: DropdownMenuProps) {
  const [internal, setInternal] = React.useState(defaultOpen)
  const isOpen = open ?? internal
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (open === undefined) setInternal(next)
      onOpenChange?.(next)
    },
    [open, onOpenChange]
  )
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  return (
    <MenuContext.Provider value={{ open: isOpen, setOpen, triggerRef }}>
      {children}
    </MenuContext.Provider>
  )
}

function DropdownMenuPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function DropdownMenuTrigger({
  onClick,
  onKeyDown,
  ...props
}: React.ComponentProps<"button">) {
  const { open, setOpen, triggerRef } = useMenuContext()
  return (
    <button
      type="button"
      ref={triggerRef}
      data-slot="dropdown-menu-trigger"
      aria-haspopup="menu"
      aria-expanded={open}
      data-popup-open={open ? "" : undefined}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) setOpen(!open)
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (!e.defaultPrevented && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault()
          setOpen(true)
        }
      }}
      {...props}
    />
  )
}

function getMenuItems(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(
    root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
  )
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  align?: MenuAlign
  alignOffset?: number
  side?: MenuSide
  sideOffset?: number
}) {
  const { open, setOpen, triggerRef } = useMenuContext()
  const contentRef = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState<{
    top: number
    left: number
    anchorWidth: number
  } | null>(null)

  const updatePosition = React.useCallback(() => {
    const trigger = triggerRef.current
    const content = contentRef.current
    if (!trigger || !content) return
    const rect = trigger.getBoundingClientRect()
    const { offsetWidth: w, offsetHeight: h } = content
    const vw = window.innerWidth
    const vh = window.innerHeight

    let top: number
    if (side === "top") {
      top = rect.top - sideOffset - h
      if (top < 8 && rect.bottom + sideOffset + h <= vh - 8)
        top = rect.bottom + sideOffset
    } else {
      top = rect.bottom + sideOffset
      if (top + h > vh - 8 && rect.top - sideOffset - h >= 8)
        top = rect.top - sideOffset - h
    }

    let left: number
    if (align === "end") left = rect.right - w - alignOffset
    else if (align === "center") left = rect.left + (rect.width - w) / 2
    else left = rect.left + alignOffset
    left = Math.min(Math.max(left, 8), Math.max(vw - w - 8, 8))

    setPos({ top, left, anchorWidth: rect.width })
  }, [align, alignOffset, side, sideOffset, triggerRef])

  // 菜单内容在关闭时返回 null，但 hooks 仍会在 SSR 阶段求值；直接用
  // useLayoutEffect 会让 React 在服务端渲染每个下拉菜单时都告警。
  useIsomorphicLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [open, updatePosition])

  React.useEffect(() => {
    if (!open) return
    const handleReposition = () => updatePosition()
    window.addEventListener("resize", handleReposition)
    window.addEventListener("scroll", handleReposition, true)
    return () => {
      window.removeEventListener("resize", handleReposition)
      window.removeEventListener("scroll", handleReposition, true)
    }
  }, [open, updatePosition])

  // 打开后聚焦首项；外部点击 / Escape 关闭
  React.useEffect(() => {
    if (!open) return
    const items = getMenuItems(contentRef.current)
    items[0]?.focus()

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (contentRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false)
        triggerRef.current?.focus()
      } else if (e.key === "Tab") {
        setOpen(false)
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open, setOpen, triggerRef])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End")
      return
    e.preventDefault()
    const items = getMenuItems(contentRef.current)
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLElement)
    let next: number
    if (e.key === "Home") next = 0
    else if (e.key === "End") next = items.length - 1
    else if (e.key === "ArrowDown") next = current < items.length - 1 ? current + 1 : 0
    else next = current > 0 ? current - 1 : items.length - 1
    items[next]?.focus()
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed z-50"
      style={{
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        width: pos?.anchorWidth,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div
        ref={contentRef}
        role="menu"
        data-slot="dropdown-menu-content"
        onKeyDown={handleKeyDown}
        className={cn(
          "w-max min-w-32 max-h-[min(24rem,calc(100vh-2rem))] overflow-x-hidden overflow-y-auto border border-foreground/80 bg-popover p-1 font-mono text-popover-foreground outline-none [animation:shell-fade-in_75ms_linear]",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

function DropdownMenuGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="dropdown-menu-group"
      className={className}
      {...props}
    />
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  disabled,
  onClick,
  onKeyDown,
  ...props
}: React.ComponentProps<"div"> & {
  inset?: boolean
  variant?: "default" | "destructive"
  disabled?: boolean
}) {
  const { setOpen } = useMenuContext()
  return (
    <div
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      onClick={(e) => {
        if (disabled) return
        onClick?.(e)
        setOpen(false)
      }}
      onMouseMove={(e) => {
        if (!disabled) e.currentTarget.focus()
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented || disabled) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          const interactive = e.currentTarget.querySelector<HTMLElement>("a,button")
          ;(interactive ?? e.currentTarget).click()
        }
      }}
      className={cn(
        // 反色选择：聚焦即终端选区
        "relative flex cursor-default items-center gap-1.5 px-2 py-1.5 text-sm outline-none select-none focus:bg-foreground focus:text-background not-data-[variant=destructive]:focus:**:text-background data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive data-[variant=destructive]:focus:text-background data-[variant=destructive]:focus:**:text-background aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      role="separator"
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
}
