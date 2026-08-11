import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { and, desc, eq, isNull, like } from "drizzle-orm"

import type { AppDatabase } from "@server/db/client"
import { extensionPairings } from "@server/db/schema"
import type {
  ExtensionPairingStatus,
  StartExtensionPairingResponse,
} from "@shared/contracts/browser-extension"
import { EXTENSION_CONNECTION_PROTOCOL_VERSION } from "@shared/contracts/browser-extension"

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/
const TOKEN_HASH_PREFIX = `v${EXTENSION_CONNECTION_PROTOCOL_VERSION}:`

interface PairingChallenge {
  tokenHash: string
  expiresAt: number
  serverOrigin: string
}

function hashToken(token: string) {
  return `${TOKEN_HASH_PREFIX}${createHash("sha256").update(token).digest("hex")}`
}

function tokenMatches(token: string, expectedHash: string) {
  if (!expectedHash.startsWith(TOKEN_HASH_PREFIX)) return false
  const actual = Buffer.from(hashToken(token))
  const expected = Buffer.from(expectedHash)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export class ExtensionPairingError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 401 | 404 | 409,
  ) {
    super(message)
  }
}

export class ExtensionPairingService {
  private readonly challenges = new Map<string, PairingChallenge>()

  constructor(
    private readonly db: AppDatabase,
    private readonly extensionDirectory: string,
  ) {}

  status(serverOrigin: string): ExtensionPairingStatus {
    const pairing = this.db
      .select()
      .from(extensionPairings)
      .where(
        and(
          isNull(extensionPairings.revokedAt),
          like(extensionPairings.tokenHash, `${TOKEN_HASH_PREFIX}%`),
        ),
      )
      .orderBy(desc(extensionPairings.pairedAt))
      .get()
    return {
      protocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
      paired: Boolean(pairing),
      extensionOrigin: pairing?.extensionOrigin ?? null,
      pairedAt: pairing?.pairedAt ?? null,
      lastSeenAt: pairing?.lastSeenAt ?? null,
      extensionDirectory: this.extensionDirectory,
      libraryUrl: `${serverOrigin}/extension/library`,
    }
  }

  start(serverOrigin: string): StartExtensionPairingResponse {
    this.prune()
    const challengeId = `pair-${crypto.randomUUID()}`
    const token = randomBytes(32).toString("base64url")
    const expiresAt = Date.now() + CHALLENGE_TTL_MS
    this.challenges.set(challengeId, {
      tokenHash: hashToken(token),
      expiresAt,
      serverOrigin,
    })
    return {
      protocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
      challengeId,
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      serverOrigin,
    }
  }

  claim(
    challengeId: string,
    token: string,
    extensionOrigin: string,
    protocolVersion: number,
  ) {
    this.prune()
    this.assertProtocol(protocolVersion)
    if (!EXTENSION_ORIGIN_PATTERN.test(extensionOrigin)) {
      throw new ExtensionPairingError(
        "只接受 Chrome 擴充功能連接",
        "invalid-extension-origin",
        400,
      )
    }
    const challenge = this.challenges.get(challengeId)
    if (!challenge || !tokenMatches(token, challenge.tokenHash)) {
      throw new ExtensionPairingError(
        "連接邀請無效或已過期",
        "connection-expired",
        409,
      )
    }
    this.challenges.delete(challengeId)
    const timestamp = new Date().toISOString()
    this.db.transaction((transaction) => {
      transaction
        .update(extensionPairings)
        .set({ revokedAt: timestamp })
        .where(isNull(extensionPairings.revokedAt))
        .run()
      transaction
        .insert(extensionPairings)
        .values({
          id: `extension-${crypto.randomUUID()}`,
          extensionOrigin,
          tokenHash: challenge.tokenHash,
          pairedAt: timestamp,
          lastSeenAt: timestamp,
          revokedAt: null,
        })
        .run()
    })
    return {
      paired: true as const,
      serverOrigin: challenge.serverOrigin,
      libraryUrl: `${challenge.serverOrigin}/extension/library`,
    }
  }

  authenticate(
    token: string | null,
    extensionOrigin: string | null,
    protocolVersion: string | null,
  ) {
    this.assertProtocol(protocolVersion)
    if (!token || !extensionOrigin || !EXTENSION_ORIGIN_PATTERN.test(extensionOrigin)) {
      throw new ExtensionPairingError("擴充功能尚未連接", "not-connected", 401)
    }
    const pairing = this.db
      .select()
      .from(extensionPairings)
      .where(
        and(
          eq(extensionPairings.extensionOrigin, extensionOrigin),
          isNull(extensionPairings.revokedAt),
          like(extensionPairings.tokenHash, `${TOKEN_HASH_PREFIX}%`),
        ),
      )
      .orderBy(desc(extensionPairings.pairedAt))
      .get()
    if (!pairing || !tokenMatches(token, pairing.tokenHash)) {
      throw new ExtensionPairingError("擴充功能連接已失效", "not-connected", 401)
    }
    this.db
      .update(extensionPairings)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(extensionPairings.id, pairing.id))
      .run()
    return pairing
  }

  revoke() {
    const timestamp = new Date().toISOString()
    this.db
      .update(extensionPairings)
      .set({ revokedAt: timestamp })
      .where(isNull(extensionPairings.revokedAt))
      .run()
    return { paired: false as const }
  }

  private prune() {
    const current = Date.now()
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= current) this.challenges.delete(id)
    }
  }

  private assertProtocol(protocolVersion: string | number | null) {
    if (Number(protocolVersion) !== EXTENSION_CONNECTION_PROTOCOL_VERSION) {
      throw new ExtensionPairingError(
        "擴充功能版本與目前 INSU Player 不相容，請重新載入擴充功能",
        "incompatible-extension-protocol",
        409,
      )
    }
  }
}
