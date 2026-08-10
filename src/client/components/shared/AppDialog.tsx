import { cva, type VariantProps } from "class-variance-authority"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const contentVariants = cva("app-dialog", {
  variants: {
    size: {
      compact: "app-dialog--compact",
      default: "app-dialog--default",
      wide: "app-dialog--wide",
      screen: "app-dialog--screen",
    },
    height: {
      content: "app-dialog--content-height",
      screen: "app-dialog--screen-height",
    },
  },
  defaultVariants: { size: "default", height: "content" },
})

const bodyVariants = cva("app-dialog__body", {
  variants: {
    layout: {
      scroll: "app-dialog__body--scroll",
      tabbed: "app-dialog__body--tabbed",
    },
  },
  defaultVariants: { layout: "scroll" },
})

interface AppDialogProps
  extends VariantProps<typeof contentVariants>,
    VariantProps<typeof bodyVariants> {
  open: boolean
  onOpenChange: (open: boolean) => void
  kicker: string
  title: string
  description: string
  children: React.ReactNode
  className?: string
  overlayEmphasis?: React.ComponentProps<
    typeof DialogContent
  >["overlayEmphasis"]
}

export function AppDialog({
  open,
  onOpenChange,
  kicker,
  title,
  description,
  children,
  size,
  height,
  layout,
  className,
  overlayEmphasis,
}: AppDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayEmphasis={overlayEmphasis}
        className={cn(contentVariants({ size, height }), className)}
      >
        <DialogHeader className="app-dialog__header">
          <span className="app-dialog__kicker">{kicker}</span>
          <DialogTitle className="app-dialog__title">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {description}
          </DialogDescription>
        </DialogHeader>
        <div className={bodyVariants({ layout })}>{children}</div>
      </DialogContent>
    </Dialog>
  )
}
