import type { ReactNode } from "react"

import {
  FlowCard,
  FlowCardHeader,
} from "@/components/shared/prompt-cards/FlowCardHeader"
import {
  CardContent,
  CardFooter,
} from "@/components/ui/card"

export function TutorialCard({
  kicker,
  title,
  description,
  children,
  footer,
}: {
  kicker: string
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <FlowCard className="tutorial-card">
      <FlowCardHeader
        kicker={kicker}
        title={title}
        description={description}
      />
      <CardContent>{children}</CardContent>
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </FlowCard>
  )
}

export function TutorialStepList({ children }: { children: ReactNode }) {
  return <ol className="tutorial-step-list">{children}</ol>
}

export function TutorialStep({
  number,
  title,
  description,
}: {
  number: string
  title: string
  description: string
}) {
  return (
    <li>
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
    </li>
  )
}
