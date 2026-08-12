import { DownloadIcon } from "lucide-react"

import { LanguageCodeList } from "@/components/shared/LanguageCodeList"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { SubtitleArtifact } from "@shared/contracts/subtitle-catalog"

function exportUrl(
  videoId: string,
  artifactId: string,
  trackId: string,
  format: "srt" | "txt",
) {
  return `/api/jobs/${encodeURIComponent(videoId)}/subtitles/artifacts/${encodeURIComponent(artifactId)}/tracks/${encodeURIComponent(trackId)}/export?format=${format}`
}

export function SubtitleExportDialog({
  videoId,
  artifact,
  label,
  languageCode,
}: {
  videoId: string
  artifact: SubtitleArtifact
  label: string
  languageCode: string
}) {
  const available = artifact.lifecycleState === "ready" && artifact.validationState !== "invalid"
  const tracks = artifact.tracks.filter(
    (track) => track.languageCode === languageCode,
  )
  return (
    <Dialog>
      <Tooltip>
        <DialogTrigger
          render={(
            <TooltipTrigger
              render={(
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`下載${label} r${artifact.revision}（${languageCode}）`}
                  disabled={!available}
                />
              )}
            />
          )}
        >
          <DownloadIcon />
        </DialogTrigger>
        <TooltipContent>下載字幕</TooltipContent>
      </Tooltip>
      <DialogContent className="subtitle-export-dialog" overlayEmphasis="strong">
        <DialogHeader>
          <DialogTitle>下載{label} r{artifact.revision}（{languageCode}）</DialogTitle>
          <DialogDescription>
            SRT 保留每段時間，TXT 會用半形空格銜接所有字幕句子。
          </DialogDescription>
        </DialogHeader>
        <Table aria-label="字幕下載格式">
          <TableHeader>
            <TableRow>
              <TableHead>字幕軌</TableHead>
              <TableHead>格式</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tracks.map((track) => (
              <TableRow key={track.id}>
                <TableCell><LanguageCodeList codes={[track.languageCode]} /></TableCell>
                <TableCell>
                  <div className="subtitle-export-actions">
                    {(["srt", "txt"] as const).map((format) => (
                      <Button
                        key={format}
                        variant="outline"
                        size="sm"
                        render={(
                          <a
                            href={exportUrl(videoId, artifact.id, track.id, format)}
                            download
                          >
                            {format.toUpperCase()}
                          </a>
                        )}
                      />
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  )
}
