import type { ReactNode } from "react"

import { CopyButton } from "@/components/shared/CopyButton"
import {
  FlowCard,
  FlowCardHeader,
} from "@/components/shared/prompt-cards/FlowCardHeader"
import {
  CardContent,
  CardFooter,
} from "@/components/ui/card"

interface PromptActionCardProps {
  kicker: string
  title: string
  description: string
  prompt: string
  copyLabel?: string
  copyDisabled?: boolean
  onCopied?: () => void
  children?: ReactNode
  footer?: ReactNode
}

function PromptActionCardLayout({
  kicker,
  title,
  description,
  prompt,
  copyLabel,
  copyDisabled,
  onCopied,
  children,
  footer,
  className,
}: PromptActionCardProps & { className: string }) {
  return (
    <FlowCard className={className}>
      <FlowCardHeader
        kicker={kicker}
        title={title}
        description={description}
        action={(
          <CopyButton
            value={prompt}
            label={copyLabel}
            disabled={copyDisabled}
            onCopied={onCopied}
          />
        )}
      />
      {children ? <CardContent>{children}</CardContent> : null}
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </FlowCard>
  )
}

export function PromptActionCard(props: PromptActionCardProps) {
  return <PromptActionCardLayout {...props} className="prompt-action-card" />
}

export function CompactPromptActionCard(props: PromptActionCardProps) {
  return (
    <PromptActionCardLayout
      {...props}
      className="prompt-action-card prompt-action-card--compact"
    />
  )
}
