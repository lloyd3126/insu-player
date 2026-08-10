import { existsSync, lstatSync } from "node:fs"
import path from "node:path"

import type { JobRepository } from "@server/repositories/job-repository"
import {
  mediaOperationIsActive,
  publicMediaCatalog,
  setActiveMediaRendition,
  writeMediaOperation,
} from "@server/services/media-catalog-service"
import type {
  MediaCatalogResponse,
  MediaDownloadResponse,
  MediaOperation,
} from "@shared/contracts/media"

export interface MediaOperations {
  catalog(videoId: string): MediaCatalogResponse
  refresh(videoId: string): Promise<MediaCatalogResponse>
  download(videoId: string, height: number): MediaDownloadResponse
  activate(videoId: string, renditionId: string): MediaCatalogResponse
}

export class MediaOperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 404 | 409 | 500,
  ) {
    super(message)
  }
}

async function outputText(output: number | ReadableStream<Uint8Array> | undefined) {
  if (typeof output === "number" || output === undefined) return ""
  return new Response(output).text()
}

function now() {
  return new Date().toISOString()
}

export class MediaService implements MediaOperations {
  private readonly workspace: string
  private readonly activeDownloads = new Set<string>()

  constructor(
    workspace: string,
    private readonly jobs: JobRepository,
    private readonly scriptPath: string,
  ) {
    this.workspace = path.resolve(workspace)
  }

  private script() {
    if (
      !existsSync(this.scriptPath) ||
      lstatSync(this.scriptPath).isSymbolicLink() ||
      !lstatSync(this.scriptPath).isFile()
    ) {
      throw new MediaOperationError(
        "media quality script is unavailable",
        "runtime-unavailable",
        500,
      )
    }
    return this.scriptPath
  }

  private jobDirectory(videoId: string) {
    try {
      const directory = this.jobs.jobDirectory(videoId)
      if (!existsSync(directory)) throw new Error("job not found")
      return directory
    } catch {
      throw new MediaOperationError("video job not found", "resource-not-found", 404)
    }
  }

  catalog(videoId: string) {
    try {
      return publicMediaCatalog(this.jobDirectory(videoId), videoId)
    } catch (error) {
      throw new MediaOperationError(
        error instanceof Error ? error.message : String(error),
        "media-catalog-unavailable",
        404,
      )
    }
  }

  private async run(args: string[]) {
    const child = Bun.spawn([this.script(), this.workspace, ...args], {
      cwd: this.workspace,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      outputText(child.stdout),
      outputText(child.stderr),
      child.exited,
    ])
    if (exitCode !== 0) {
      throw new MediaOperationError(
        stderr.trim() || stdout.trim() || `media command exited with ${exitCode}`,
        "media-command-failed",
        409,
      )
    }
  }

  async refresh(videoId: string) {
    const current = this.catalog(videoId)
    if (mediaOperationIsActive(current.operation)) {
      throw new MediaOperationError(
        "a media download is already active",
        "media-operation-active",
        409,
      )
    }
    await this.run([videoId, "discover"])
    return this.catalog(videoId)
  }

  download(videoId: string, height: number): MediaDownloadResponse {
    if (!Number.isInteger(height) || height <= 0 || height > 4320) {
      throw new MediaOperationError("invalid media height", "invalid-height", 400)
    }
    const directory = this.jobDirectory(videoId)
    const catalog = this.catalog(videoId)
    if (!catalog.formats.some((format) => format.height === height)) {
      throw new MediaOperationError(
        "the selected source quality is unavailable; refresh the list",
        "format-unavailable",
        409,
      )
    }
    if (catalog.renditions.some((rendition) => rendition.height === height)) {
      throw new MediaOperationError(
        "the selected quality is already downloaded",
        "rendition-exists",
        409,
      )
    }
    if (
      this.activeDownloads.has(videoId) ||
      mediaOperationIsActive(catalog.operation)
    ) {
      throw new MediaOperationError(
        "another media quality operation is already active",
        "media-operation-active",
        409,
      )
    }

    const runId = `quality-${height}p-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const timestamp = now()
    const operation: MediaOperation = {
      id: runId,
      requestedHeight: height,
      state: "discovering",
      stage: "discovering",
      progress: 0,
      message: "正在確認來源畫質",
      error: null,
      pid: null,
      startedAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    }
    writeMediaOperation(directory, videoId, operation)
    let child: ReturnType<typeof Bun.spawn>
    try {
      child = Bun.spawn(
        [
          this.script(),
          this.workspace,
          videoId,
          "download",
          String(height),
          "--run-id",
          runId,
        ],
        { cwd: this.workspace, stdout: "ignore", stderr: "ignore" },
      )
    } catch (error) {
      writeMediaOperation(directory, videoId, {
        ...operation,
        state: "failed",
        stage: "starting",
        message: "無法啟動畫質下載",
        error: error instanceof Error ? error.message : String(error),
        completedAt: now(),
        updatedAt: now(),
      })
      throw new MediaOperationError(
        "could not start the media download",
        "media-command-failed",
        500,
      )
    }
    operation.pid = child.pid
    operation.updatedAt = now()
    writeMediaOperation(directory, videoId, operation)
    this.activeDownloads.add(videoId)
    void child.exited.finally(() => this.activeDownloads.delete(videoId))
    return { accepted: true, operation }
  }

  activate(videoId: string, renditionId: string) {
    const catalog = this.catalog(videoId)
    if (mediaOperationIsActive(catalog.operation)) {
      throw new MediaOperationError(
        "wait for the active media download to finish",
        "media-operation-active",
        409,
      )
    }
    try {
      return setActiveMediaRendition(
        this.jobDirectory(videoId),
        videoId,
        renditionId,
      )
    } catch (error) {
      throw new MediaOperationError(
        error instanceof Error ? error.message : String(error),
        "rendition-not-found",
        404,
      )
    }
  }
}
