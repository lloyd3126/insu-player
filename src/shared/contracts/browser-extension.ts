import type { DownloadSourceKind } from "@shared/contracts/library"

export const EXTENSION_CONNECTION_PROTOCOL_VERSION = 4 as const
export const EXTENSION_BOOTSTRAP_KIND = "insu-player-extension-bootstrap" as const
export const EXTENSION_BOOTSTRAP_SCHEMA_VERSION = 1 as const

export interface BrowserCookieInput {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  hostOnly: boolean
  session: boolean
  expirationDate?: number
}

export interface BrowserMediaCandidate {
  kind: DownloadSourceKind
  pageUrl: string
  frameUrl?: string
  mediaUrl?: string
  protocol?: "http" | "https" | "hls"
  candidateFingerprint: string
}

export interface CreateBrowserMediaSessionRequest {
  candidates: BrowserMediaCandidate[]
  cookies: BrowserCookieInput[]
  authenticationConsentAt: string
}

export interface CreateBrowserMediaSessionResponse {
  sessionId: string
  expiresAt: string
  candidateFingerprint: string
}

export interface ExtensionPairingStatus {
  protocolVersion: typeof EXTENSION_CONNECTION_PROTOCOL_VERSION
  paired: boolean
  extensionOrigin: string | null
  pairedAt: string | null
  lastSeenAt: string | null
  serverOrigin: string
  libraryUrl: string
}

export interface ExtensionBootstrap {
  kind: typeof EXTENSION_BOOTSTRAP_KIND
  schemaVersion: typeof EXTENSION_BOOTSTRAP_SCHEMA_VERSION
  protocolVersion: typeof EXTENSION_CONNECTION_PROTOCOL_VERSION
  serverOrigin: string
  buildId: string
  dataSchemaVersion: number
  invitationId: string
  ticket: string
  issuedAt: string
  expiresAt: string
}

export interface ClaimExtensionPairingRequest {
  protocolVersion: typeof EXTENSION_CONNECTION_PROTOCOL_VERSION
  invitationId: string
  ticket: string
}

export interface ClaimExtensionPairingResponse {
  paired: true
  serverOrigin: string
  libraryUrl: string
  connectionToken: string
}
