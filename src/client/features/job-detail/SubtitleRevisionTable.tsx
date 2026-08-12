import { EyeIcon, Trash2Icon } from "lucide-react"

import { ResourceRemovalDialog } from "@/components/shared/removal/ResourceRemovalDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  artifactProvider,
  lifecycleLabel,
  SUBTITLE_KIND_COPY,
  validationLabel,
} from "@/features/job-detail/subtitle-artifact-ui"
import { SubtitleExportDialog } from "@/features/job-detail/SubtitleExportDialog"
import type {
  ActiveSubtitleTrack,
  SubtitleArtifact,
} from "@shared/contracts/subtitle-catalog"
import { formatDate } from "@shared/domain/format"

function lifecycleVariant(artifact: SubtitleArtifact) {
  return artifact.lifecycleState === "failed" ? "destructive" : "secondary"
}

function validationVariant(artifact: SubtitleArtifact) {
  return artifact.validationState === "invalid" ? "destructive" : "outline"
}

function RevisionStatus({ artifact }: { artifact: SubtitleArtifact }) {
  return (
    <div className="subtitle-revision-badges">
      <Badge variant={lifecycleVariant(artifact)}>
        {lifecycleLabel(artifact)}
      </Badge>
      {artifact.freshnessState !== "current" ? (
        <Badge variant="outline">
          {artifact.freshnessState === "stale" ? "等待新版" : "已有新版"}
        </Badge>
      ) : null}
    </div>
  )
}

function RevisionValidation({ artifact }: { artifact: SubtitleArtifact }) {
  return (
    <div className="subtitle-revision-badges">
      <Badge variant={validationVariant(artifact)}>
        {validationLabel(artifact)}
      </Badge>
      {artifact.warningCount > 0 ? (
        <span>{artifact.warningCount} 個提醒</span>
      ) : null}
      {artifact.hardDefectCount > 0 ? (
        <Badge variant="destructive">
          {artifact.hardDefectCount} 個必要修正
        </Badge>
      ) : null}
      {artifact.schemaError ? <span>資料格式不符</span> : null}
    </div>
  )
}

export function SubtitleRevisionTable({
  videoId,
  artifacts,
  activeTracks,
  onPreview,
  onRemoved,
}: {
  videoId: string
  artifacts: SubtitleArtifact[]
  activeTracks: ActiveSubtitleTrack[]
  onPreview: (artifactId: string, trigger: HTMLButtonElement) => void
  onRemoved: (artifactId: string) => void
}) {
  const activeTrackKeys = new Set(
    activeTracks.map((track) => `${track.artifactId}:${track.languageCode}`),
  )
  const rows = artifacts.flatMap((artifact) =>
    [...new Set(artifact.tracks.map((track) => track.languageCode))]
      .sort((left, right) => left.localeCompare(right))
      .map((languageCode) => ({ artifact, languageCode })),
  )

  return (
    <Table
      aria-label="字幕版本"
      className="subtitle-revision-table"
      containerClassName="subtitle-revision-table-frame"
    >
      <TableHeader>
        <TableRow>
          <TableHead>類型</TableHead>
          <TableHead>版本</TableHead>
          <TableHead>語言</TableHead>
          <TableHead>處理者</TableHead>
          <TableHead>狀態</TableHead>
          <TableHead>驗證</TableHead>
          <TableHead>播放</TableHead>
          <TableHead>完成時間</TableHead>
          <TableHead className="subtitle-revision-table__actions">
            操作
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ artifact, languageCode }) => {
          const copy = SUBTITLE_KIND_COPY[artifact.kind]
          const active = activeTrackKeys.has(`${artifact.id}:${languageCode}`)
          return (
            <TableRow key={`${artifact.id}:${languageCode}`}>
              <TableCell>
                <Badge variant="outline">{copy.label}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">r{artifact.revision}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{languageCode}</Badge>
              </TableCell>
              <TableCell>{artifactProvider(artifact)}</TableCell>
              <TableCell>
                <RevisionStatus artifact={artifact} />
              </TableCell>
              <TableCell>
                <RevisionValidation artifact={artifact} />
              </TableCell>
              <TableCell>
                {active ? <Badge>目前播放</Badge> : "—"}
              </TableCell>
              <TableCell>
                <time dateTime={artifact.completedAt ?? undefined}>
                  {formatDate(artifact.completedAt)}
                </time>
              </TableCell>
              <TableCell className="subtitle-revision-table__actions">
                <div className="subtitle-revision-actions">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`預覽${copy.label} r${artifact.revision}（${languageCode}）`}
                          onClick={(event) =>
                            onPreview(artifact.id, event.currentTarget)
                          }
                        />
                      }
                    >
                      <EyeIcon data-icon="inline-start" />
                    </TooltipTrigger>
                    <TooltipContent>預覽字幕</TooltipContent>
                  </Tooltip>
                  <SubtitleExportDialog
                    videoId={videoId}
                    artifact={artifact}
                    label={copy.label}
                    languageCode={languageCode}
                  />
                  <ResourceRemovalDialog
                    target={{
                      kind: "subtitle-artifact",
                      videoId,
                      artifactId: artifact.id,
                    }}
                    title={`移除${copy.label}`}
                    description="這會永久移除選定版本及依賴它的下游字幕，且無法復原。"
                    confirmLabel="移除字幕"
                    onRemoved={() => onRemoved(artifact.id)}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`移除${copy.label} r${artifact.revision}（${languageCode}，整個版本）`}
                    >
                      <Trash2Icon data-icon="inline-start" />
                    </Button>
                  </ResourceRemovalDialog>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
