import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { and, desc, eq, isNull } from "drizzle-orm"

import type { AppDatabase } from "@server/db/client"
import {
  extensionPairingInvitations,
  extensionPairings,
} from "@server/db/schema"
import {
  DATA_SCHEMA_VERSION,
  SERVER_BUILD_ID,
} from "@server/runtime-contract"
import type {
  ClaimExtensionPairingResponse,
  ExtensionBootstrap,
  ExtensionPairingStatus,
} from "@shared/contracts/browser-extension"
import {
  EXTENSION_BOOTSTRAP_KIND,
  EXTENSION_BOOTSTRAP_SCHEMA_VERSION,
  EXTENSION_CONNECTION_PROTOCOL_VERSION,
} from "@shared/contracts/browser-extension"

const INVITATION_TTL_MS = 30 * 60 * 1000
const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/
const TOKEN_HASH_PREFIX = `v${EXTENSION_CONNECTION_PROTOCOL_VERSION}:`

function hashSecret(secret: string) {
  return `${TOKEN_HASH_PREFIX}${createHash("sha256").update(secret).digest("hex")}`
}

function secretMatches(secret: string, expectedHash: string) {
  if (!expectedHash.startsWith(TOKEN_HASH_PREFIX)) return false
  const actual = Buffer.from(hashSecret(secret))
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
  constructor(
    private readonly db: AppDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  status(serverOrigin: string): ExtensionPairingStatus {
    const pairing = this.db
      .select()
      .from(extensionPairings)
      .where(
        and(
          eq(
            extensionPairings.protocolVersion,
            EXTENSION_CONNECTION_PROTOCOL_VERSION,
          ),
          isNull(extensionPairings.revokedAt),
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
      serverOrigin,
      libraryUrl: `${serverOrigin}/extension/library`,
    }
  }

  createBootstrap(serverOrigin: string): ExtensionBootstrap {
    const invitationId = `pair-${crypto.randomUUID()}`
    const ticket = randomBytes(32).toString("base64url")
    const issuedAt = this.now()
    const expiresAt = issuedAt + INVITATION_TTL_MS
    const issuedAtIso = new Date(issuedAt).toISOString()
    this.db.transaction((transaction) => {
      transaction
        .update(extensionPairingInvitations)
        .set({ revokedAt: issuedAtIso })
        .where(
          and(
            isNull(extensionPairingInvitations.claimedAt),
            isNull(extensionPairingInvitations.revokedAt),
          ),
        )
        .run()
      transaction
        .insert(extensionPairingInvitations)
        .values({
          id: invitationId,
          protocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
          serverOrigin,
          ticketHash: hashSecret(ticket),
          issuedAt: issuedAtIso,
          expiresAt: new Date(expiresAt).toISOString(),
          claimedAt: null,
          claimedExtensionOrigin: null,
          revokedAt: null,
        })
        .run()
    })
    return {
      kind: EXTENSION_BOOTSTRAP_KIND,
      schemaVersion: EXTENSION_BOOTSTRAP_SCHEMA_VERSION,
      protocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
      serverOrigin,
      buildId: SERVER_BUILD_ID,
      dataSchemaVersion: DATA_SCHEMA_VERSION,
      invitationId,
      ticket,
      issuedAt: issuedAtIso,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  revokeInvitation(invitationId: string) {
    this.db
      .update(extensionPairingInvitations)
      .set({ revokedAt: new Date(this.now()).toISOString() })
      .where(
        and(
          eq(extensionPairingInvitations.id, invitationId),
          isNull(extensionPairingInvitations.claimedAt),
          isNull(extensionPairingInvitations.revokedAt),
        ),
      )
      .run()
  }

  claim(
    invitationId: string,
    ticket: string,
    extensionOrigin: string,
    protocolVersion: number,
    serverOrigin: string,
  ): ClaimExtensionPairingResponse {
    this.assertProtocol(protocolVersion)
    if (!EXTENSION_ORIGIN_PATTERN.test(extensionOrigin)) {
      throw new ExtensionPairingError(
        "只接受 Chrome 擴充功能連接",
        "invalid-extension-origin",
        400,
      )
    }
    const invitation = this.db
      .select()
      .from(extensionPairingInvitations)
      .where(eq(extensionPairingInvitations.id, invitationId))
      .get()
    if (!invitation || !secretMatches(ticket, invitation.ticketHash)) {
      throw new ExtensionPairingError(
        "擴充功能啟用資格無效",
        "bootstrap-invalid",
        409,
      )
    }
    if (invitation.serverOrigin !== serverOrigin) {
      throw new ExtensionPairingError(
        "擴充功能啟用資格不屬於目前服務",
        "bootstrap-origin-mismatch",
        409,
      )
    }
    if (invitation.claimedAt) {
      throw new ExtensionPairingError(
        "這份擴充功能 ZIP 已完成連接",
        "bootstrap-consumed",
        409,
      )
    }
    if (invitation.revokedAt) {
      throw new ExtensionPairingError(
        "這份擴充功能 ZIP 已被更新版本取代",
        "bootstrap-revoked",
        409,
      )
    }
    const timestampMs = this.now()
    const timestamp = new Date(timestampMs).toISOString()
    if (Date.parse(invitation.expiresAt) <= timestampMs) {
      this.revokeInvitation(invitationId)
      throw new ExtensionPairingError(
        "這份擴充功能 ZIP 已超過連接期限",
        "bootstrap-expired",
        409,
      )
    }

    const connectionToken = randomBytes(32).toString("base64url")
    this.db.transaction((transaction) => {
      transaction
        .update(extensionPairingInvitations)
        .set({
          claimedAt: timestamp,
          claimedExtensionOrigin: extensionOrigin,
        })
        .where(
          and(
            eq(extensionPairingInvitations.id, invitationId),
            isNull(extensionPairingInvitations.claimedAt),
            isNull(extensionPairingInvitations.revokedAt),
          ),
        )
        .run()
      transaction
        .update(extensionPairings)
        .set({ revokedAt: timestamp })
        .where(isNull(extensionPairings.revokedAt))
        .run()
      transaction
        .insert(extensionPairings)
        .values({
          id: `extension-${crypto.randomUUID()}`,
          protocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
          extensionOrigin,
          tokenHash: hashSecret(connectionToken),
          pairedAt: timestamp,
          lastSeenAt: timestamp,
          revokedAt: null,
        })
        .run()
      transaction
        .update(extensionPairingInvitations)
        .set({ revokedAt: timestamp })
        .where(
          and(
            isNull(extensionPairingInvitations.claimedAt),
            isNull(extensionPairingInvitations.revokedAt),
          ),
        )
        .run()
    })
    return {
      paired: true,
      serverOrigin: invitation.serverOrigin,
      libraryUrl: `${invitation.serverOrigin}/extension/library`,
      connectionToken,
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
          eq(extensionPairings.protocolVersion, EXTENSION_CONNECTION_PROTOCOL_VERSION),
          eq(extensionPairings.extensionOrigin, extensionOrigin),
          isNull(extensionPairings.revokedAt),
        ),
      )
      .orderBy(desc(extensionPairings.pairedAt))
      .get()
    if (!pairing || !secretMatches(token, pairing.tokenHash)) {
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
    const timestamp = new Date(this.now()).toISOString()
    this.db.transaction((transaction) => {
      transaction
        .update(extensionPairings)
        .set({ revokedAt: timestamp })
        .where(isNull(extensionPairings.revokedAt))
        .run()
      transaction
        .update(extensionPairingInvitations)
        .set({ revokedAt: timestamp })
        .where(
          and(
            isNull(extensionPairingInvitations.claimedAt),
            isNull(extensionPairingInvitations.revokedAt),
          ),
        )
        .run()
    })
    return { paired: false as const }
  }

  private assertProtocol(protocolVersion: string | number | null) {
    if (Number(protocolVersion) !== EXTENSION_CONNECTION_PROTOCOL_VERSION) {
      throw new ExtensionPairingError(
        "擴充功能版本與目前 INSU Player 不一致，請重新下載擴充功能",
        "incompatible-extension-protocol",
        409,
      )
    }
  }
}
