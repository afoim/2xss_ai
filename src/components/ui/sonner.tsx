import { useTheme } from "@/components/theme/ThemeProvider"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { Spinner } from "@/components/ui/spinner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <span className="font-mono text-sm">✓</span>,
        info: <span className="font-mono text-sm">i</span>,
        warning: <span className="font-mono text-sm">!</span>,
        error: <span className="font-mono text-sm text-destructive">✕</span>,
        loading: <Spinner className="size-3.5" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--foreground)",
          "--border-radius": "0px",
          fontFamily: "var(--font-geist-mono)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      closeButton
      {...props}
    />
  )
}

export { Toaster }
