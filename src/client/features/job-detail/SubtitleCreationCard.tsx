import { useMemo, useState } from "react"

import { PromptActionCard } from "@/components/shared/prompt-cards/PromptActionCard"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  SubtitleArtifact,
  SubtitleArtifactKind,
  SubtitleCatalogResponse,
} from "@shared/contracts/subtitle-catalog"
import {
  buildCreateProofreadSubtitlePrompt,
  buildCreateSegmentedSubtitlePrompt,
  buildCreateTranslationSubtitlePrompt,
  type SubtitleCreationPromptContext,
} from "@shared/prompts/insu-prompts"

type CreationKind = Exclude<SubtitleArtifactKind, "source">

interface CreationSource {
  artifact: SubtitleArtifact
  timingArtifactId: string
  label: string
  sourceKind: SubtitleCreationPromptContext["sourceKind"]
}

function isUsable(artifact: SubtitleArtifact) {
  return (
    artifact.lifecycleState === "ready" &&
    artifact.validationState !== "invalid" &&
    artifact.hardDefectCount === 0 &&
    artifact.freshnessState === "current"
  )
}

function relatedArtifactId(
  artifact: SubtitleArtifact,
  relation: "timing-source" | "content-parent",
) {
  return artifact.dependencies.find(
    (dependency) => dependency.relation === relation,
  )?.artifactId
}

function revisionLabel(artifact: SubtitleArtifact) {
  const language = artifact.outputLanguage ?? artifact.sourceLanguage
  const kind =
    artifact.kind === "source"
      ? "模型轉錄"
      : artifact.kind === "proofread"
        ? "校正字幕"
        : "翻譯字幕"
  return `${language} · ${kind} r${artifact.revision}`
}

function creationSources(
  kind: CreationKind,
  catalog: SubtitleCatalogResponse,
): CreationSource[] {
  const usable = catalog.artifacts
    .filter(isUsable)
    .sort((left, right) => {
      const completed = String(right.completedAt ?? "").localeCompare(
        String(left.completedAt ?? ""),
      )
      return completed || right.revision - left.revision
    })
  const modelSources = usable
    .filter(
      (artifact) =>
        artifact.kind === "source" &&
        artifact.sourceType === "model-transcript" &&
        artifact.timingUnitKind !== "cue",
    )
    .map((artifact) => ({
      artifact,
      timingArtifactId: artifact.id,
      label: revisionLabel(artifact),
      sourceKind: "model-transcript" as const,
    }))
  if (kind === "proofread") return modelSources

  const proofreads = usable
    .filter((artifact) => artifact.kind === "proofread")
    .flatMap((artifact) => {
      const timingArtifactId = relatedArtifactId(artifact, "timing-source")
      return timingArtifactId
        ? [{
            artifact,
            timingArtifactId,
            label: revisionLabel(artifact),
            sourceKind: "proofread" as const,
          }]
        : []
    })
  if (kind === "translation") {
    return proofreads.length > 0 ? proofreads : modelSources
  }

  const translations = usable
    .filter((artifact) => artifact.kind === "translation")
    .flatMap((artifact) => {
      const timingArtifactId = relatedArtifactId(artifact, "timing-source")
      return timingArtifactId
        ? [{
            artifact,
            timingArtifactId,
            label: revisionLabel(artifact),
            sourceKind: "translation" as const,
          }]
        : []
    })
  return [...translations, ...proofreads]
}

const COPY: Record<CreationKind, {
  kicker: string
  title: string
  unavailable: string
}> = {
  proofread: {
    kicker: "NEW / PROOFREAD",
    title: "新增校正字幕",
    unavailable: "需要先有從原始音訊建立且通過驗證的模型轉錄。",
  },
  translation: {
    kicker: "NEW / TRANSLATION",
    title: "新增翻譯字幕",
    unavailable: "需要先有通過驗證的校正字幕或模型轉錄。",
  },
  segmentation: {
    kicker: "NEW / SEGMENTATION",
    title: "新增切分字幕",
    unavailable: "需要先有通過驗證的完整句校正或翻譯字幕。",
  },
}

export function SubtitleCreationCard({
  videoId,
  kind,
  catalog,
}: {
  videoId: string
  kind: CreationKind
  catalog: SubtitleCatalogResponse
}) {
  const sources = useMemo(
    () => creationSources(kind, catalog),
    [catalog, kind],
  )
  const [selectedId, setSelectedId] = useState(sources[0]?.artifact.id ?? "")

  const selected =
    sources.find((source) => source.artifact.id === selectedId) ?? sources[0]
  const context = selected
    ? {
        videoId,
        sourceLanguage: selected.artifact.sourceLanguage,
        sourceArtifactId: selected.artifact.id,
        timingArtifactId: selected.timingArtifactId,
        sourceKind: selected.sourceKind,
      }
    : null
  const prompt = context
    ? kind === "proofread"
      ? buildCreateProofreadSubtitlePrompt(context)
      : kind === "translation"
        ? buildCreateTranslationSubtitlePrompt(context)
        : buildCreateSegmentedSubtitlePrompt(context)
    : ""
  const copy = COPY[kind]
  const description = selected
    ? kind === "translation" && selected.sourceKind === "proofread"
      ? `沿用 ${selected.label} 的文字與既有音訊時間軸，Agent 只會再詢問你想翻譯成哪種語言。`
      : `沿用 ${selected.label} 與既有音訊時間軸，不會重新下載影音或重跑語音辨識。`
    : copy.unavailable

  return (
    <PromptActionCard
      kicker={copy.kicker}
      title={copy.title}
      description={description}
      prompt={prompt}
      copyDisabled={!selected}
    >
      {selected && sources.length > 1 ? (
        <Select
          items={sources.map((source) => ({
            value: source.artifact.id,
            label: source.label,
          }))}
          value={selected.artifact.id}
          onValueChange={(value) => value && setSelectedId(value)}
        >
          <SelectTrigger aria-label="選擇字幕文字來源">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {sources.map((source) => (
                <SelectItem key={source.artifact.id} value={source.artifact.id}>
                  {source.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}
    </PromptActionCard>
  )
}
