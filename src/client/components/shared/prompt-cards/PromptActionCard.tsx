import type { ReactNode } from "react"

import { CopyButton } from "@/components/shared/CopyButton"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface PromptActionCardProps {
  kicker: string
  title: string
  description: string
  prompt: string
  copyLabel?: string
  copyDisabled?: boolean
  children?: ReactNode
}

function PromptActionCardLayout({
  kicker,
  title,
  description,
  prompt,
  copyLabel,
  copyDisabled,
  children,
  className,
}: PromptActionCardProps & { className: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <span className="section-index">{kicker}</span>
        <CardTitle role="heading" aria-level={3}>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <CopyButton
            value={prompt}
            label={copyLabel}
            disabled={copyDisabled}
          />
        </CardAction>
      </CardHeader>
      {children ? <CardContent>{children}</CardContent> : null}
    </Card>
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
