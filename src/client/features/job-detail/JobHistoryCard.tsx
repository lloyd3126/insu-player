import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { JobHistoryEntry } from "@shared/contracts/job"
import { formatDate } from "@shared/domain/format"
import { JOB_STATE_LABELS } from "@shared/domain/job-status"

export function JobHistoryCard({ history }: { history: JobHistoryEntry[] }) {
  return (
    <Card className="job-detail-card job-history-card">
      <CardHeader>
        <CardTitle>狀態歷程</CardTitle>
        <CardDescription>最新紀錄優先</CardDescription>
      </CardHeader>
      <CardContent className="job-history-card__content">
        <ScrollArea className="job-history-scroll">
          {history.length > 0 ? (
            <ol className="history-list">
              {[...history].reverse().map((entry, index) => (
                <li key={`${entry.at}-${index}`}>
                  <time>{formatDate(entry.at)}</time>
                  <Badge variant="outline">
                    {JOB_STATE_LABELS[entry.state ?? ""] ??
                      entry.state ??
                      "—"}
                  </Badge>
                  <span>{entry.message}</span>
                </li>
              ))}
            </ol>
          ) : (
            <span className="muted-copy">尚無紀錄</span>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
