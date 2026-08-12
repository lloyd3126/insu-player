import { EyeIcon, Trash2Icon } from "lucide-react"

import { LanguageCodeList } from "@/components/shared/LanguageCodeList"
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
  artifactLanguageCodes,
  artifactProvider,
  lifecycleLabel,
  SUBTITLE_KIND_COPY,
  validationLabel,
} from "@/features/job-detail/subtitle-artifact-ui"
import { SubtitleExportDialog } from "@/features/job-detail/SubtitleExportDialog"
import type {
  ActiveSubtitleTrack,
  SubtitleArtifact,
  SubtitleArtifactKind,
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
    </div>
  )
}

export function SubtitleRevisionTable({
  videoId,
  kind,
  artifacts,
  activeTracks,
  onPreview,
  onRemoved,
}: {
  videoId: string
  kind: SubtitleArtifactKind
  artifacts: SubtitleArtifact[]
  activeTracks: ActiveSubtitleTrack[]
  onPreview: (artifactId: string, trigger: HTMLButtonElement) => void
  onRemoved: (artifactId: string) => void
}) {
  const copy = SUBTITLE_KIND_COPY[kind]
  const activeLanguagesByArtifact = new Map<string, string[]>()
  for (const track of activeTracks) {
    const languages = activeLanguagesByArtifact.get(track.artifactId) ?? []
    languages.push(track.languageCode)
    activeLanguagesByArtifact.set(track.artifactId, languages)
  }

  return (
    <Table
      aria-label={`${copy.label}版本`}
      className="subtitle-revision-table"
      containerClassName="subtitle-revision-table-frame"
    >
      <TableHeader>
        <TableRow>
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
        {artifacts.map((artifact) => {
          const activeLanguageCodes = activeLanguagesByArtifact.get(artifact.id) ?? []
          return (
            <TableRow key={artifact.id}>
              <TableCell>
                <strong>r{artifact.revision}</strong>
              </TableCell>
              <TableCell>
                <LanguageCodeList codes={artifactLanguageCodes(artifact)} />
              </TableCell>
              <TableCell>{artifactProvider(artifact)}</TableCell>
              <TableCell>
                <RevisionStatus artifact={artifact} />
              </TableCell>
              <TableCell>
                <RevisionValidation artifact={artifact} />
              </TableCell>
              <TableCell>
                <LanguageCodeList codes={activeLanguageCodes} />
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
                          aria-label={`預覽${copy.label} r${artifact.revision}`}
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
                      aria-label={`移除${copy.label} r${artifact.revision}`}
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
