import type {
  CaptionComparisonRow,
  CaptionCue,
} from "@shared/contracts/caption"

const TIMING_PATTERN = /^(\S+)\s+-->\s+(\S+)/

export function parseVttTimestamp(value: string) {
  const normalized = value.trim().replace(",", ".")
  const parts = normalized.split(":").map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return Number.NaN
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Number.NaN
}

export function cleanCueText(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

export function parseWebVtt(value: string): CaptionCue[] {
  const lines = value.replace(/\r\n?/g, "\n").split("\n")
  const cues: CaptionCue[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const timing = lines[index]?.match(TIMING_PATTERN)
    if (!timing) continue

    const start = parseVttTimestamp(timing[1])
    const end = parseVttTimestamp(timing[2].split(/\s+/)[0])
    const textLines: string[] = []
    let cursor = index + 1
    while (cursor < lines.length && !TIMING_PATTERN.test(lines[cursor])) {
      const line = lines[cursor].trim()
      if (line && !line.startsWith("NOTE")) textLines.push(line)
      cursor += 1
    }
    const text = cleanCueText(textLines.join(" "))
    if (text && Number.isFinite(start) && Number.isFinite(end) && end > start) {
      cues.push({ start, end, text })
    }
    index = cursor - 1
  }

  return cues
}

export function alignCaptionTracks(
  tracks: Array<{ code: string; cues: CaptionCue[] }>,
) {
  const populated = tracks.filter((track) => track.cues.length > 0)
  if (populated.length === 0) {
    return { baselineLanguage: null, rows: [] as CaptionComparisonRow[] }
  }

  const baseline =
    populated.find((track) => track.code === "en") ??
    populated.reduce((best, track) =>
      track.cues.length > best.cues.length ? track : best,
    )

  const rows = baseline.cues.map((cue) => {
    const entries = tracks.map((track) => {
      const text = [
        ...new Set(
          track.cues
            .filter(
              (candidate) =>
                Math.min(cue.end, candidate.end) -
                  Math.max(cue.start, candidate.start) >
                0.001,
            )
            .map((candidate) => candidate.text)
            .filter(Boolean),
        ),
      ].join(" ")
      return [track.code, text] as const
    })
    return { start: cue.start, end: cue.end, cues: Object.fromEntries(entries) }
  })

  return { baselineLanguage: baseline.code, rows }
}
