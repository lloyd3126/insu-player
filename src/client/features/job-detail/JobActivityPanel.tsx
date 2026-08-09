import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { PromptActionCard } from "@/components/shared/prompt-cards/PromptActionCard"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useJobLog } from "@/hooks/use-job-detail"
import type { JobDetail } from "@shared/contracts/job"

function activityPrompt(job: JobDetail) {
  return [
    "請檢查 INSU Player 中以下影音的目前狀態與 Workflow log，判斷是否有錯誤或中斷。請保留已完成的影音與字幕，先說明原因和下一步。若能安全接續，請從正確階段繼續處理。",
    `影音 ID：${job.videoId}`,
    `影音標題：${job.title}`,
  ].join("\n")
}

export function JobActivityPanel({ job }: { job: JobDetail }) {
  const log = useJobLog(job.videoId)

  return (
    <div className="job-activity-content">
      <PromptActionCard
        kicker="CHECK / WORKFLOW"
        title="請 Agent 檢查紀錄"
        description="複製提示，請 Agent 根據目前狀態與 Workflow log 找出問題，保留已完成成果並從正確階段接續。"
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
