import { describe, expect, test } from "bun:test"

import { formatDuration } from "./format"

describe("duration formatting", () => {
  test("uses YouTube-style minute and hour timestamps", () => {
    expect(formatDuration(5.9)).toBe("0:05")
    expect(formatDuration(125.9)).toBe("2:05")
    expect(formatDuration(3661.4)).toBe("1:01:01")
  })

  test("omits unavailable durations", () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(0)).toBeNull()
    expect(formatDuration(Number.NaN)).toBeNull()
  })
})
