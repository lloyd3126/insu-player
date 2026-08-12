export const CONNECTION_PROTOCOL_VERSION = 4
export const BOOTSTRAP_KIND = "insu-player-extension-bootstrap"
export const BOOTSTRAP_SCHEMA_VERSION = 1
export const EXPECTED_SERVER_BUILD_ID = "insu-player-extension-bootstrap-v1"
export const EXPECTED_DATA_SCHEMA_VERSION = 9

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

export function normalizeBootstrap(value, now = Date.now()) {
  if (!isRecord(value)) return null
  const serverOrigin = normalizeLoopbackOrigin(value.serverOrigin)
  if (
    value.kind !== BOOTSTRAP_KIND ||
    value.schemaVersion !== BOOTSTRAP_SCHEMA_VERSION ||
    value.protocolVersion !== CONNECTION_PROTOCOL_VERSION ||
    value.buildId !== EXPECTED_SERVER_BUILD_ID ||
    value.dataSchemaVersion !== EXPECTED_DATA_SCHEMA_VERSION ||
    !serverOrigin ||
    typeof value.invitationId !== "string" ||
    !/^pair-[0-9a-f-]{36}$/.test(value.invitationId) ||
    typeof value.ticket !== "string" ||
    value.ticket.length < 32 ||
    typeof value.issuedAt !== "string" ||
    !Number.isFinite(Date.parse(value.issuedAt)) ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    Date.parse(value.issuedAt) >= Date.parse(value.expiresAt) ||
    Date.parse(value.expiresAt) <= now
  ) {
    return null
  }
  return {
    kind: BOOTSTRAP_KIND,
    schemaVersion: BOOTSTRAP_SCHEMA_VERSION,
    protocolVersion: CONNECTION_PROTOCOL_VERSION,
    serverOrigin,
    buildId: EXPECTED_SERVER_BUILD_ID,
    dataSchemaVersion: EXPECTED_DATA_SCHEMA_VERSION,
    invitationId: value.invitationId,
    ticket: value.ticket,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  }
}
