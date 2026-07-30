import * as React from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface DialogContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

function useDialogContext() {
  const ctx = React.useContext(DialogContext)
  if (!ctx) throw new Error("Dialog components must be used within <Dialog>")
  return ctx
}

interface DialogProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}

function Dialog({ open, defaultOpen = false, onOpenChange, children }: DialogProps) {
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
    <DialogContext.Provider value={{ open: isOpen, setOpen }}>
      {children}
    </DialogContext.Provider>
  )
}

function DialogTrigger({
  onClick,
  ...props
}: React.ComponentProps<"button">) {
  const { open, setOpen } = useDialogContext()
  return (
    <button
      type="button"
      data-slot="dialog-trigger"
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

/* 兼容层：内容自身渲染在 portal + 原生 dialog 顶层，Portal/Overlay 无需额外实现 */
function DialogPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function DialogOverlay(_props: React.ComponentProps<"div">) {
  return null
}

function DialogClose({
  onClick,
  ...props
}: React.ComponentProps<"button">) {
  const { setOpen } = useDialogContext()
  return (
    <button
      type="button"
      data-slot="dialog-close"
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) setOpen(false)
      }}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onClick,
  onCancel,
  ...props
}: React.ComponentProps<"dialog"> & {
  showCloseButton?: boolean
}) {
  const { open, setOpen } = useDialogContext()
  const dialogRef = React.useRef<HTMLDialogElement>(null)

  React.useEffect(() => {
    const el = dialogRef.current
    if (!open || !el) return
    if (!el.open) el.showModal()
    document.documentElement.style.overflow = "hidden"
    return () => {
      document.documentElement.style.overflow = ""
      if (el.open) el.close()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <dialog
      ref={dialogRef}
      data-slot="dialog-content"
      // 面板样式与尺寸都在 <dialog> 元素上，消费者 className 可完全控制（含全屏）
      className={cn(
        "relative m-auto grid max-h-[85vh] w-full max-w-[calc(100%-2rem)] gap-4 overflow-y-auto border border-foreground/80 bg-background p-4 text-sm text-foreground outline-none backdrop:bg-black/70 sm:max-w-sm [animation:shell-fade-in_100ms_linear]",
        className
      )}
      onCancel={(e) => {
        onCancel?.(e)
        e.preventDefault()
        setOpen(false)
      }}
      onClick={(e) => {
        onClick?.(e)
        // 点击背板关闭：背板点击的 target 是 dialog 自身且坐标落在面板矩形之外
        if (e.defaultPrevented || e.target !== e.currentTarget) return
        const r = e.currentTarget.getBoundingClientRect()
        const outside =
          e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
        if (outside) setOpen(false)
      }}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogClose
          className={cn(
            "absolute top-2 right-2 inline-flex size-7 items-center justify-center border border-transparent font-mono text-muted-foreground transition-colors duration-75 outline-none hover:bg-foreground hover:text-background focus-visible:outline-2 focus-visible:outline-ring"
          )}
        >
          <span aria-hidden="true">✕</span>
          <span className="sr-only">Close</span>
        </DialogClose>
      )}
    </dialog>,
    document.body
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 border-t border-border bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogCloseButton />
      )}
    </div>
  )
}

function DialogCloseButton() {
  const { setOpen } = useDialogContext()
  return (
    <Button variant="outline" onClick={() => setOpen(false)}>
      Close
    </Button>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="dialog-title"
      className={cn(
        "font-mono text-base leading-none font-medium tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
