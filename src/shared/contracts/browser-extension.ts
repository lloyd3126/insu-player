import type { DownloadSourceKind } from "@shared/contracts/library"

export const EXTENSION_CONNECTION_PROTOCOL_VERSION = 2 as const
export const EXTENSION_CONNECT_REQUEST_MESSAGE =
  "INSU_EXTENSION_CONNECT_REQUEST" as const
export const EXTENSION_CONNECT_RESPONSE_MESSAGE =
  "INSU_EXTENSION_CONNECT_RESPONSE" as const

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
  candidate: BrowserMediaCandidate
  cookies?: BrowserCookieInput[]
  authenticationConsentAt?: string
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
  extensionDirectory: string
  libraryUrl: string
}

export interface StartExtensionPairingResponse {
  protocolVersion: typeof EXTENSION_CONNECTION_PROTOCOL_VERSION
  challengeId: string
  token: string
  expiresAt: string
  serverOrigin: string
}

export interface ClaimExtensionPairingRequest {
  protocolVersion: typeof EXTENSION_CONNECTION_PROTOCOL_VERSION
  challengeId: string
  token: string
}

export interface ExtensionConnectRequestMessage {
  type: typeof EXTENSION_CONNECT_REQUEST_MESSAGE
  protocolVersion: typeof EXTENSION_CONNECTION_PROTOCOL_VERSION
  requestId: string
}

export interface ExtensionConnectResponseMessage {
  type: typeof EXTENSION_CONNECT_RESPONSE_MESSAGE
  protocolVersion: typeof EXTENSION_CONNECTION_PROTOCOL_VERSION
  requestId: string
  payload?: StartExtensionPairingResponse
  error?: string
}
