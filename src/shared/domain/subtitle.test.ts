import { describe, expect, test } from "bun:test"

import {
  alignCaptionTracks,
  cleanCueText,
  parseWebVtt,
  webVttToSrt,
  webVttToText,
} from "./subtitle"

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

  test("keeps WebVTT cue identifiers out of visible subtitle text", () => {
    const cues = parseWebVtt(`WEBVTT
Kind: captions
Language: zh-TW

S0001-P01
00:00:00.000 --> 00:00:03.020
嗨 創業學校的創辦人們

S0001-P02
00:00:03.020 --> 00:00:09.640
我是 Jeff Ralston YC 的總裁
`)

    expect(cues).toEqual([
      { start: 0, end: 3.02, text: "嗨 創業學校的創辦人們" },
      { start: 3.02, end: 9.64, text: "我是 Jeff Ralston YC 的總裁" },
    ])
  })

  test("exports SRT timing and joins TXT cues with one ASCII space", () => {
    const source = `WEBVTT

S0001-P01
00:00:01.250 --> 00:01:02.005
<b>第一句</b>

S0001-P02
01:02:03.040 --> 01:02:05.500
Second   sentence
`

    expect(webVttToSrt(source)).toBe(
      "1\n00:00:01,250 --> 00:01:02,005\n第一句\n\n2\n01:02:03,040 --> 01:02:05,500\nSecond sentence\n",
    )
    expect(webVttToText(source)).toBe("第一句 Second sentence\n")
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
