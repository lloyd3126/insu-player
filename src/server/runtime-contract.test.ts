import { describe, expect, test } from "bun:test"

import {
  SERVER_BUILD_ID,
  STATUS_SCHEMA_VERSION,
  isCurrentServerRuntime,
} from "@server/runtime-contract"

describe("server runtime contract", () => {
  const current = {
    buildId: SERVER_BUILD_ID,
    statusSchemaVersion: STATUS_SCHEMA_VERSION,
  }

  test("accepts only the exact current descriptor and health contract", () => {
    expect(isCurrentServerRuntime(current, current)).toBe(true)
    expect(isCurrentServerRuntime({ ...current, buildId: "older" }, current)).toBe(false)
    expect(isCurrentServerRuntime(current, { ...current, statusSchemaVersion: 5 })).toBe(false)
    expect(isCurrentServerRuntime(current, null)).toBe(false)
  })
})
