import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { StatusBadge } from "@/components/shared/StatusBadge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { JobFact, JobFactGrid } from "@/features/job-detail/JobFactGrid"
import { useJobLog } from "@/hooks/use-job-detail"
import type { JobDetail } from "@shared/contracts/job"
import { formatDate } from "@shared/domain/format"

export function JobActivityPanel({ job }: { job: JobDetail }) {
  const log = useJobLog(job.videoId)

  return (
    <div className="job-activity-content">
      <JobFactGrid className="job-facts--activity">
        <JobFact label="目前狀態">
          <StatusBadge job={job} />
        </JobFact>
        <JobFact label="處理階段">{job.stage || "—"}</JobFact>
        <JobFact label="處理進度">{Math.round(job.progress)}%</JobFact>
        <JobFact label="最近更新">{formatDate(job.updatedAt)}</JobFact>
      </JobFactGrid>
      {job.lastError ? <ErrorState message={job.lastError} /> : null}
      <Card className="job-detail-card workflow-log-card">
        <CardHeader>
          <CardTitle>Workflow log</CardTitle>
          <CardDescription>最近 180 行</CardDescription>
        </CardHeader>
        <CardContent>
          {log.isPending ? <LoadingState label="正在讀取執行紀錄" /> : null}
          {log.isError ? <ErrorState message={log.error.message} /> : null}
          {log.data ? (
            <ScrollArea className="workflow-log-scroll">
              <pre className="workflow-log-content">
                {log.data.log || "尚無執行紀錄"}
              </pre>
            </ScrollArea>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
