import { describe, expect, test } from "bun:test"

import type { JobSummary } from "@shared/contracts/job"
import { nextActionForJob } from "@shared/domain/job-next-action"

function job(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    videoId: "demo",
    title: "Demo",
    sourceUrl: "https://example.test/demo",
    sourceKind: "page",
    state: "ready",
    effectiveState: "ready",
    stage: "downloaded",
    progress: 100,
    message: "",
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    completedAt: null,
    lastError: null,
    watchable: true,
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
    activeMedia: null,
    renditionCount: 1,
    mediaRevision: 1,
    playback: { time: 0, duration: null, updatedAt: null },
    ...overrides,
  }
}

describe("job next action", () => {
  test("asks the user to wait while a live stage is active", () => {
    expect(
      nextActionForJob(
        job({ state: "transcribing", effectiveState: "transcribing" }),
      ),
    ).toMatchObject({ kind: "processing", prompt: null })
  })

  test("continues the exact missing subtitle stage", () => {
    const action = nextActionForJob(
      job({
        state: "needs_segmentation",
        effectiveState: "needs_segmentation",
        activeSubtitleKinds: { "zh-TW": "translation" },
      }),
    )
    expect(action).toMatchObject({ kind: "segment", prompt: "subtitle" })
    expect(action.description).toContain("每種字幕都必須完成切分")
  })

  test("describes proofreading and segmentation as required and translation as optional", () => {
    const start = nextActionForJob(job({ watchable: false }))
    expect(start).toMatchObject({ kind: "start", prompt: "subtitle" })
    expect(start.description).toContain("先校正再切分")
    expect(start.description).toContain("翻譯是選擇性步驟")

    const content = nextActionForJob(
      job({
        state: "needs_proofreading",
        effectiveState: "needs_proofreading",
      }),
    )
    expect(content).toMatchObject({ kind: "content", prompt: "subtitle" })
    expect(content.description).toContain("先校正再切分")
    expect(content.description).toContain("翻譯是選擇性步驟")
  })

  test("reports completion only after segmentation is available", () => {
    expect(
      nextActionForJob(
        job({ activeSubtitleKinds: { "zh-TW": "segmentation" } }),
      ),
    ).toMatchObject({ kind: "complete", prompt: null })
    expect(
      nextActionForJob(
        job({
          watchable: false,
          activeSubtitleKinds: { "zh-TW": "segmentation" },
        }),
      ).kind,
    ).not.toBe("complete")
  })

  test("uses recovery for interrupted or failed work", () => {
    expect(
      nextActionForJob(
        job({ state: "failed", effectiveState: "failed" }),
      ),
    ).toMatchObject({ kind: "recover", prompt: "recovery" })
  })
})
