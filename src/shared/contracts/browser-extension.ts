import type { DownloadSourceKind } from "@shared/contracts/download-batch"

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
  paired: boolean
  extensionOrigin: string | null
  pairedAt: string | null
  lastSeenAt: string | null
  extensionDirectory: string
  libraryUrl: string
}

export interface StartExtensionPairingResponse {
  challengeId: string
  token: string
  expiresAt: string
  serverOrigin: string
}

export interface ClaimExtensionPairingRequest {
  challengeId: string
  token: string
}
