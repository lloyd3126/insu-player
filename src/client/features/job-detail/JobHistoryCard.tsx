import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { JobHistoryEntry } from "@shared/contracts/job"
import { formatDate } from "@shared/domain/format"
import { JOB_STATE_LABELS } from "@shared/domain/job-status"

function keyedHistory(history: JobHistoryEntry[]) {
  const occurrences = new Map<string, number>()
  return history.map((entry) => {
    const signature = [entry.at, entry.state, entry.stage, entry.message].join(":")
    const occurrence = occurrences.get(signature) ?? 0
    occurrences.set(signature, occurrence + 1)
    return {
      entry,
      key: entry.sequence ?? `${signature}:${occurrence}`,
    }
  })
}

export function JobHistoryCard({ history }: { history: JobHistoryEntry[] }) {
  return (
    <Card className="job-detail-card job-history-card">
      <CardContent className="job-history-card__content">
        <Table
          className="history-table"
          containerClassName="history-table-container"
        >
          <TableHeader>
            <TableRow>
              <TableHead className="history-table__time">時間</TableHead>
              <TableHead className="history-table__status">狀態</TableHead>
              <TableHead>訊息</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="history-table__body">
            {history.length > 0 ? (
              keyedHistory(history).reverse().map(({ entry, key }) => (
                <TableRow key={key}>
                  <TableCell className="history-table__time">
                    <time>{formatDate(entry.at)}</time>
                  </TableCell>
                  <TableCell className="history-table__status">
                    <Badge variant="outline">
                      {JOB_STATE_LABELS[entry.state ?? ""] ??
                        entry.state ??
                        "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="history-table__message">
                    {entry.message || "—"}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell className="history-table__empty" colSpan={3}>
                  尚無紀錄
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
