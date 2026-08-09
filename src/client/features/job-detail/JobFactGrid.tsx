import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function JobFactGrid({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn("job-facts", className)}>{children}</div>
}

export function JobFact({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="job-fact">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  )
}
