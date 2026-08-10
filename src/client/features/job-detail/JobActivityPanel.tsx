import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { PromptActionCard } from "@/components/shared/prompt-cards/PromptActionCard"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { jobPromptContext } from "@/features/job-detail/job-prompt-context"
import { useJobLog } from "@/hooks/use-job-detail"
import type { JobDetail } from "@shared/contracts/job"
import { buildRecoveryPrompt } from "@shared/prompts/insu-prompts"

function activityPrompt(job: JobDetail) {
  return buildRecoveryPrompt(jobPromptContext(job))
}

export function JobActivityPanel({ job }: { job: JobDetail }) {
  const log = useJobLog(job.videoId)

  return (
    <div className="job-activity-content">
      <PromptActionCard
        kicker="CHECK / WORKFLOW"
        title="請 Agent 檢查紀錄"
        description="複製目前狀態提示，讓 Agent 唯讀確認程序與產物，只接續精確失敗階段。"
        prompt={activityPrompt(job)}
      />
      {job.lastError ? <ErrorState message={job.lastError} /> : null}
      <Card className="job-detail-card workflow-log-card">
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
