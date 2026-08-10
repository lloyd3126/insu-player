import path from "node:path"

import { zValidator } from "@hono/zod-validator"
import { Hono, type Context } from "hono"
import { z } from "zod"

import { contentTypeFor, safeContainedFile } from "@server/lib/files"
import { JobRepository } from "@server/repositories/job-repository"
import { CaptionService } from "@server/services/caption-service"
import {
  MediaOperationError,
  type MediaOperations,
} from "@server/services/media-service"
import {
  RemovalOperationError,
  type RemovalOperations,
} from "@server/services/removal-service"
import { ResourceService } from "@server/services/resource-service"
import {
  SERVER_BUILD_ID,
  STATUS_SCHEMA_VERSION,
} from "@server/runtime-contract"

export interface ApplicationOptions {
  jobs: JobRepository
  media: MediaOperations
  removals: RemovalOperations
  resources: ResourceService
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
  .refine(
    (payload) =>
      payload.time !== undefined || payload.captionLanguage !== undefined,
    { message: "playback update is empty" },
  )

const environmentSchema = z.object({
  name: z.literal("OPENAI_API_KEY"),
  value: z.string().min(1).max(2048),
})

const mediaDownloadSchema = z.object({
  height: z.number().int().positive().max(4320),
})

const mediaActivationSchema = z.object({
  renditionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
})

const subtitleActivationSchema = z.object({
  languageCode: z
    .string()
    .regex(/^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|und)$/),
  trackId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
})

const removalTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("video"),
    videoId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  }),
  z.object({
    kind: z.literal("subtitle-artifact"),
    videoId: z.string().regex(/^[A-Za-z0-9_-]+$/),
    artifactId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  }),
  z.object({
    kind: z.literal("media-rendition"),
    videoId: z.string().regex(/^[A-Za-z0-9_-]+$/),
    renditionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  }),
])

const removalPreviewSchema = z.object({ target: removalTargetSchema })
const removalExecutionSchema = z.object({
  target: removalTargetSchema,
  planDigest: z.string().regex(/^[0-9a-f]{64}$/),
})

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin")
  return origin === new URL(request.url).origin
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
      "/settings",
      "/settings/*",
      "/library",
      "/library/*",
      "/jobs/:videoId",
      "/jobs/:videoId/*",
      "/player/:videoId",
      "/policy",
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
      statusSchemaVersion: STATUS_SCHEMA_VERSION,
      database: "sqlite",
      port,
    })
  })
  app.get("/api/jobs", (context) =>
    context.json({ jobs: options.jobs.list(), serverTime: new Date().toISOString() }),
  )
  app.get("/api/supported-sites", async (context) =>
    context.json(await options.resources.supportedSites()),
  )
  app.get("/api/prompts", (context) => context.json(options.resources.promptLibrary()))
  app.get("/api/models", (context) => context.json(options.resources.modelInventory()))
  app.get("/api/environment", (context) =>
    context.json(options.resources.environmentStatus()),
  )

  app.post(
    "/api/environment",
    zValidator("json", environmentSchema),
    (context) => {
      if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
      try {
        return context.json(options.resources.setEnvironment(context.req.valid("json")))
      } catch (error) {
        return context.json({ error: errorMessage(error) }, 400)
      }
    },
  )
  app.delete("/api/environment/:name", (context) => {
    if (!sameOrigin(context.req.raw)) return context.json({ error: "forbidden" }, 403)
    try {
      return context.json(options.resources.clearEnvironment(context.req.param("name")))
    } catch (error) {
      return context.json({ error: errorMessage(error) }, 400)
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
  app.get("/api/environment/session/:name", (context) => {
    try {
      const name = context.req.param("name")
      return context.json({
        name,
        value: options.resources.sessionEnvironment(
          name,
          context.req.header("authorization"),
        ),
      })
    } catch {
      return context.notFound()
    }
  })

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
      return context.json({ error: errorMessage(error) }, 404)
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
      const config = options.jobs.playerConfig(context.req.param("videoId"))
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
