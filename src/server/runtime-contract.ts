export const SERVER_BUILD_ID = "insu-player-extension-bootstrap-v1"
export const DATA_SCHEMA_VERSION = 9
export const MEDIA_RECORD_SCHEMA_VERSION = 3

interface RuntimeDescriptor {
  buildId?: unknown
  dataSchemaVersion?: unknown
}

export function isCurrentServerRuntime(
  descriptor: RuntimeDescriptor,
  health: RuntimeDescriptor | null,
) {
  return (
    descriptor.buildId === SERVER_BUILD_ID &&
    descriptor.dataSchemaVersion === DATA_SCHEMA_VERSION &&
    health?.buildId === SERVER_BUILD_ID &&
    health.dataSchemaVersion === DATA_SCHEMA_VERSION
  )
}
