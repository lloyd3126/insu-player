import { EmptyState } from "@/components/shared/AsyncState"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { CaptionComparisonResponse } from "@shared/contracts/caption"
import { formatCaptionTime } from "@shared/domain/format"

export function CaptionComparisonTable({
  comparison,
}: {
  comparison: CaptionComparisonResponse
}) {
  if (comparison.tracks.length === 0) {
    return (
      <EmptyState
        title="尚無字幕"
        description="這支影音目前沒有可供對照的字幕軌。"
      />
    )
  }
  if (comparison.rows.length === 0) {
    return (
      <EmptyState
        title="字幕無法讀取"
        description="字幕軌存在，但沒有可顯示的 WebVTT cue。"
      />
    )
  }
  return (
    <section className="caption-comparison" aria-labelledby="caption-comparison-title">
      <div className="caption-comparison__header">
        <div>
          <span className="section-index">BILINGUAL TIMELINE</span>
          <h3 id="caption-comparison-title">多語字幕對照</h3>
        </div>
        <p>
          以 <Badge variant="secondary">{comparison.baselineLanguage}</Badge>{" "}
          時間段為基準
        </p>
      </div>
      <div className="caption-table-frame">
        <Table className="caption-table">
          <TableHeader>
            <TableRow>
              <TableHead>時間</TableHead>
              {comparison.tracks.map((track) => (
                <TableHead key={track.code}>{track.code}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison.rows.map((row, index) => (
              <TableRow key={`${row.start}-${row.end}-${index}`}>
                <TableCell>
                  <time>
                    {formatCaptionTime(row.start)} → {formatCaptionTime(row.end)}
                  </time>
                </TableCell>
                {comparison.tracks.map((track) => (
                  <TableCell key={track.code} lang={track.code}>
                    {row.cues[track.code] || "—"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
