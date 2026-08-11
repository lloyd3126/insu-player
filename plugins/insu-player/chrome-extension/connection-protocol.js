export const CONNECTION_PROTOCOL_VERSION = 2
export const CONNECT_REQUEST_MESSAGE = "INSU_EXTENSION_CONNECT_REQUEST"
export const CONNECT_RESPONSE_MESSAGE = "INSU_EXTENSION_CONNECT_RESPONSE"
export const EXPECTED_SERVER_BUILD_ID = "insu-player-library-queue-v1"
export const EXPECTED_DATA_SCHEMA_VERSION = 5

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function normalizeLoopbackOrigin(value) {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.port ||
      url.origin !== value
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

export function normalizeConnection(value) {
  if (!isRecord(value)) return null
  const serverOrigin = normalizeLoopbackOrigin(value.serverOrigin)
  if (
    value.protocolVersion !== CONNECTION_PROTOCOL_VERSION ||
    !serverOrigin ||
    typeof value.token !== "string" ||
    value.token.length < 32 ||
    typeof value.connectedAt !== "string" ||
    !Number.isFinite(Date.parse(value.connectedAt))
  ) {
    return null
  }
  return {
    protocolVersion: CONNECTION_PROTOCOL_VERSION,
    serverOrigin,
    token: value.token,
    connectedAt: value.connectedAt,
  }
}

export function isCurrentInsuHealth(value) {
  return (
    isRecord(value) &&
    value.ok === true &&
    value.runtime === "bun" &&
    value.framework === "hono" &&
    value.buildId === EXPECTED_SERVER_BUILD_ID &&
    value.dataSchemaVersion === EXPECTED_DATA_SCHEMA_VERSION &&
    value.extensionProtocolVersion === CONNECTION_PROTOCOL_VERSION
  )
}

export function isConnectionChallenge(value, expectedOrigin) {
  return (
    isRecord(value) &&
    value.protocolVersion === CONNECTION_PROTOCOL_VERSION &&
    value.serverOrigin === expectedOrigin &&
    typeof value.challengeId === "string" &&
    /^pair-[0-9a-f-]{36}$/.test(value.challengeId) &&
    typeof value.token === "string" &&
    value.token.length >= 32 &&
    typeof value.expiresAt === "string" &&
    Date.parse(value.expiresAt) > Date.now()
  )
}
