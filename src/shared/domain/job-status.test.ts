import { describe, expect, test } from "bun:test"

import type { JobSummary } from "@shared/contracts/job"
import { phaseForJob, subtitlePipelineLabel } from "./job-status"

function job(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    videoId: "demo",
    title: "Demo",
    sourceUrl: "",
    state: "queued",
    effectiveState: "queued",
    stage: "queued",
    progress: 0,
    message: "",
    createdAt: null,
    updatedAt: null,
    completedAt: null,
    lastError: null,
    watchable: false,
    activeMedia: null,
    renditionCount: 0,
    mediaRevision: 0,
    captionCodes: [],
    activeSubtitleKinds: {},
    activeSubtitleVersions: {},
    subtitlePipeline: null,
    transcription: null,
    sizeBytes: 0,
    thumbnailUrl: null,
    watchUrl: null,
    hasLog: false,
    durationSeconds: null,
    playback: { time: 0, duration: null, updatedAt: null },
    ...overrides,
  }
}

describe("job status presentation", () => {
  test("maps media lifecycle into the compact current-status vocabulary", () => {
    expect(phaseForJob(job())).toBe("尚未開始")
    expect(phaseForJob(job({ state: "downloading", effectiveState: "downloading" }))).toBe("影音處理中")
    expect(phaseForJob(job({ state: "downloaded", effectiveState: "downloaded", watchable: true }))).toBe("影音已完成")
    expect(phaseForJob(job({ state: "transcribing", effectiveState: "transcribing" }))).toBe("字幕處理中")
    expect(phaseForJob(job({ state: "ready", effectiveState: "ready", captionCodes: ["en"] }))).toBe("字幕已完成")
  })

  test("surfaces subtitle reflow stages in the same status column", () => {
    const summary = job({
      subtitlePipeline: {
        mode: "translate",
        stage: "target_segmentation",
        sourceLanguage: "en",
        outputLanguage: "zh-TW",
        timingProcessor: { provider: "local", model: "medium" },
        segmentationProcessor: { provider: "agent", service: "codex" },
        manualReferenceArtifactIds: [],
      },
    })
    expect(phaseForJob(summary)).toBe("正在重新切分字幕")
    expect(subtitlePipelineLabel(summary)).toEqual({
      label: "正在重新切分字幕",
      detail: "Agent · codex",
    })
  })
})
