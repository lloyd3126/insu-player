import { describe, expect, test } from "bun:test"

import { selectCaptionView } from "@/features/job-detail/subtitle-view"
import type { CaptionComparisonResponse } from "@shared/contracts/caption"
import type { JobDetail } from "@shared/contracts/job"

const comparison: CaptionComparisonResponse = {
  videoId: "demo-video",
  baselineLanguage: "en",
  tracks: [
    { code: "en", label: "English", cueCount: 1 },
    { code: "zh-TW", label: "繁體中文", cueCount: 1 },
  ],
  rows: [
    {
      id: "en:0",
      start: 0,
      end: 2,
      cues: { en: "Original sentence", "zh-TW": "翻譯句子" },
    },
  ],
}

const job = {
  subtitleWorkflow: {
    source: "model",
    provider: "local",
    sourceLanguage: "en",
    targetLanguage: "zh-TW",
  },
} as JobDetail

describe("subtitle detail views", () => {
  test("keeps model transcription in the original subtitle view", () => {
    const selected = selectCaptionView(comparison, job, "source")

    expect(selected.codes).toEqual(["en"])
    expect(selected.comparison.tracks.map((track) => track.code)).toEqual([
      "en",
    ])
    expect(selected.comparison.rows[0]?.cues).toEqual({
      en: "Original sentence",
    })
  })

  test("shows only the target track in the translated subtitle view", () => {
    const selected = selectCaptionView(comparison, job, "translated")

    expect(selected.codes).toEqual(["zh-TW"])
    expect(selected.comparison.tracks.map((track) => track.code)).toEqual([
      "zh-TW",
    ])
    expect(selected.comparison.rows[0]?.cues).toEqual({
      "zh-TW": "翻譯句子",
    })
  })
})
