import type { ReactNode } from "react"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function TutorialCard({
  kicker,
  title,
  children,
}: {
  kicker: string
  title: string
  children: ReactNode
}) {
  return (
    <Card className="tutorial-card">
      <CardHeader>
        <span className="section-index">{kicker}</span>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
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

export function TutorialExample({ children }: { children: ReactNode }) {
  return <pre className="prompt-code tutorial-card__example">{children}</pre>
}
