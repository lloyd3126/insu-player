import { memo } from "react"

import { EmptyState } from "@/components/shared/AsyncState"
import { Badge } from "@/components/ui/badge"
import { useVirtualRows } from "@/hooks/use-virtual-rows"
import type {
  CaptionComparisonResponse,
  CaptionComparisonRow,
  CaptionTrack,
} from "@shared/contracts/caption"
import { formatCaptionTime } from "@shared/domain/format"

const estimateCaptionRow = () => 88

const CaptionVirtualRow = memo(function CaptionVirtualRow({
  row,
  tracks,
  index,
  start,
  measureElement,
}: {
  row: CaptionComparisonRow
  tracks: CaptionTrack[]
  index: number
  start: number
  measureElement: (element: Element | null) => void
}) {
  return (
    <tr
      ref={measureElement}
      data-index={index}
      data-slot="table-row"
      aria-rowindex={index + 2}
      className="caption-table__row caption-table__virtual-row border-b transition-colors hover:bg-muted/50"
      style={{ transform: `translateY(${start}px)` }}
    >
      <td data-slot="table-cell" className="p-2 align-middle">
        <time>
          {formatCaptionTime(row.start)} → {formatCaptionTime(row.end)}
        </time>
      </td>
      {tracks.map((track) => (
        <td
          key={track.code}
          data-slot="table-cell"
          className="p-2 align-middle"
          lang={track.code}
        >
          {row.cues[track.code] || "—"}
        </td>
      ))}
    </tr>
  )
})

export function CaptionComparisonTable({
  comparison,
  kicker = "BILINGUAL TIMELINE",
  title = "多語字幕對照",
  emptyTitle = "尚無字幕",
  emptyDescription = "這支影音目前沒有可供對照的字幕軌。",
}: {
  comparison: CaptionComparisonResponse
  kicker?: string
  title?: string
  emptyTitle?: string
  emptyDescription?: string
}) {
  const { scrollRef, totalSize, virtualizer, virtualRows } = useVirtualRows({
    count: comparison.rows.length,
    estimateSize: estimateCaptionRow,
    overscan: 8,
    getItemKey: (index) => comparison.rows[index]?.id ?? index,
  })

  if (comparison.tracks.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
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
          <span className="section-index">{kicker}</span>
          <h3 id="caption-comparison-title">{title}</h3>
        </div>
        <p>
          以 <Badge variant="secondary">{comparison.baselineLanguage}</Badge>{" "}
          時間段為基準
        </p>
      </div>
      <div
        ref={scrollRef}
        className="caption-table-frame"
        data-total-rows={comparison.rows.length}
      >
        <div className="caption-table-container">
          <table
            data-slot="table"
            className="caption-table caption-table--virtual w-full caption-bottom text-sm"
            aria-rowcount={comparison.rows.length + 1}
            style={
              {
                "--caption-columns": `11rem repeat(${comparison.tracks.length}, minmax(18rem, 1fr))`,
              } as React.CSSProperties
            }
          >
            <thead
              data-slot="table-header"
              className="caption-table__header [&_tr]:border-b"
            >
              <tr
                data-slot="table-row"
                className="caption-table__row border-b transition-colors"
              >
                <th
                  data-slot="table-head"
                  className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground"
                >
                  時間
                </th>
                {comparison.tracks.map((track) => (
                  <th
                    key={track.code}
                    data-slot="table-head"
                    className="h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground"
                  >
                    {track.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody
              data-slot="table-body"
              className="caption-table__body"
              style={{ height: `${totalSize}px` }}
            >
              {virtualRows.map((virtualRow) => {
                const row = comparison.rows[virtualRow.index]
                return (
                  <CaptionVirtualRow
                    key={virtualRow.key}
                    row={row}
                    tracks={comparison.tracks}
                    index={virtualRow.index}
                    start={virtualRow.start}
                    measureElement={virtualizer.measureElement}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
