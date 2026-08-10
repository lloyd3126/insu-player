import { LanguageCodeList } from "@/components/shared/LanguageCodeList"
import { AppDialog } from "@/components/shared/AppDialog"
import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { Badge } from "@/components/ui/badge"
import { CaptionComparisonTable } from "@/features/job-detail/CaptionComparisonTable"
import {
  artifactLanguageCodes,
  artifactProvider,
  lifecycleLabel,
  SUBTITLE_KIND_COPY,
  validationLabel,
} from "@/features/job-detail/subtitle-artifact-ui"
import { useSubtitleArtifactCaptions } from "@/hooks/use-job-detail"
import type { SubtitleArtifact } from "@shared/contracts/subtitle-catalog"

export function SubtitleRevisionPreviewDialog({
  videoId,
  artifact,
  onClose,
}: {
  videoId: string
  artifact: SubtitleArtifact | null
  onClose: () => void
}) {
  const comparison = useSubtitleArtifactCaptions(videoId, artifact?.id ?? null)
  const copy = artifact ? SUBTITLE_KIND_COPY[artifact.kind] : null

  return (
    <AppDialog
      open={Boolean(artifact)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      kicker="REVISION PREVIEW"
      title={artifact && copy ? `${copy.label} · r${artifact.revision}` : "字幕預覽"}
      description="在獨立預覽中檢查這個字幕版本，不會改變目前播放版本。"
      size="screen"
      layout="tabbed"
      overlayEmphasis="strong"
    >
      {artifact && copy ? (
        <div className="subtitle-revision-preview">
          <div className="subtitle-revision-preview__facts">
            <LanguageCodeList codes={artifactLanguageCodes(artifact)} />
            <Badge variant="secondary">{lifecycleLabel(artifact)}</Badge>
            <Badge variant="outline">{validationLabel(artifact)}</Badge>
            <span>{artifactProvider(artifact)}</span>
          </div>
          <div className="subtitle-revision-preview__body">
            {comparison.isPending ? (
              <LoadingState label={`正在讀取${copy.label}`} />
            ) : null}
            {comparison.isError ? (
              <ErrorState message={comparison.error.message} />
            ) : null}
            {comparison.data ? (
              <CaptionComparisonTable
                comparison={comparison.data}
                kicker={copy.kicker}
                title="字幕內容"
                emptyTitle={`尚無${copy.label}`}
                emptyDescription={copy.empty}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </AppDialog>
  )
}
