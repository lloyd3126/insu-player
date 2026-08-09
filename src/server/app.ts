import path from "node:path"

import { zValidator } from "@hono/zod-validator"
import { Hono } from "hono"
import { z } from "zod"

import { contentTypeFor, safeContainedFile } from "@server/lib/files"
import { JobRepository } from "@server/repositories/job-repository"
import { CaptionService } from "@server/services/caption-service"
import { ResourceService } from "@server/services/resource-service"

export interface ApplicationOptions {
  jobs: JobRepository
  resources: ResourceService
  libraryAppRoot: string
  playerRoot: string
}

const playbackSchema = z.object({
  time: z.number().finite().nonnegative(),
  duration: z.number().finite().positive().nullable().optional(),
})

const environmentSchema = z.object({
  name: z.literal("OPENAI_API_KEY"),
  value: z.string().min(1).max(2048),
})

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function sameOrigin(request: Request) {
  const host = request.headers.get("host")
  const origin = request.headers.get("origin")
  return Boolean(host && origin === `http://${host}`)
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

  app.on(["GET", "HEAD"], ["/", "/index.html"], (context) =>
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
      const candidate = options.jobs.captionPaths(context.req.param("videoId")).get(code)
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
