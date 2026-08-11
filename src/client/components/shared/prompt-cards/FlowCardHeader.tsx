import type { ComponentProps, ReactNode } from "react"

import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function FlowCard({ className, ...props }: ComponentProps<typeof Card>) {
  return <Card className={cn("flow-card", className)} {...props} />
}

export function FlowCardHeader({
  kicker,
  title,
  description,
  action,
}: {
  kicker: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <CardHeader className="flow-card-header">
      <span className="section-index">{kicker}</span>
      <CardTitle role="heading" aria-level={3}>
        {title}
      </CardTitle>
      {description ? <CardDescription>{description}</CardDescription> : null}
      {action ? <CardAction>{action}</CardAction> : null}
    </CardHeader>
  )
}
