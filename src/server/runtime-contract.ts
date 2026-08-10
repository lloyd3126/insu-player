export const SERVER_BUILD_ID = "insu-player-status-6-content-5-strict"
export const STATUS_SCHEMA_VERSION = 6

interface RuntimeDescriptor {
  buildId?: unknown
  statusSchemaVersion?: unknown
}

export function isCurrentServerRuntime(
  descriptor: RuntimeDescriptor,
  health: RuntimeDescriptor | null,
) {
  return (
    descriptor.buildId === SERVER_BUILD_ID &&
    descriptor.statusSchemaVersion === STATUS_SCHEMA_VERSION &&
    health?.buildId === SERVER_BUILD_ID &&
    health.statusSchemaVersion === STATUS_SCHEMA_VERSION
  )
}
