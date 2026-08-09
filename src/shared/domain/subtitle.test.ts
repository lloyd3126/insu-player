import { describe, expect, test } from "bun:test"

import { alignCaptionTracks, cleanCueText, parseWebVtt } from "./subtitle"

describe("subtitle domain", () => {
  test("parses WebVTT cue settings and normalizes cue text", () => {
    const cues = parseWebVtt(`WEBVTT

00:00:01.000 --> 00:00:03.500 position:50%
<c.en>Hello &amp; welcome</c>

00:03.500 --> 00:05.000
Next&nbsp;sentence
`)

    expect(cues).toEqual([
      { start: 1, end: 3.5, text: "Hello & welcome" },
      { start: 3.5, end: 5, text: "Next sentence" },
    ])
    expect(cleanCueText("  <b>One</b>   two  ")).toBe("One two")
  })

  test("uses the English sentence timeline for bilingual comparison", () => {
    const aligned = alignCaptionTracks([
      {
        code: "zh-TW",
        cues: [
          { start: 0, end: 2, text: "第一句" },
          { start: 2, end: 4, text: "第二句" },
        ],
      },
      {
        code: "en",
        cues: [
          { start: 0, end: 2, text: "First sentence" },
          { start: 2, end: 4, text: "Second sentence" },
        ],
      },
    ])

    expect(aligned.baselineLanguage).toBe("en")
    expect(aligned.rows).toHaveLength(2)
    expect(aligned.rows[0].cues).toEqual({
      "zh-TW": "第一句",
      en: "First sentence",
    })
  })
})
