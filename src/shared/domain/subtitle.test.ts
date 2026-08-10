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
        id: "zh-source",
        code: "zh-TW",
        cues: [
          { start: 0, end: 2, text: "第一句" },
          { start: 2, end: 4, text: "第二句" },
        ],
      },
      {
        id: "en-source",
        code: "en",
        cues: [
          { start: 0, end: 2, text: "First sentence" },
          { start: 2, end: 4, text: "Second sentence" },
        ],
      },
    ])

    expect(aligned.baselineTrackId).toBe("en-source")
    expect(aligned.rows).toHaveLength(2)
    expect(aligned.rows.map((row) => row.id)).toEqual([
      "en-source:0.000:2.000:0",
      "en-source:2.000:4.000:0",
    ])
    expect(aligned.rows[0].cues).toEqual({
      "zh-source": "第一句",
      "en-source": "First sentence",
    })
  })

  test("aligns unsorted overlapping cues in one forward sweep", () => {
    const english = [
      { start: 2, end: 4, text: "Second sentence" },
      { start: 0, end: 2, text: "First sentence" },
    ]
    const aligned = alignCaptionTracks([
      {
        id: "zh-source",
        code: "zh-TW",
        cues: [
          { start: 4, end: 5, text: "之後" },
          { start: 2, end: 4, text: "第二句" },
          { start: 1, end: 3, text: "跨句" },
          { start: 0, end: 1.5, text: "第一句" },
          { start: 1.5, end: 2, text: "第一句" },
          { start: -1, end: 0, text: "之前" },
          { start: 6, end: 6, text: "零長度" },
          { start: 0, end: 1, text: "   " },
        ],
      },
      { id: "en-source", code: "en", cues: english },
    ])

    expect(english).toEqual([
      { start: 2, end: 4, text: "Second sentence" },
      { start: 0, end: 2, text: "First sentence" },
    ])
    expect(aligned.rows.map((row) => row.cues)).toEqual([
      { "zh-source": "第一句 跨句", "en-source": "First sentence" },
      { "zh-source": "跨句 第二句", "en-source": "Second sentence" },
    ])
  })

  test("creates stable occurrence IDs for duplicate baseline timings", () => {
    const aligned = alignCaptionTracks([
      {
        id: "en-source",
        code: "en",
        cues: [
          { start: 0, end: 1, text: "One" },
          { start: 0, end: 1, text: "Repeated timing" },
        ],
      },
    ])

    expect(aligned.rows.map((row) => row.id)).toEqual([
      "en-source:0.000:1.000:0",
      "en-source:0.000:1.000:1",
    ])
  })
})
