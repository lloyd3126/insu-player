import { readFileSync } from "node:fs"
import path from "node:path"

import { zValidator } from "@hono/zod-validator"
import { Hono, type Context } from "hono"
import { z } from "zod"

import { contentTypeFor, safeContainedFile } from "@server/lib/files"
import { JobRepository } from "@server/repositories/job-repository"
import { CaptionService } from "@server/services/caption-service"
import {
  DownloadQueueOperationError,
  type DownloadQueueService,
} from "@server/services/download-queue-service"
import type { LibraryService } from "@server/services/library-service"
import {
  LocalMediaImportError,
  type LocalMediaImportService,
} from "@server/services/local-media-import-service"
import {
  ExtensionPairingError,
  type ExtensionPairingService,
} from "@server/services/extension-pairing-service"
import type { ExtensionPackageService } from "@server/services/extension-package-service"
import {
  LocalModelOperationError,
} from "@server/services/local-model-service"
import {
  ProviderCredentialError,
} from "@server/services/provider-credential-service"
import {
  MediaOperationError,
  type MediaOperations,
} from "@server/services/media-service"
import {
  MediaSessionOperationError,
  type MediaSessionService,
} from "@server/services/media-session-service"
import {
  NoteOperationError,
  type NoteService,
} from "@server/services/note-service"
import {
  RemovalOperationError,
  type RemovalOperations,
} from "@server/services/removal-service"
import { ResourceService } from "@server/services/resource-service"
import { RuntimeService } from "@server/services/runtime-service"
import {
  SummaryOperationError,
  type SummaryService,
} from "@server/services/summary-service"
import {
  SubtitleStyleOperationError,
  subtitleStylePreferencesSchema,
  type SubtitleStyleService,
} from "@server/services/subtitle-style-service"
import type { TranscriptionModelCatalogService } from "@server/services/transcription-model-catalog-service"
import { EXTENSION_CONNECTION_PROTOCOL_VERSION } from "@shared/contracts/browser-extension"
import { webVttToSrt, webVttToText } from "@shared/domain/subtitle"
import {
  SERVER_BUILD_ID,
  DATA_SCHEMA_VERSION,
} from "@server/runtime-contract"

export interface ApplicationOptions {
  jobs: JobRepository
  media: MediaOperations
  downloads: DownloadQueueService
  imports: LocalMediaImportService
  library: LibraryService
  extensionPairing: ExtensionPairingService
  extensionPackage: ExtensionPackageService
  mediaSessions: MediaSessionService
  models: TranscriptionModelCatalogService
  summaries: SummaryService
  subtitleStyles: SubtitleStyleService
  notes: NoteService
  removals: RemovalOperations
  resources: ResourceService
  runtime: RuntimeService
  libraryAppRoot: string
  playerRoot: string
}

const playbackSchema = z
  .object({
    time: z.number().finite().nonnegative().optional(),
    duration: z.number().finite().positive().nullable().optional(),
    captionLanguage: z
      .string()
      .regex(/^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|und)$/)
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (payload) =>
      payload.time !== undefined || payload.captionLanguage !== undefined,
    { message: "playback update is empty" },
  )

const providerCredentialSchema = z.object({
  value: z.string().min(1).max(2048),
}).strict()

const agentIntentSchema = z
  .object({
    kind: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    videoId: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
    source: z.string().min(1).max(500),
  })
  .strict()

const downloadSourceSchema = z
  .object({
    kind: z.enum(["page", "embed", "network-media"]),
    pageUrl: z.string().min(1).max(2_048),
    sessionId: z.string().regex(/^media-session-[0-9a-f-]{36}$/).optional(),
    candidateFingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  })
  .strict()

const createLibraryItemsSchema = z
  .object({
    sources: z.array(downloadSourceSchema).min(1).max(50),
    rightsConfirmed: z.boolean(),
  })
  .strict()

const createLocalMediaImportSchema = z
  .object({
    originalName: z.string().min(1).max(240),
    title: z.string().min(1).max(200),
    sizeBytes: z.number().int().positive().max(16 * 1024 * 1024 * 1024),
    contentType: z.string().max(200),
    rightsConfirmed: z.literal(true),
  })
  .strict()

const activeSubtitleStyleSchema = z
  .object({
    styles: subtitleStylePreferencesSchema,
    presetId: z.string().regex(/^subtitle-style-[0-9a-f-]{36}$/).nullable(),
  })
  .strict()

const subtitleStylePresetSchema = z
  .object({
    name: z.string().min(1).max(80),
    styles: subtitleStylePreferencesSchema,
  })
  .strict()

const extensionPairingClaimSchema = z
  .object({
    protocolVersion: z.literal(EXTENSION_CONNECTION_PROTOCOL_VERSION),
    invitationId: z.string().regex(/^pair-[0-9a-f-]{36}$/),
    ticket: z.string().min(32).max(128),
  })
  .strict()

const browserCookieSchema = z
  .object({
    name: z.string().min(1).max(8_192),
    value: z.string().max(8_192),
    domain: z.string().min(1).max(512),
    path: z.string().min(1).max(2_048),
    secure: z.boolean(),
    httpOnly: z.boolean(),
    hostOnly: z.boolean(),
    session: z.boolean(),
    expirationDate: z.number().finite().nonnegative().optional(),
  })
  .strict()

const browserMediaSessionSchema = z
  .object({
    candidates: z
      .array(z.object({
        kind: z.enum(["page", "embed", "network-media"]),
        pageUrl: z.string().min(1).max(2_048),
        frameUrl: z.string().min(1).max(8_192).optional(),
        mediaUrl: z.string().min(1).max(16_384).optional(),
        protocol: z.enum(["http", "https", "hls"]).optional(),
        candidateFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
      }).strict())
      .min(1)
      .max(80),
    cookies: z.array(browserCookieSchema).max(300),
    authenticationConsentAt: z.string().datetime(),
  })
  .strict()

const retryDownloadItemSchema = z
  .object({
    lowQualityApproved: z.boolean().optional().default(false),
  })
  .strict()

const modelIdSchema = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,159}$/)
const providerIdSchema = z.enum([
  "openai",
  "groq",
  "elevenlabs",
  "xai",
  "openrouter",
])
const modelSelectionSchema = z.object({ modelId: modelIdSchema }).strict()

function modelId(value: string) {
  const result = modelIdSchema.safeParse(value)
  if (!result.success) {
    throw new LocalModelOperationError(
      "unsupported canonical model",
      "unsupported-model",
      400,
    )
  }
  return result.data
}

function providerId(value: string) {
  const result = providerIdSchema.safeParse(value)
  if (!result.success) {
    throw new ProviderCredentialError(
      "unsupported transcription provider",
      "unsupported-provider",
      404,
    )
  }
  return result.data
}

const summaryKindSchema = z.enum(["text", "mindmap"])
const summaryImportSchema = z
  .object({
    kind: summaryKindSchema,
    languageCode: z.string().regex(/^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|und)$/),
    title: z.string().min(1).max(160),
    content: z.string().min(1).max(250_000),
    sourceSubtitleArtifactId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/).optional(),
    sourceSummaryArtifactId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/).optional(),
  })
  .strict()

const summaryActivationSchema = z
  .object({
    kind: summaryKindSchema,
    artifactId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  })
  .strict()

const noteSchema = z
  .object({
    title: z.string().max(200),
    body: z.string().min(1).max(20_000),
    startSeconds: z.number().finite().nonnegative().nullable().optional(),
    endSeconds: z.number().finite().nonnegative().nullable().optional(),
    subtitleTrackId: z.string().max(200).nullable().optional(),
    subtitleCueId: z.string().max(200).nullable().optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  })
  .strict()

const mediaDownloadSchema = z
  .object({
    height: z.number().int().positive().max(4320),
  })
  .strict()

const mediaActivationSchema = z
  .object({
    renditionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  })
  .strict()

const subtitleActivationSchema = z
  .object({
    languageCode: z
      .string()
      .regex(/^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|und)$/),
    trackId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  })
  .strict()

const removalTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("video"),
    videoId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  }).strict(),
  z.object({
    kind: z.literal("subtitle-artifact"),
    videoId: z.string().regex(/^[A-Za-z0-9_-]+$/),
    artifactId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  }).strict(),
  z.object({
    kind: z.literal("media-rendition"),
    videoId: z.string().regex(/^[A-Za-z0-9_-]+$/),
    renditionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  }).strict(),
  z.object({
    kind: z.literal("summary-artifact"),
    videoId: z.string().regex(/^[A-Za-z0-9_-]+$/),
    artifactId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  }).strict(),
])

const removalPreviewSchema = z
  .object({ target: removalTargetSchema })
  .strict()
const removalExecutionSchema = z
  .object({
    target: removalTargetSchema,
    planDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  return origin === new URL(request.url).origin
}

function chromeExtensionOrigin(request: Request) {
  const origin = request.headers.get("origin")
  return origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
    ? origin
    : null
}

function authenticatedExtensionOrigin(request: Request) {
  return (
    chromeExtensionOrigin(request) ??
    (/^chrome-extension:\/\/[a-p]{32}$/.test(
      request.headers.get("x-insu-extension-origin") ?? "",
    )
      ? request.headers.get("x-insu-extension-origin")
      : null)
  )
}

function extensionErrorResponse(context: Context, error: unknown) {
  if (
    error instanceof ExtensionPairingError ||
    error instanceof MediaSessionOperationError
  ) {
    return context.json(
      { error: error.message, code: error.code },
      error.status,
    )
  }
  return context.json(
    { error: errorMessage(error), code: "extension-operation-failed" },
    500,
  )
}

function removalErrorResponse(context: Context, error: unknown) {
  if (error instanceof RemovalOperationError) {
    const payload = { error: error.message, code: error.code }
    if (error.status === 404) return context.json(payload, 404)
    if (error.status === 409) return context.json(payload, 409)
    return context.json(payload, 500)
  }
  return context.json({ error: errorMessage(error), code: "removal-failed" }, 500)
}

function mediaErrorResponse(context: Context, error: unknown) {
  if (error instanceof MediaOperationError) {
    const payload = { error: error.message, code: error.code }
    if (error.status === 400) return context.json(payload, 400)
    if (error.status === 404) return context.json(payload, 404)
    if (error.status === 409) return context.json(payload, 409)
    return context.json(payload, 500)
  }
  return context.json({ error: errorMessage(error), code: "media-failed" }, 500)
}

function operationErrorResponse(
  context: Context,
  error: unknown,
  expected:
    | typeof DownloadQueueOperationError
    | typeof LocalModelOperationError
    | typeof ProviderCredentialError
    | typeof SummaryOperationError,
) {
  if (error instanceof expected) {
    const payload = { error: error.message, code: error.code }
    if (error.status === 400) return context.json(payload, 400)
    if (error.status === 404) return context.json(payload, 404)
    if (error.status === 409) return context.json(payload, 409)
    return context.json(payload, 500)
  }
  return context.json({ error: errorMessage(error), code: "operation-failed" }, 500)
}

function localImportErrorResponse(context: Context, error: unknown) {
  if (error instanceof LocalMediaImportError) {
    return context.json({ error: error.message, code: error.code }, error.status)
  }
  return context.json(
    { error: errorMessage(error), code: "local-import-failed" },
    500,
  )
}

function subtitleStyleErrorResponse(context: Context, error: unknown) {
  if (error instanceof SubtitleStyleOperationError) {
    return context.json({ error: error.message, code: error.code }, error.status)
  }
  return context.json(
    { error: errorMessage(error), code: "subtitle-style-failed" },
    500,
  )
}

function serveFile(
  request: Request,
  candidate: string,
  options: { cache?: string; range?: boolean } = {},
) {
  const file = Bun.file(candidate)
  if (!file.size) return new Response("Not found", { status: 404 })
  const headers = new Headers({
    "Content-Type": contentTypeFor(candidate),
    "Cache-Control": options.cache ?? "no-store",
    "Content-Length": String(file.size),
  })
  if (options.range) headers.set("Accept-Ranges", "bytes")

  if (options.range) {
    const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/)
    if (range) {
      const requestedStart = range[1] ? Number(range[1]) : null
      const requestedEnd = range[2] ? Number(range[2]) : null
      const start =
        requestedStart === null
          ? Math.max(0, file.size - Math.max(0, requestedEnd ?? 0))
          : requestedStart
      const end = Math.min(
        file.size - 1,
        requestedStart === null ? file.size - 1 : (requestedEnd ?? file.size - 1),
      )
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= file.size) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${file.size}` },
        })
      }
      headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`)
      headers.set("Content-Length", String(end - start + 1))
      const body =
        request.method === "HEAD" ? null : file.slice(start, end + 1).stream()
      return new Response(body, {
        status: 206,
        headers,
      })
    }
  }

  return new Response(request.method === "HEAD" ? null : file, { headers })
}

export function createApplication(options: ApplicationOptions) {
  const app = new Hono()
  const captions = new CaptionService(options.jobs)

  app.use("/api/extension/*", async (context, next) => {
    const origin = chromeExtensionOrigin(context.req.raw)
    if (origin) {
      context.header("Access-Control-Allow-Origin", origin)
      context.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
      context.header(
        "Access-Control-Allow-Headers",
        "Content-Type, X-INSU-Extension-Origin, X-INSU-Extension-Protocol, X-INSU-Extension-Token",
      )
      context.header("Access-Control-Max-Age", "600")
      context.header("Vary", "Origin")
    }
    if (context.req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: context.res.headers })
    }
    await next()
    if (origin) context.header("Cross-Origin-Resource-Policy", "cross-origin")
  })

  app.use("*", async (context, next) => {
    await next()
    context.header("X-Content-Type-Options", "nosniff")
    context.header("X-Frame-Options", "SAMEORIGIN")
    context.header("Referrer-Policy", "no-referrer")
    context.header("Cross-Origin-Resource-Policy", "same-origin")
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'",
    )
  })

  app.on(
    ["GET", "HEAD"],
    [
      "/",
      "/index.html",
      "/guide",
      "/guide/*",
      "/prompts",
      "/supported-sites",
      "/settings",
      "/settings/models/:modelId",
      "/library",
      "/library/*",
      "/jobs/:videoId",
      "/jobs/:videoId/*",
      "/player/:videoId",
      "/policy",
      "/extension",
      "/extension/download",
      "/extension/connect",
      "/extension/usage",
      "/extension/library",
    ],
    (context) =>
      serveFile(context.req.raw, path.join(options.libraryAppRoot, "index.html")),
  )

  app.on(["GET", "HEAD"], "/assets/*", (context) => {
    const relative = context.req.path.slice("/assets/".length)
    const assetRoot = path.join(options.libraryAppRoot, "assets")
    const asset = safeContainedFile(
      assetRoot,
      path.join(assetRoot, relative),
    )
    return asset
      ? serveFile(context.req.raw, asset, {
          cache: "public, max-age=31536000, immutable",
        })
      : context.notFound()
  })

  app.get("/api/health", (context) => {
    const port = Number(new URL(context.req.url).port || 80)
    return context.json({
      ok: true,
      status: "ok",
      runtime: "bun",
      framework: "hono",
      buildId: SERVER_BUILD_ID,
      dataSchemaVersion: DATA_SCHEMA_VERSION,
      extensionProtocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
      database: "sqlite",
      port,
    })
  })
  app.get("/api/extension/pairing", (context) => {
    return context.json(
      options.extensionPairing.status(new URL(context.req.url).origin),
    )
  })
  app.post("/api/extension/package", (context) => {
    if (!sameOrigin(context.req.raw)) {
      return context.json({ error: "forbidden" }, 403)
    }
    const bootstrap = options.extensionPairing.createBootstrap(
      new URL(context.req.url).origin,
    )
    try {
      const archive = options.extensionPackage.createPackage(bootstrap)
      return new Response(archive.contents, {
        headers: {
          "Cache-Control": "no-store",
          "Pragma": "no-cache",
          "Content-Disposition": `attachment; filename="${archive.filename}"`,
          "Content-Type": "application/zip",
          "X-INSU-Package-SHA256": archive.checksum,
        },
      })
    } catch (error) {
      options.extensionPairing.revokeInvitation(bootstrap.invitationId)
      return context.json(
        { error: error instanceof Error ? error.message : String(error) },
        500,
      )
    }
  })
  app.post(
    "/api/extension/pairing/claim",
    zValidator("json", extensionPairingClaimSchema),
    (context) => {
      try {
        const origin = chromeExtensionOrigin(context.req.raw)
        if (!origin) {
          throw new ExtensionPairingError(
            "只接受 Chrome 擴充功能連接",
            "invalid-extension-origin",
            400,
          )
        }
        const payload = context.req.valid("json")
        return context.json(
          options.extensionPairing.claim(
            payload.invitationId,
            payload.ticket,
            origin,
            payload.protocolVersion,
            new URL(context.req.url).origin,
          ),
          201,
        )
      } catch (error) {
        return extensionErrorResponse(context, error)
      }
    },
  )
  app.delete("/api/extension/pairing", (context) => {
    if (!sameOrigin(context.req.raw)) {
      return context.json({ error: "forbidden" }, 403)
    }
    return context.json(options.extensionPairing.revoke())
  })
  app.get("/api/extension/health", (context) => {
    try {
      options.extensionPairing.authenticate(
        context.req.header("x-insu-extension-token") ?? null,
        authenticatedExtensionOrigin(context.req.raw),
        context.req.header("x-insu-extension-protocol") ?? null,
      )
      return context.json({
        ok: true,
        runtime: "bun",
        framework: "hono",
        port: Number(new URL(context.req.url).port || 80),
        libraryUrl: `${new URL(context.req.url).origin}/extension/library`,
        buildId: SERVER_BUILD_ID,
        dataSchemaVersion: DATA_SCHEMA_VERSION,
        extensionProtocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
      })
    } catch (error) {
      return extensionErrorResponse(context, error)
    }
  })
  app.post(
    "/api/extension/media-sessions",
    zValidator("json", browserMediaSessionSchema),
    async (context) => {
      try {
        options.extensionPairing.authenticate(
          context.req.header("x-insu-extension-token") ?? null,
          authenticatedExtensionOrigin(context.req.raw),
          context.req.header("x-insu-extension-protocol") ?? null,
        )
        return context.json(
          await options.mediaSessions.create(context.req.valid("json")),
          201,
        )
      } catch (error) {
        return extensionErrorResponse(context, error)
      }
    },
  )
  app.post(
    "/api/extension/library/items",
    zValidator("json", createLibraryItemsSchema),
    (context) => {
      try {
        options.extensionPairing.authenticate(
          context.req.header("x-insu-extension-token") ?? null,
          authenticatedExtensionOrigin(context.req.raw),
          context.req.header("x-insu-extension-protocol") ?? null,
        )
        const payload = context.req.valid("json")
        return context.json(
          options.downloads.create(payload.sources, payload.rightsConfirmed),
          202,
        )
      } catch (error) {
        if (error instanceof DownloadQueueOperationError) {
          return operationErrorResponse(
            context,
            error,
            DownloadQueueOperationError,
          )
        }
        return extensionErrorResponse(context, error)
      }
    },
  )
  app.get("/api/jobs", (context) =>
    context.json({ jobs: options.jobs.list(), serverTime: new Date().toISOString() }),
  )
  app.get("/api/supported-sites", async (context) =>
    context.json(await options.resources.supportedSites()),
  )
  app.get("/api/prompts", (context) => context.json(options.resources.promptLibrary()))
  app.get("/api/models", (context) =>
    context.json(options.models.catalog()),
  )
  app.get("/api/runtime", (context) => context.json(options.runtime.status()))
  app.get("/api/subtitle-styles", (context) => {
    try {
      return context.json(options.subtitleStyles.catalog())
    } catch (error) {
      return subtitleStyleErrorResponse(context, error)
    }
  })
  app.put(
    "/api/subtitle-styles/active",
    zValidator("json", activeSubtitleStyleSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        const payload = context.req.valid("json")
        return context.json(
          options.subtitleStyles.setActive(payload.styles, payload.presetId),
        )
      } catch (error) {
        return subtitleStyleErrorResponse(context, error)
      }
    },
  )
  app.post(
    "/api/subtitle-styles/presets",
    zValidator("json", subtitleStylePresetSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        const payload = context.req.valid("json")
        return context.json(
          options.subtitleStyles.createPreset(payload.name, payload.styles),
          201,
        )
      } catch (error) {
        return subtitleStyleErrorResponse(context, error)
      }
    },
  )
  app.put(
    "/api/subtitle-styles/presets/:presetId",
    zValidator("json", subtitleStylePresetSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        const payload = context.req.valid("json")
        return context.json(
          options.subtitleStyles.updatePreset(
            context.req.param("presetId"),
            payload.name,
            payload.styles,
          ),
        )
      } catch (error) {
        return subtitleStyleErrorResponse(context, error)
      }
    },
  )
  app.delete("/api/subtitle-styles/presets/:presetId", (context) => {
    if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
    try {
      return context.json(
        options.subtitleStyles.removePreset(context.req.param("presetId")),
      )
    } catch (error) {
      return subtitleStyleErrorResponse(context, error)
    }
  })
  app.post(
    "/api/agent-intents",
    zValidator("json", agentIntentSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        return context.json(options.runtime.recordIntent(context.req.valid("json")), 201)
      } catch (error) {
        return context.json({ error: errorMessage(error) }, 400)
      }
    },
  )
  app.get("/api/library", (context) => context.json(options.library.list()))
  app.post(
    "/api/library/imports",
    zValidator("json", createLocalMediaImportSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        return context.json(options.imports.create(context.req.valid("json")), 201)
      } catch (error) {
        return localImportErrorResponse(context, error)
      }
    },
  )
  app.put("/api/library/imports/:importId/content", async (context) => {
    if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
    try {
      return context.json(
        await options.imports.upload(
          context.req.param("importId"),
          context.req.raw,
        ),
        202,
      )
    } catch (error) {
      return localImportErrorResponse(context, error)
    }
  })
  app.delete("/api/library/imports/:importId", (context) => {
    if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
    try {
      options.imports.remove(context.req.param("importId"))
      return context.json(options.library.list())
    } catch (error) {
      return localImportErrorResponse(context, error)
    }
  })
  app.post(
    "/api/library/items",
    zValidator("json", createLibraryItemsSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        const payload = context.req.valid("json")
        return context.json(
          options.downloads.create(payload.sources, payload.rightsConfirmed),
          202,
        )
      } catch (error) {
        return operationErrorResponse(context, error, DownloadQueueOperationError)
      }
    },
  )
  for (const action of ["pause", "resume"] as const) {
    app.post(`/api/download-queue/${action}`, (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        if (action === "pause") options.downloads.pause()
        else options.downloads.resume()
        return context.json(options.library.list())
      } catch (error) {
        return operationErrorResponse(context, error, DownloadQueueOperationError)
      }
    })
  }
  app.post(
    "/api/library/items/:itemId/retry",
    zValidator("json", retryDownloadItemSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        options.downloads.retry(
          context.req.param("itemId"),
          context.req.valid("json").lowQualityApproved,
        )
        return context.json(options.library.list())
      } catch (error) {
        return operationErrorResponse(context, error, DownloadQueueOperationError)
      }
    },
  )
  app.post(
    "/api/library/items/:itemId/approve-low-quality",
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        options.downloads.approveLowQuality(context.req.param("itemId"))
        return context.json(options.library.list())
      } catch (error) {
        return operationErrorResponse(context, error, DownloadQueueOperationError)
      }
    },
  )
  app.delete(
    "/api/library/items/:itemId/download",
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        options.downloads.cancel(context.req.param("itemId"))
        return context.json(options.library.list())
      } catch (error) {
        return operationErrorResponse(context, error, DownloadQueueOperationError)
      }
    },
  )
  app.delete("/api/library/items/:itemId", (context) => {
    if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
    try {
      options.downloads.remove(context.req.param("itemId"))
      return context.json(options.library.list())
    } catch (error) {
      return operationErrorResponse(context, error, DownloadQueueOperationError)
    }
  })
  app.get("/api/models/:modelId", (context) => {
    try {
      return context.json(options.models.detail(modelId(context.req.param("modelId"))))
    } catch (error) {
      return operationErrorResponse(context, error, LocalModelOperationError)
    }
  })
  app.put(
    "/api/models/selection",
    zValidator("json", modelSelectionSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        return context.json(
          options.models.select(context.req.valid("json").modelId),
        )
      } catch (error) {
        return operationErrorResponse(context, error, LocalModelOperationError)
      }
    },
  )
  app.post("/api/models/:modelId/download", (context) => {
    if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
    try {
      return context.json(
        options.models.download(modelId(context.req.param("modelId"))),
        202,
      )
    } catch (error) {
      return operationErrorResponse(context, error, LocalModelOperationError)
    }
  })
  app.delete("/api/models/:modelId/download", (context) => {
    if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
    try {
      options.models.cancelDownload(modelId(context.req.param("modelId")))
      return context.json({ cancelled: true })
    } catch (error) {
      return operationErrorResponse(context, error, LocalModelOperationError)
    }
  })
  app.delete("/api/models/:modelId", (context) => {
    if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
    try {
      options.models.remove(modelId(context.req.param("modelId")))
      return context.json({ removed: true })
    } catch (error) {
      return operationErrorResponse(context, error, LocalModelOperationError)
    }
  })
  app.put(
    "/api/providers/:providerId/credential",
    zValidator("json", providerCredentialSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        return context.json(
          options.models.setCredential(
            providerId(context.req.param("providerId")),
            context.req.valid("json").value,
          ),
        )
      } catch (error) {
        return operationErrorResponse(context, error, ProviderCredentialError)
      }
    },
  )
  app.delete("/api/providers/:providerId/credential", (context) => {
    if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
    try {
      return context.json(
        options.models.clearCredential(providerId(context.req.param("providerId"))),
      )
    } catch (error) {
      return operationErrorResponse(context, error, ProviderCredentialError)
    }
  })
  app.get("/api/providers/:providerId/credential/session", (context) => {
    try {
      const id = providerId(context.req.param("providerId"))
      return context.json({
        providerId: id,
        value: options.models.credentials.sessionValue(
          id,
          context.req.header("authorization"),
        ),
      })
    } catch {
      return context.notFound()
    }
  })
  app.get("/api/jobs/:videoId/notes", (context) => {
    try {
      options.jobs.summarize(context.req.param("videoId"))
      return context.json(options.notes.list(context.req.param("videoId")))
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 404)
    }
  })
  app.post(
    "/api/jobs/:videoId/notes",
    zValidator("json", noteSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        options.jobs.summarize(context.req.param("videoId"))
        return context.json(
          options.notes.create(
            context.req.param("videoId"),
            context.req.valid("json"),
          ),
          201,
        )
      } catch (error) {
        if (error instanceof NoteOperationError) {
          return context.json({ error: error.message, code: error.code }, 400)
        }
        return context.json({ error: errorMessage(error) }, 400)
      }
    },
  )
  app.put(
    "/api/jobs/:videoId/notes/:noteId",
    zValidator("json", noteSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        return context.json(
          options.notes.update(
            context.req.param("videoId"),
            context.req.param("noteId"),
            context.req.valid("json"),
          ),
        )
      } catch (error) {
        const status = error instanceof NoteOperationError && error.code === "not-found" ? 404 : 400
        return context.json({ error: errorMessage(error) }, status)
      }
    },
  )
  app.delete("/api/jobs/:videoId/notes/:noteId", (context) => {
    if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
    try {
      return context.json(
        options.notes.remove(
          context.req.param("videoId"),
          context.req.param("noteId"),
        ),
      )
    } catch (error) {
      const status = error instanceof NoteOperationError && error.code === "not-found" ? 404 : 400
      return context.json({ error: errorMessage(error) }, status)
    }
  })
  app.post(
    "/api/removals/preview",
    zValidator("json", removalPreviewSchema),
    async (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        return context.json(
          await options.removals.preview(context.req.valid("json").target),
        )
      } catch (error) {
        return removalErrorResponse(context, error)
      }
    },
  )
  app.post(
    "/api/removals/execute",
    zValidator("json", removalExecutionSchema),
    async (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      const request = context.req.valid("json")
      try {
        return context.json(
          await options.removals.execute(request.target, request.planDigest),
        )
      } catch (error) {
        return removalErrorResponse(context, error)
      }
    },
  )
  app.get("/api/jobs/:videoId/log", (context) => {
    try {
      const requested = Number(context.req.query("lines") ?? 160)
      const videoId = context.req.param("videoId")
      return context.json({
        videoId,
        log: options.jobs.tailLog(videoId, requested),
      })
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 404)
    }
  })
  app.get("/api/jobs/:videoId/captions", (context) => {
    try {
      return context.json(captions.comparison(context.req.param("videoId")))
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 404)
    }
  })
  app.get("/api/jobs/:videoId/subtitles", (context) => {
    try {
      return context.json(
        options.jobs.subtitleCatalog(context.req.param("videoId")),
      )
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 404)
    }
  })
  app.put(
    "/api/jobs/:videoId/subtitles/active",
    zValidator("json", subtitleActivationSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) {
        return context.json({ error: "forbidden" }, 403)
      }
      try {
        const payload = context.req.valid("json")
        return context.json(
          options.jobs.setActiveSubtitleTrack(
            context.req.param("videoId"),
            payload.languageCode,
            payload.trackId,
          ),
        )
      } catch (error) {
        return context.json({ error: errorMessage(error) }, 400)
      }
    },
  )
  app.get("/api/jobs/:videoId/media", (context) => {
    try {
      return context.json(options.media.catalog(context.req.param("videoId")))
    } catch (error) {
      return mediaErrorResponse(context, error)
    }
  })
  app.get("/api/jobs/:videoId/summaries", (context) => {
    try {
      return context.json(options.summaries.catalog(context.req.param("videoId")))
    } catch (error) {
      return operationErrorResponse(context, error, SummaryOperationError)
    }
  })
  app.get("/api/jobs/:videoId/summaries/:artifactId", (context) => {
    try {
      return context.json(
        options.summaries.artifact(
          context.req.param("videoId"),
          context.req.param("artifactId"),
        ),
      )
    } catch (error) {
      return operationErrorResponse(context, error, SummaryOperationError)
    }
  })
  app.post(
    "/api/jobs/:videoId/summaries/import",
    zValidator("json", summaryImportSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        return context.json(
          options.summaries.import(
            context.req.param("videoId"),
            context.req.valid("json"),
          ),
          201,
        )
      } catch (error) {
        return operationErrorResponse(context, error, SummaryOperationError)
      }
    },
  )
  app.put(
    "/api/jobs/:videoId/summaries/active",
    zValidator("json", summaryActivationSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        const payload = context.req.valid("json")
        return context.json(
          options.summaries.activate(
            context.req.param("videoId"),
            payload.kind,
            payload.artifactId,
          ),
        )
      } catch (error) {
        return operationErrorResponse(context, error, SummaryOperationError)
      }
    },
  )
  app.post("/api/jobs/:videoId/media/refresh", async (context) => {
    if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
    try {
      return context.json(
        await options.media.refresh(context.req.param("videoId")),
      )
    } catch (error) {
      return mediaErrorResponse(context, error)
    }
  })
  app.post(
    "/api/jobs/:videoId/media/renditions",
    zValidator("json", mediaDownloadSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        return context.json(
          options.media.download(
            context.req.param("videoId"),
            context.req.valid("json").height,
          ),
          202,
        )
      } catch (error) {
        return mediaErrorResponse(context, error)
      }
    },
  )
  app.put(
    "/api/jobs/:videoId/media/active",
    zValidator("json", mediaActivationSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        return context.json(
          options.media.activate(
            context.req.param("videoId"),
            context.req.valid("json").renditionId,
          ),
        )
      } catch (error) {
        return mediaErrorResponse(context, error)
      }
    },
  )
  app.get(
    "/api/jobs/:videoId/subtitles/artifacts/:artifactId/captions",
    (context) => {
      try {
        return context.json(
          captions.artifactComparison(
            context.req.param("videoId"),
            context.req.param("artifactId"),
          ),
        )
      } catch (error) {
        return context.json({ error: errorMessage(error) }, 404)
      }
    },
  )
  app.get(
    "/api/jobs/:videoId/subtitles/artifacts/:artifactId/tracks/:trackId/export",
    (context) => {
      try {
        const format = context.req.query("format")
        if (format !== "srt" && format !== "txt") {
          return context.json({ error: "unsupported subtitle export format" }, 400)
        }
        const track = options.jobs.subtitleTrackForExport(
          context.req.param("videoId"),
          context.req.param("artifactId"),
          context.req.param("trackId"),
        )
        const source = readFileSync(track.path, "utf8")
        const body = format === "srt" ? webVttToSrt(source) : webVttToText(source)
        const filename = [
          context.req.param("videoId"),
          track.kind,
          track.languageCode,
          `r${track.revision}`,
        ].join("-") + `.${format}`
        return new Response(body, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Content-Type":
              format === "srt"
                ? "application/x-subrip; charset=utf-8"
                : "text/plain; charset=utf-8",
          },
        })
      } catch (error) {
        return context.json({ error: errorMessage(error) }, 404)
      }
    },
  )
  app.get("/api/jobs/:videoId/playback", (context) => {
    try {
      return context.json(options.jobs.playbackState(context.req.param("videoId")))
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 404)
    }
  })
  app.put(
    "/api/jobs/:videoId/playback",
    zValidator("json", playbackSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) {
        return context.json({ error: "forbidden" }, 403)
      }
      try {
        return context.json(
          options.jobs.savePlaybackState(
            context.req.param("videoId"),
            context.req.valid("json"),
          ),
        )
      } catch (error) {
        return context.json({ error: errorMessage(error) }, 400)
      }
    },
  )
  app.get("/api/jobs/:videoId", (context) => {
    try {
      return context.json(options.jobs.summarize(context.req.param("videoId"), true))
    } catch (error) {
      const message = errorMessage(error)
      return context.json(
        { error: message },
        message === "job not found" || message === "invalid video ID" ? 404 : 500,
      )
    }
  })

  app.get("/watch/:videoId", (context) => {
    try {
      const videoId = context.req.param("videoId")
      const summary = options.jobs.summarize(videoId)
      if (!summary.watchable) return context.notFound()
      const query = new URL(context.req.url).search
      return context.redirect(`/watch/${videoId}/${query}`)
    } catch {
      return context.notFound()
    }
  })
  app.on(["GET", "HEAD"], ["/watch/:videoId/", "/watch/:videoId/index.html"], (context) => {
    try {
      const summary = options.jobs.summarize(context.req.param("videoId"))
      return summary.watchable
        ? serveFile(context.req.raw, path.join(options.playerRoot, "index.html"))
        : context.notFound()
    } catch {
      return context.notFound()
    }
  })
  app.get("/watch/:videoId/config.js", (context) => {
    try {
      const config = {
        ...options.jobs.playerConfig(context.req.param("videoId")),
        captionStyles: options.subtitleStyles.catalog().active,
      }
      return context.body(`window.INSU_PLAYER_CONFIG = ${JSON.stringify(config)};\n`, 200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      })
    } catch {
      return context.notFound()
    }
  })
  app.on(["GET", "HEAD"], "/media/:videoId/video", (context) => {
    try {
      const candidate = options.jobs.videoPath(context.req.param("videoId"))
      return candidate
        ? serveFile(context.req.raw, candidate, {
            cache: "private, max-age=3600",
            range: true,
          })
        : context.notFound()
    } catch {
      return context.notFound()
    }
  })
  app.on(["GET", "HEAD"], "/captions/:videoId/:file", (context) => {
    try {
      const file = context.req.param("file")
      if (!file.endsWith(".vtt")) return context.notFound()
      const code = file.slice(0, -4)
      const candidate = options.jobs.activeCaptionPath(
        context.req.param("videoId"),
        code,
      )
      return candidate
        ? serveFile(context.req.raw, candidate, { cache: "no-store" })
        : context.notFound()
    } catch {
      return context.notFound()
    }
  })
  app.on(["GET", "HEAD"], "/thumbnails/:videoId", (context) => {
    try {
      const candidate = options.jobs.thumbnailPath(context.req.param("videoId"))
      return candidate
        ? serveFile(context.req.raw, candidate, {
            cache: "private, max-age=3600",
          })
        : context.notFound()
    } catch {
      return context.notFound()
    }
  })

  app.notFound((context) => context.text("Not found", 404))
  app.onError((error, context) => {
    console.error(error)
    return context.json({ error: "internal server error" }, 500)
  })
  return app
}
