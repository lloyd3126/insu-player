import { JobHistoryCard } from "@/features/job-detail/JobHistoryCard"
import type { JobDetail } from "@shared/contracts/job"

export function JobStatusPanel({ job }: { job: JobDetail }) {
  return (
    <div className="job-status-content">
      <JobHistoryCard history={job.history} />
    </div>
  )
}
