import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { JobSummary } from "@shared/contracts/job"
import { phaseForJob, statusTone } from "@shared/domain/job-status"

export function StatusBadge({ job }: { job: JobSummary }) {
  const tone = statusTone(job)
  return (
    <Badge
      variant="outline"
      className={cn("status-badge", `status-badge--${tone}`)}
    >
      {phaseForJob(job)}
    </Badge>
  )
}
