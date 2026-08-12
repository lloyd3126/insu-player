import { describe, expect, test } from "bun:test"

import {
  DATA_SCHEMA_VERSION,
  SERVER_BUILD_ID,
} from "../../../src/server/runtime-contract"

import {
  CONNECTION_PROTOCOL_VERSION,
  EXPECTED_DATA_SCHEMA_VERSION,
  EXPECTED_SERVER_BUILD_ID,
  isCurrentInsuHealth,
  normalizeBootstrap,
  normalizeConnection,
  normalizeLoopbackOrigin,
} from "./connection-protocol.js"

describe("extension connection protocol", () => {
  test("only accepts an exact loopback origin with an explicit port", () => {
    expect(normalizeLoopbackOrigin("http://127.0.0.1:8000")).toBe(
      "http://127.0.0.1:8000",
    )
    expect(normalizeLoopbackOrigin("http://localhost:8010")).toBe(
      "http://localhost:8010",
    )
    expect(normalizeLoopbackOrigin("https://127.0.0.1:8000")).toBeNull()
    expect(normalizeLoopbackOrigin("http://127.0.0.1:8000/library")).toBeNull()
    expect(normalizeLoopbackOrigin("http://192.168.1.2:8000")).toBeNull()
  })

  test("rejects the previous unversioned storage shape instead of migrating it", () => {
    expect(
      normalizeConnection({
        serverOrigin: "http://127.0.0.1:8000",
        token: "x".repeat(32),
        pairedAt: "2026-08-11T00:00:00.000Z",
      }),
    ).toBeNull()
    expect(
      normalizeConnection({
        protocolVersion: CONNECTION_PROTOCOL_VERSION,
        serverOrigin: "http://127.0.0.1:8000",
        token: "x".repeat(32),
        connectedAt: "2026-08-11T00:00:00.000Z",
      }),
    ).toEqual({
      protocolVersion: CONNECTION_PROTOCOL_VERSION,
      serverOrigin: "http://127.0.0.1:8000",
      token: "x".repeat(32),
      connectedAt: "2026-08-11T00:00:00.000Z",
    })
  })

  test("requires the current server and connection protocol", () => {
    expect(EXPECTED_SERVER_BUILD_ID).toBe(SERVER_BUILD_ID)
    expect(EXPECTED_DATA_SCHEMA_VERSION).toBe(DATA_SCHEMA_VERSION)
    const health = {
      ok: true,
      runtime: "bun",
      framework: "hono",
      buildId: EXPECTED_SERVER_BUILD_ID,
      dataSchemaVersion: EXPECTED_DATA_SCHEMA_VERSION,
      extensionProtocolVersion: CONNECTION_PROTOCOL_VERSION,
    }
    expect(isCurrentInsuHealth(health)).toBe(true)
    expect(
      isCurrentInsuHealth({ ...health, extensionProtocolVersion: 1 }),
    ).toBe(false)
    expect(isCurrentInsuHealth({ ...health, buildId: "old-build" })).toBe(false)
  })

  test("accepts only an unexpired bootstrap for the exact current contract", () => {
    const bootstrap = {
      kind: "insu-player-extension-bootstrap",
      schemaVersion: 1,
      protocolVersion: CONNECTION_PROTOCOL_VERSION,
      buildId: EXPECTED_SERVER_BUILD_ID,
      dataSchemaVersion: EXPECTED_DATA_SCHEMA_VERSION,
      invitationId: "pair-00000000-0000-4000-8000-000000000000",
      ticket: "x".repeat(32),
      issuedAt: "2099-08-10T23:30:00.000Z",
      expiresAt: "2099-08-11T00:00:00.000Z",
      serverOrigin: "http://127.0.0.1:8000",
    }
    expect(normalizeBootstrap(bootstrap)).toEqual(bootstrap)
    expect(normalizeBootstrap({ ...bootstrap, schemaVersion: 2 })).toBeNull()
    expect(normalizeBootstrap({ ...bootstrap, buildId: "old-build" })).toBeNull()
    expect(
      normalizeBootstrap({ ...bootstrap, issuedAt: bootstrap.expiresAt }),
    ).toBeNull()
    expect(
      normalizeBootstrap(
        { ...bootstrap, expiresAt: "2026-08-11T00:00:00.000Z" },
        Date.parse("2026-08-11T00:00:00.001Z"),
      ),
    ).toBeNull()
  })
})
