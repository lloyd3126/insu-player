import { createHash } from "node:crypto"
import {
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { eq } from "drizzle-orm"

import type { AppDatabase } from "@server/db/client"
import {
  localModelDownloadRuns,
  operations,
} from "@server/db/schema"
import { atomicWriteJson } from "@server/lib/files"
import type { LocalTranscriptionModel } from "@shared/contracts/resources"

interface ModelDefinition {
  id: string
  url: string
  checksum: string
  languageSupport: "multilingual" | "english-only"
  approximateBytes: number
  memoryLabel: string
}

const MODEL_DEFINITIONS = [
  ["tiny", "65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9", "multilingual", 75_000_000, "約 1 GB"],
  ["tiny.en", "d3dd57d32accea0b295c96e26691aa14d8822fac7d9d27d5dc00b4ca2826dd03", "english-only", 75_000_000, "約 1 GB"],
  ["base", "ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e", "multilingual", 142_000_000, "約 1 GB"],
  ["base.en", "25a8566e1d0c1e2231d1c762132cd20e0f96a85d16145c3a00adf5d1ac670ead", "english-only", 142_000_000, "約 1 GB"],
  ["small", "9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794", "multilingual", 466_000_000, "約 2 GB"],
  ["small.en", "f953ad0fd29cacd07d5a9eda5624af0f6bcf2258be67c92b79389873d91e0872", "english-only", 466_000_000, "約 2 GB"],
  ["medium", "345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1", "multilingual", 1_500_000_000, "約 5 GB"],
  ["medium.en", "d7440d1dc186f76616474e0ff0b3b6b879abc9d1a4926b7adfa41db2d497ab4f", "english-only", 1_500_000_000, "約 5 GB"],
  ["large-v1", "e4b87e7e0bf463eb8e6956e646f1e277e901512310def2c24bf0e11bd3c28e9a", "multilingual", 2_900_000_000, "約 10 GB"],
  ["large-v2", "81f7c96c852ee8fc832187b0132e569d6c3065a3252ed18e56effd0b6a73e524", "multilingual", 2_900_000_000, "約 10 GB"],
  ["large-v3", "e5b1a55b89c1367dacf97e3e19bfd829a01529dbfdeefa8caeb59b3f1b81dadb", "multilingual", 2_900_000_000, "約 10 GB"],
  ["large-v3-turbo", "aff26ae408abcba5fbf8813c21e62b0941638c5f6eebfb145be0c9839262a19a", "multilingual", 1_600_000_000, "約 6 GB"],
] as const

const MODELS = new Map<string, ModelDefinition>(
  MODEL_DEFINITIONS.map(([id, checksum, languageSupport, approximateBytes, memoryLabel]) => [
    id,
    {
      id,
      checksum,
      languageSupport,
      approximateBytes,
      memoryLabel,
      url: `https://openaipublic.azureedge.net/main/whisper/models/${checksum}/${id}.pt`,
    },
  ]),
)

const ACTIVE_DOWNLOAD_STATES = new Set(["downloading", "validating"])

function now() {
  return new Date().toISOString()
}

function processIsAlive(pid: unknown) {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return false
  try {
    process.kill(Number(pid), 0)
    return true
  } catch {
    return false
  }
}

function sha256File(candidate: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(candidate)
    stream.on("error", reject)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

export class LocalModelOperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 404 | 409 | 500,
  ) {
    super(message)
  }
}

export class LocalModelRuntimeService {
  private readonly modelsDirectory: string
  private readonly active = new Map<string, AbortController>()

  constructor(
    private readonly workspace: string,
    private readonly db: AppDatabase,
  ) {
    this.modelsDirectory = path.join(
      path.resolve(workspace),
      ".agent-tools",
      "insu-player",
      "models",
    )
    mkdirSync(this.modelsDirectory, { recursive: true })
    this.reconcileInterruptedDownloads()
  }

  private reconcileInterruptedDownloads() {
    for (const run of this.db.select().from(localModelDownloadRuns).all()) {
      if (!ACTIVE_DOWNLOAD_STATES.has(run.state)) continue
      this.writeRun({
        ...run,
        state: "failed",
        progress: 0,
        message: "模型下載已中斷，可重新下載",
        errorCode: "interrupted",
        updatedAt: now(),
        completedAt: now(),
      })
    }
  }

  private definition(modelId: string) {
    const definition = MODELS.get(modelId)
    if (!definition) {
      throw new LocalModelOperationError(
        "unsupported local model",
        "unsupported-model",
        404,
      )
    }
    return definition
  }

  private modelPath(modelId: string) {
    return path.join(this.modelsDirectory, `${this.definition(modelId).id}.pt`)
  }

  private validationPath(modelId: string) {
    return path.join(this.modelsDirectory, `${this.definition(modelId).id}.json`)
  }

  private installedState(definition: ModelDefinition) {
    const candidate = this.modelPath(definition.id)
    if (
      !existsSync(candidate) ||
      lstatSync(candidate).isSymbolicLink() ||
      !lstatSync(candidate).isFile()
    ) {
      return { installed: false, valid: false, sizeBytes: null }
    }
    const sizeBytes = statSync(candidate).size
    const manifest = this.validationPath(definition.id)
    if (!existsSync(manifest) || lstatSync(manifest).isSymbolicLink()) {
      return { installed: true, valid: false, sizeBytes }
    }
    try {
      const payload = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>
      const valid =
        payload.schemaVersion === 1 &&
        payload.modelId === definition.id &&
        payload.checksum === definition.checksum &&
        payload.sizeBytes === sizeBytes
      return { installed: true, valid, sizeBytes }
    } catch {
      return { installed: true, valid: false, sizeBytes }
    }
  }

  models(selectedModelId: string | null): LocalTranscriptionModel[] {
    const runs = new Map(
      this.db
        .select()
        .from(localModelDownloadRuns)
        .all()
        .map((run) => [run.modelId, run]),
    )
    return [...MODELS.values()].map((definition) => {
      const installed = this.installedState(definition)
      const run = runs.get(definition.id)
      const state = run?.state ?? "idle"
      const modelId = `local.openai-whisper.${definition.id}`
      const runtimeInstalled = this.whisperInstalled()
      const busy = state === "downloading" || state === "validating"
      const status =
        state === "downloading"
          ? "downloading"
          : state === "validating"
            ? "validating"
            : state === "failed"
              ? "download-failed"
              : installed.installed && !installed.valid
                ? "redownload-required"
                : !installed.installed
                  ? "not-downloaded"
                  : runtimeInstalled
                    ? "ready"
                    : "sdk-missing"
      return {
        id: modelId,
        type: "local",
        displayName: `OpenAI Whisper ${definition.id}`,
        provider: "local",
        providerName: "本機 OpenAI Whisper",
        service: "openai-whisper",
        model: definition.id,
        timingUnitKind: "word",
        selected: selectedModelId === modelId,
        ready: runtimeInstalled && installed.installed && installed.valid && !busy,
        status,
        requiresAudioUpload: false,
        requiresPerRunConsent: false,
        local: {
          runtimeInstalled,
          languageSupport: definition.languageSupport,
          approximateBytes: definition.approximateBytes,
          memoryLabel: definition.memoryLabel,
          ...installed,
          download: {
            state: state as "idle" | "downloading" | "validating" | "failed",
            progress: run?.progress ?? 0,
            downloadedBytes: run?.downloadedBytes ?? 0,
            totalBytes: run?.totalBytes ?? definition.approximateBytes,
            message: run?.message ?? "尚未下載",
            errorCode: run?.errorCode ?? null,
          },
        },
      } satisfies LocalTranscriptionModel
    })
  }

  model(modelId: string, selectedModelId: string | null) {
    const model = this.models(selectedModelId).find((candidate) => candidate.id === modelId)
    if (!model) {
      throw new LocalModelOperationError(
        "unsupported local model",
        "unsupported-model",
        404,
      )
    }
    return model
  }

  whisperInstalled() {
    const runtime = path.join(this.workspace, ".agent-tools", "insu-player")
    return [
      path.join(runtime, ".venv", "bin", "whisper"),
      path.join(runtime, ".venv", "Scripts", "whisper.exe"),
    ].some((candidate) => {
      try {
        const metadata = lstatSync(candidate)
        return !metadata.isSymbolicLink() && metadata.isFile() && (metadata.mode & 0o111) !== 0
      } catch {
        return false
      }
    })
  }

  download(modelId: string) {
    const definition = this.definition(modelId)
    if (this.active.has(modelId)) {
      throw new LocalModelOperationError(
        "model download is already active",
        "download-active",
        409,
      )
    }
    const installed = this.installedState(definition)
    if (installed.installed && installed.valid) {
      throw new LocalModelOperationError(
        "model is already downloaded",
        "model-exists",
        409,
      )
    }
    const controller = new AbortController()
    this.active.set(modelId, controller)
    const timestamp = now()
    this.writeRun({
      modelId,
      state: "downloading",
      progress: 0,
      downloadedBytes: 0,
      totalBytes: definition.approximateBytes,
      message: "正在下載模型",
      errorCode: null,
      startedAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    })
    void this.performDownload(definition, controller).finally(() => {
      this.active.delete(modelId)
    })
    return this.model(`local.openai-whisper.${modelId}`, null)
  }

  private writeRun(run: typeof localModelDownloadRuns.$inferInsert) {
    this.db
      .insert(localModelDownloadRuns)
      .values(run)
      .onConflictDoUpdate({
        target: localModelDownloadRuns.modelId,
        set: run,
      })
      .run()
  }

  private async performDownload(
    definition: ModelDefinition,
    controller: AbortController,
  ) {
    const temporary = path.join(this.modelsDirectory, `.${definition.id}.download`)
    rmSync(temporary, { force: true })
    let downloadedBytes = 0
    let totalBytes = definition.approximateBytes
    let lastUpdate = 0
    const startedAt = now()
    try {
      const response = await fetch(definition.url, { signal: controller.signal })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      const contentLength = Number(response.headers.get("content-length"))
      if (Number.isInteger(contentLength) && contentLength > 0) totalBytes = contentLength
      const progress = new Transform({
        transform: (chunk, _encoding, callback) => {
          downloadedBytes += chunk.length
          const current = Date.now()
          if (current - lastUpdate > 500) {
            lastUpdate = current
            this.writeRun({
              modelId: definition.id,
              state: "downloading",
              progress: Math.min(99, (downloadedBytes / totalBytes) * 100),
              downloadedBytes,
              totalBytes,
              message: "正在下載模型",
              errorCode: null,
              startedAt,
              updatedAt: now(),
              completedAt: null,
            })
          }
          callback(null, chunk)
        },
      })
      await pipeline(
        Readable.fromWeb(response.body as never),
        progress,
        createWriteStream(temporary, { mode: 0o600 }),
      )
      this.writeRun({
        modelId: definition.id,
        state: "validating",
        progress: 99,
        downloadedBytes,
        totalBytes,
        message: "正在驗證模型",
        errorCode: null,
        startedAt,
        updatedAt: now(),
        completedAt: null,
      })
      const checksum = await sha256File(temporary)
      if (checksum !== definition.checksum) throw new Error("checksum mismatch")
      renameSync(temporary, this.modelPath(definition.id))
      atomicWriteJson(this.validationPath(definition.id), {
        schemaVersion: 1,
        modelId: definition.id,
        checksum,
        sizeBytes: downloadedBytes,
        validatedAt: now(),
      })
      this.db
        .delete(localModelDownloadRuns)
        .where(eq(localModelDownloadRuns.modelId, definition.id))
        .run()
    } catch (error) {
      rmSync(temporary, { force: true })
      const cancelled = controller.signal.aborted
      this.writeRun({
        modelId: definition.id,
        state: "failed",
        progress: 0,
        downloadedBytes,
        totalBytes,
        message: cancelled ? "下載已取消" : "模型下載失敗",
        errorCode: cancelled ? "cancelled" : "download-failed",
        startedAt,
        updatedAt: now(),
        completedAt: now(),
      })
    }
  }

  cancel(modelId: string) {
    this.definition(modelId)
    const controller = this.active.get(modelId)
    if (!controller) {
      throw new LocalModelOperationError(
        "model download is not active",
        "download-not-active",
        409,
      )
    }
    controller.abort()
  }

  remove(modelId: string, selectedModelId: string | null) {
    const definition = this.definition(modelId)
    if (selectedModelId === `local.openai-whisper.${modelId}`) {
      throw new LocalModelOperationError(
        "select another model before removing this one",
        "model-selected",
        409,
      )
    }
    if (this.modelInUse(modelId)) {
      throw new LocalModelOperationError(
        "model is being used by an active job",
        "model-in-use",
        409,
      )
    }
    const candidate = this.modelPath(definition.id)
    if (!existsSync(candidate)) {
      throw new LocalModelOperationError(
        "model is not installed",
        "model-not-found",
        404,
      )
    }
    rmSync(candidate, { force: true })
    rmSync(this.validationPath(definition.id), { force: true })
    this.db
      .delete(localModelDownloadRuns)
      .where(eq(localModelDownloadRuns.modelId, definition.id))
      .run()
  }

  private modelInUse(modelId: string) {
    return this.db
      .select({
        provider: operations.processorProvider,
        model: operations.processorModel,
        pid: operations.pid,
      })
      .from(operations)
      .where(eq(operations.state, "running"))
      .all()
      .some(
        (operation) =>
          operation.provider === "local" &&
          operation.model === modelId &&
          processIsAlive(operation.pid),
      )
  }
}
