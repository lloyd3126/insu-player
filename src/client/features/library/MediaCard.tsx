import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import type { JobSummary } from "@shared/contracts/job"
import { formatDuration } from "@shared/domain/format"

export function MediaCard({
  job,
  actionLabel,
  onOpen,
  children,
}: {
  job: JobSummary
  actionLabel: string
  onOpen: () => void
  children?: React.ReactNode
}) {
  const duration = formatDuration(job.durationSeconds)
  return (
    <Card className="video-grid-card" size="sm">
      <Button
        variant="ghost"
        className="video-grid-card__action"
        aria-label={`${actionLabel} ${job.title}`}
        onClick={onOpen}
      >
        <div className="video-grid-card__thumbnail">
          {job.thumbnailUrl ? (
            <img src={job.thumbnailUrl} alt="" loading="lazy" />
          ) : (
            <span>INSU</span>
          )}
          {duration ? (
            <Badge
              aria-hidden="true"
              className="video-grid-card__duration"
              variant="secondary"
            >
              {duration}
            </Badge>
          ) : null}
        </div>
        <CardHeader>
          <CardTitle role="heading" aria-level={3} title={job.title}>
            {job.title}
          </CardTitle>
        </CardHeader>
      </Button>
      {children}
    </Card>
  )
}
