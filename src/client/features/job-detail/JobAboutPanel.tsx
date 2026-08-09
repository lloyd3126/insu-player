import { StatusBadge } from "@/components/shared/StatusBadge"
import { JobFact, JobFactGrid } from "@/features/job-detail/JobFactGrid"
import { JobHistoryCard } from "@/features/job-detail/JobHistoryCard"
import type { JobDetail } from "@shared/contracts/job"
import { formatBytes, formatDate, formatDuration } from "@shared/domain/format"

function sourceLabel(sourceUrl: string) {
  if (!sourceUrl) return "—"
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "")
  } catch {
    return sourceUrl
  }
}

export function JobAboutPanel({ job }: { job: JobDetail }) {
  return (
    <div className="job-about-content">
      <JobFactGrid className="job-about-facts">
        <JobFact label="目前狀態">
          <StatusBadge job={job} />
        </JobFact>
        <JobFact label="來源">
          {job.sourceUrl ? (
            <a
              className="job-source-link"
              href={job.sourceUrl}
              target="_blank"
              rel="noreferrer"
              title={job.sourceUrl}
            >
              {sourceLabel(job.sourceUrl)}
            </a>
          ) : (
            "—"
          )}
        </JobFact>
        <JobFact label="時長">
          {formatDuration(job.durationSeconds) ?? "—"}
        </JobFact>
        <JobFact label="容量">{formatBytes(job.sizeBytes)}</JobFact>
        <JobFact label="影音 ID">{job.videoId}</JobFact>
        <JobFact label="建立時間">{formatDate(job.createdAt)}</JobFact>
        <JobFact label="更新時間">{formatDate(job.updatedAt)}</JobFact>
        <JobFact label="完成時間">{formatDate(job.completedAt)}</JobFact>
      </JobFactGrid>
      <JobHistoryCard history={job.history} />
    </div>
  )
}
