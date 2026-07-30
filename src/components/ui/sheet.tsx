import * as React from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

type SheetSide = "top" | "right" | "bottom" | "left"

interface SheetContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const SheetContext = React.createContext<SheetContextValue | null>(null)

function useSheetContext() {
  const ctx = React.useContext(SheetContext)
  if (!ctx) throw new Error("Sheet components must be used within <Sheet>")
  return ctx
}

interface SheetProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

function Sheet({ open, defaultOpen = false, onOpenChange, children }: SheetProps) {
  const [internal, setInternal] = React.useState(defaultOpen)
  const isOpen = open ?? internal
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (open === undefined) setInternal(next)
      onOpenChange?.(next)
    },
    [open, onOpenChange]
  )
  return (
    <SheetContext.Provider value={{ open: isOpen, setOpen }}>
      {children}
    </SheetContext.Provider>
  )
}

function SheetTrigger({ onClick, ...props }: React.ComponentProps<"button">) {
  const { open, setOpen } = useSheetContext()
  return (
    <button
      type="button"
      data-slot="sheet-trigger"
      aria-haspopup="dialog"
      aria-expanded={open}
      data-popup-open={open ? "" : undefined}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) setOpen(true)
      }}
      {...props}
    />
  )
}

function SheetClose({ onClick, ...props }: React.ComponentProps<"button">) {
  const { setOpen } = useSheetContext()
  return (
    <button
      type="button"
      data-slot="sheet-close"
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) setOpen(false)
      }}
      {...props}
    />
  )
}

function SheetPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function SheetOverlay(_props: React.ComponentProps<"div">) {
  return null
}

const SIDE_DIALOG_CLASSES: Record<SheetSide, string> = {
  right:
    "m-0 ml-auto h-full max-h-full w-fit max-w-full",
  left: "m-0 mr-auto h-full max-h-full w-fit max-w-full",
  top: "m-0 mb-auto w-full max-w-full",
  bottom:
    "m-0 mt-auto w-full max-w-full",
}

const SIDE_PANEL_CLASSES: Record<SheetSide, string> = {
  right: "w-[75vw] sm:max-w-sm border-l border-foreground/80",
  left: "w-[75vw] sm:max-w-sm border-r border-foreground/80",
  top: "border-b border-foreground/80",
  bottom: "border-t border-foreground/80",
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<"div"> & {
  side?: SheetSide
  showCloseButton?: boolean
}) {
  const { open, setOpen } = useSheetContext()
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [visible, setVisible] = React.useState(false)
  const [closing, setClosing] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = undefined }
      setVisible(true)
      setClosing(false)
    } else if (visible) {
      setClosing(true)
      timerRef.current = setTimeout(() => {
        setClosing(false)
        setVisible(false)
        timerRef.current = undefined
      }, 200)
    }
  }, [open])

  React.useEffect(() => {
    const el = dialogRef.current
    if (!visible || !el) return
    if (!el.open) el.showModal()
    document.documentElement.style.overflow = "hidden"
    return () => {
      document.documentElement.style.overflow = ""
      if (el.open) el.close()
    }
  }, [visible])

  React.useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  if (!visible) return null

  const animClass = closing ? `shell-slide-out-${side}` : `shell-slide-${side}`

  return createPortal(
    <dialog
      ref={dialogRef}
      data-slot="sheet"
      data-side={side}
      className={cn(
        "bg-transparent p-0 outline-none",
        SIDE_DIALOG_CLASSES[side],
        animClass
      )}
      onCancel={(e) => {
        e.preventDefault()
        setOpen(false)
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "relative flex h-full w-full flex-col gap-4 bg-background text-sm text-foreground",
          SIDE_PANEL_CLASSES[side],
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetClose className="absolute top-3 right-3 inline-flex size-7 items-center justify-center border border-transparent font-mono text-muted-foreground transition-colors duration-75 outline-none hover:bg-foreground hover:text-background focus-visible:outline-2 focus-visible:outline-ring">
            <span aria-hidden="true">✕</span>
            <span className="sr-only">Close</span>
          </SheetClose>
        )}
      </div>
    </dialog>,
    document.body
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 border-b border-border p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 border-t border-border p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="sheet-title"
      className={cn(
        "font-mono text-base font-medium tracking-tight text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
