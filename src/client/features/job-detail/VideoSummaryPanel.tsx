import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckIcon, FileTextIcon, NetworkIcon, Trash2Icon } from "lucide-react"
import { useMemo, useState } from "react"

import { api } from "@/api/client"
import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { PromptActionCard } from "@/components/shared/prompt-cards/PromptActionCard"
import { ResourceRemovalDialog } from "@/components/shared/removal/ResourceRemovalDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MarkmapViewer } from "@/features/job-detail/MarkmapViewer"
import type { JobDetail } from "@shared/contracts/job"
import type { SummaryArtifact, SummaryArtifactKind } from "@shared/contracts/summary"
import {
  buildMindMapPrompt,
  buildVideoSummaryPrompt,
} from "@shared/prompts/insu-prompts"

function revisionLabel(artifact: SummaryArtifact) {
  return `r${artifact.revision} · ${artifact.languageCode} · ${new Date(artifact.createdAt).toLocaleString("zh-TW")}`
}

function SummaryRemovalDialog({
  videoId,
  artifact,
}: {
  videoId: string
  artifact: SummaryArtifact
}) {
  const queryClient = useQueryClient()
  return (
    <ResourceRemovalDialog
      target={{ kind: "summary-artifact", videoId, artifactId: artifact.id }}
      title={`刪除 ${artifact.title}`}
      description="這會永久刪除這個摘要版本。仍有心智圖使用這份摘要時，系統會阻止移除。"
      confirmLabel="刪除版本"
      onRemoved={() => {
        void queryClient.invalidateQueries({ queryKey: ["summaries", videoId] })
        void queryClient.removeQueries({
          queryKey: ["summary-artifact", videoId, artifact.id],
        })
      }}
    >
      <Button type="button" variant="destructive" size="icon-sm" aria-label="刪除這個版本">
        <Trash2Icon />
      </Button>
    </ResourceRemovalDialog>
  )
}

function VersionPicker({
  label,
  artifacts,
  value,
  onChange,
}: {
  label: string
  artifacts: SummaryArtifact[]
  value?: string
  onChange: (value: string) => void
}) {
  if (!artifacts.length) return null
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger aria-label={label} className="summary-version-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {artifacts.map((artifact) => (
          <SelectItem key={artifact.id} value={artifact.id}>
            {revisionLabel(artifact)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function MarkdownSummary({ content }: { content: string }) {
  let sourceOffset = 0
  const lines = content.split(/\r?\n/).map((line) => {
    const key = `${sourceOffset}:${line}`
    sourceOffset += line.length + 1
    return { key, line }
  })
  return (
    <article className="summary-document">
      {lines.map(({ key, line }) => {
        const heading = line.match(/^(#{1,3})\s+(.+)$/)
        if (heading) {
          const Heading = `h${Math.min(heading[1].length + 1, 4)}` as "h2" | "h3" | "h4"
          return <Heading key={key}>{heading[2]}</Heading>
        }
        if (/^[-*]\s+/.test(line)) return <p key={key} className="summary-list-item">{line.replace(/^[-*]\s+/, "")}</p>
        return line.trim() ? <p key={key}>{line}</p> : <br key={key} />
      })}
    </article>
  )
}

function ArtifactSection({
  job,
  kind,
  artifacts,
  selectedId,
  onSelected,
}: {
  job: JobDetail
  kind: SummaryArtifactKind
  artifacts: SummaryArtifact[]
  selectedId?: string
  onSelected: (artifactId: string) => void
}) {
  const selected = artifacts.find((artifact) => artifact.id === selectedId)
  const artifact = useQuery({
    queryKey: ["summary-artifact", job.videoId, selectedId],
    queryFn: () => api.summaryArtifact(job.videoId, selectedId!),
    enabled: Boolean(selectedId),
  })
  const queryClient = useQueryClient()
  const activate = useMutation({
    mutationFn: () => api.activateSummary(job.videoId, kind, selected!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["summaries", job.videoId] })
    },
  })
  return (
    <section className="summary-artifact-section" aria-label={kind === "text" ? "文字摘要" : "心智圖"}>
      <div className="summary-artifact-heading">
        <div>
          {kind === "text" ? <FileTextIcon /> : <NetworkIcon />}
          <strong>{kind === "text" ? "文字摘要" : "心智圖"}</strong>
          {selected?.active ? <Badge variant="secondary">目前版本</Badge> : null}
        </div>
        <div>
          <VersionPicker
            label={`選擇${kind === "text" ? "文字摘要" : "心智圖"}版本`}
            artifacts={artifacts}
            value={selectedId}
            onChange={onSelected}
          />
          {selected && !selected.active ? (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="設為目前版本"
              disabled={activate.isPending}
              onClick={() => activate.mutate()}
            >
              <CheckIcon />
            </Button>
          ) : null}
          {selected ? <SummaryRemovalDialog videoId={job.videoId} artifact={selected} /> : null}
        </div>
      </div>
      {activate.isError ? <ErrorState message={activate.error.message} /> : null}
      {artifact.isPending && selectedId ? <LoadingState label="正在讀取摘要" /> : null}
      {artifact.isError ? <ErrorState message={artifact.error.message} /> : null}
      {!selected ? (
        <div className="summary-empty-state">尚未建立{kind === "text" ? "文字摘要" : "心智圖"}</div>
      ) : null}
      {artifact.data && kind === "text" ? <MarkdownSummary content={artifact.data.content} /> : null}
      {artifact.data && kind === "mindmap" ? (
        <MarkmapViewer content={artifact.data.content} title={artifact.data.artifact.title} />
      ) : null}
    </section>
  )
}

export function VideoSummaryPanel({ job }: { job: JobDetail }) {
  const summaries = useQuery({
    queryKey: ["summaries", job.videoId],
    queryFn: () => api.summaries(job.videoId),
  })
  const subtitles = useQuery({
    queryKey: ["subtitles", job.videoId],
    queryFn: () => api.subtitles(job.videoId),
  })
  const textArtifacts = useMemo(
    () => summaries.data?.artifacts.filter((artifact) => artifact.kind === "text") ?? [],
    [summaries.data],
  )
  const mindmapArtifacts = useMemo(
    () => summaries.data?.artifacts.filter((artifact) => artifact.kind === "mindmap") ?? [],
    [summaries.data],
  )
  const [selectedTextId, setSelectedTextId] = useState<string>()
  const [selectedMindmapId, setSelectedMindmapId] = useState<string>()
  const eligibleSubtitleArtifacts = useMemo(
    () =>
      subtitles.data?.artifacts
        .filter(
          (artifact) =>
            ["proofread", "translation"].includes(artifact.kind) &&
            artifact.lifecycleState === "ready" &&
            artifact.validationState === "valid",
        )
        .sort((left, right) => right.revision - left.revision) ?? [],
    [subtitles.data],
  )
  const [selectedSourceSubtitleId, setSelectedSourceSubtitleId] = useState<string>()
  const textId = textArtifacts.some((item) => item.id === selectedTextId)
    ? selectedTextId
    : summaries.data?.activeArtifactIds.text ?? textArtifacts[0]?.id
  const mindmapId = mindmapArtifacts.some((item) => item.id === selectedMindmapId)
    ? selectedMindmapId
    : summaries.data?.activeArtifactIds.mindmap ?? mindmapArtifacts[0]?.id
  const sourceSubtitleId = eligibleSubtitleArtifacts.some(
    (artifact) => artifact.id === selectedSourceSubtitleId,
  )
    ? selectedSourceSubtitleId
    : eligibleSubtitleArtifacts[0]?.id
  const sourceSubtitle = eligibleSubtitleArtifacts.find(
    (artifact) => artifact.id === sourceSubtitleId,
  )
  const activeText = textArtifacts.find((artifact) => artifact.id === textId)
  const textPrompt = sourceSubtitle
    ? buildVideoSummaryPrompt(
        job.videoId,
        sourceSubtitle.id,
        sourceSubtitle.outputLanguage ?? sourceSubtitle.sourceLanguage,
      )
    : "目前沒有可用的完整句字幕。請先完成原語校正或翻譯字幕。"
  const mindmapPrompt = activeText
    ? buildMindMapPrompt(job.videoId, activeText.id, activeText.languageCode)
    : "目前沒有可用的文字摘要。請先建立文字摘要。"

  return (
    <div className="video-summary-panel">
      <PromptActionCard
        kicker="CREATE / TEXT SUMMARY"
        title="請 Agent 建立文字摘要"
        description="使用已驗證的完整句字幕建立新版摘要，不會覆寫既有版本。"
        prompt={textPrompt}
        copyDisabled={!sourceSubtitle}
      >
        {eligibleSubtitleArtifacts.length ? (
          <Select
            value={sourceSubtitleId}
            onValueChange={(value) => value && setSelectedSourceSubtitleId(value)}
          >
            <SelectTrigger aria-label="選擇摘要來源字幕">
              <SelectValue placeholder="選擇完整句字幕" />
            </SelectTrigger>
            <SelectContent>
              {eligibleSubtitleArtifacts.map((artifact) => (
                <SelectItem key={artifact.id} value={artifact.id}>
                  {artifact.kind === "proofread" ? "校正字幕" : "翻譯字幕"} · {artifact.outputLanguage ?? artifact.sourceLanguage} · r{artifact.revision}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </PromptActionCard>
      {summaries.isPending || subtitles.isPending ? <LoadingState label="正在讀取摘要資料" /> : null}
      {summaries.isError ? <ErrorState message={summaries.error.message} /> : null}
      {subtitles.isError ? <ErrorState message={subtitles.error.message} /> : null}
      {summaries.data ? (
        <ArtifactSection
          job={job}
          kind="text"
          artifacts={textArtifacts}
          selectedId={textId}
          onSelected={setSelectedTextId}
        />
      ) : null}
      <PromptActionCard
        kicker="CREATE / MIND MAP"
        title="請 Agent 建立心智圖"
        description="根據目前選取的文字摘要整理成可縮放、收合與匯出的 Markmap。"
        prompt={mindmapPrompt}
        copyDisabled={!activeText}
      />
      {summaries.data ? (
        <ArtifactSection
          job={job}
          kind="mindmap"
          artifacts={mindmapArtifacts}
          selectedId={mindmapId}
          onSelected={setSelectedMindmapId}
        />
      ) : null}
    </div>
  )
}
