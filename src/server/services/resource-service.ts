import { timingSafeEqual } from "node:crypto"
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs"
import path from "node:path"

import type {
  EnvironmentStatusResponse,
  ModelInventoryResponse,
  PromptItem,
  PromptLibraryResponse,
  SupportedSitesResponse,
} from "@shared/contracts/resources"

const ENVIRONMENT_VARIABLES = {
  OPENAI_API_KEY: {
    label: "OpenAI API 金鑰",
    description: "供 OpenAI API 轉錄使用",
  },
} as const

const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const PROMPT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

function executable(candidate: string) {
  try {
    const stat = lstatSync(candidate)
    return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o111) !== 0
  } catch {
    return false
  }
}

async function spawnText(command: string, args: string[], cwd: string) {
  const process = Bun.spawn([command, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const timeout = setTimeout(() => process.kill(), 15_000)
  try {
    const [exitCode, stdout] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
    ])
    if (exitCode !== 0) throw new Error(`command failed with exit code ${exitCode}`)
    return stdout
  } finally {
    clearTimeout(timeout)
  }
}

export class ResourceService {
  readonly sessionToken = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "")
  private readonly environmentSources = new Map<string, "startup" | "session">()
  private supportedSitesCache:
    | { key: string; payload: SupportedSitesResponse }
    | undefined

  constructor(readonly workspace: string) {
    for (const name of Object.keys(ENVIRONMENT_VARIABLES)) {
      if (process.env[name]) this.environmentSources.set(name, "startup")
    }
  }

  private runtimeRoot() {
    return path.join(this.workspace, ".agent-tools", "insu-player")
  }

  private installedPackages() {
    const lockPath = path.join(this.runtimeRoot(), "requirements.lock.txt")
    if (!existsSync(lockPath) || lstatSync(lockPath).isSymbolicLink()) {
      return new Map<string, string>()
    }
    const packages = new Map<string, string>()
    for (const source of readFileSync(lockPath, "utf8").split(/\r?\n/)) {
      const requirement = source.trim()
      if (!requirement || requirement.startsWith("#")) continue
      const pinned = requirement.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s;]+)/)
      const direct = requirement.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s+@\s+(.+)$/)
      const matched = pinned ?? direct
      if (!matched) continue
      packages.set(matched[1].replace(/[-_.]+/g, "-").toLowerCase(), matched[2])
    }
    return packages
  }

  async supportedSites(): Promise<SupportedSitesResponse> {
    const executablePath = [
      path.join(this.runtimeRoot(), ".venv", "bin", "yt-dlp"),
      path.join(this.runtimeRoot(), ".venv", "Scripts", "yt-dlp.exe"),
    ].find(executable)
    if (!executablePath) {
      return {
        provider: "yt-dlp",
        available: false,
        version: null,
        count: 0,
        extractors: [],
        message: "yt-dlp is not installed in this workspace",
      }
    }
    const key = `${executablePath}:${statSync(executablePath).mtimeMs}`
    if (this.supportedSitesCache?.key === key) return this.supportedSitesCache.payload
    try {
      const [version, extractorOutput] = await Promise.all([
        spawnText(executablePath, ["--ignore-config", "--version"], this.workspace),
        spawnText(
          executablePath,
          ["--ignore-config", "--list-extractors"],
          this.workspace,
        ),
      ])
      const extractors = [
        ...new Set(
          extractorOutput
            .split(/\r?\n/)
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ].sort((left, right) => left.localeCompare(right, "en"))
      const payload = {
        provider: "yt-dlp",
        available: true,
        version: version.trim() || null,
        count: extractors.length,
        extractors,
        message: "support follows the installed yt-dlp extractor set",
      } satisfies SupportedSitesResponse
      this.supportedSitesCache = { key, payload }
      return payload
    } catch {
      return {
        provider: "yt-dlp",
        available: false,
        version: null,
        count: 0,
        extractors: [],
        message: "yt-dlp extractor discovery failed",
      }
    }
  }

  modelInventory(): ModelInventoryResponse {
    const runtime = this.runtimeRoot()
    const packages = this.installedPackages()
    const whisperInstalled =
      packages.has("openai-whisper") &&
      [
        path.join(runtime, ".venv", "bin", "whisper"),
        path.join(runtime, ".venv", "Scripts", "whisper.exe"),
      ].some(executable)
    const modelsDirectory = path.join(runtime, "models")
    const models: Array<{
      name: string
      displayName: string
      sizeBytes: number
      ready: boolean
    }> = []
    if (existsSync(modelsDirectory) && !lstatSync(modelsDirectory).isSymbolicLink()) {
      for (const entry of readdirSync(modelsDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || path.extname(entry.name) !== ".pt") {
          continue
        }
        const name = path.basename(entry.name, ".pt")
        if (!MODEL_NAME_PATTERN.test(name)) continue
        const sizeBytes = statSync(path.join(modelsDirectory, entry.name)).size
        if (sizeBytes > 0) {
          models.push({
            name,
            displayName: `OpenAI Whisper ${name}`,
            sizeBytes,
            ready: whisperInstalled,
          })
        }
      }
      models.sort((left, right) => left.name.localeCompare(right.name, "en"))
    }
    const openaiInstalled = packages.has("openai")
    const openaiApiKeyConfigured = Boolean(process.env.OPENAI_API_KEY)
    return {
      local: {
        providerInstalled: whisperInstalled,
        packageVersion: packages.get("openai-whisper") ?? null,
        modelCount: models.length,
        totalSizeBytes: models.reduce((sum, model) => sum + model.sizeBytes, 0),
        models,
      },
      api: {
        providerInstalled: openaiInstalled,
        packageVersion: packages.get("openai") ?? null,
        keyConfigured: openaiApiKeyConfigured,
        models: [
          {
            name: "whisper-1",
            displayName: "OpenAI whisper-1",
            installed: openaiInstalled,
            apiKeyName: "OPENAI_API_KEY",
            apiKeyConfigured: openaiApiKeyConfigured,
          },
        ],
      },
    }
  }

  promptLibrary(): PromptLibraryResponse {
    const promptPath = path.join(this.workspace, "prompts.json")
    if (!existsSync(promptPath)) return { available: true, version: 1, prompts: [] }
    try {
      const payload = JSON.parse(readFileSync(promptPath, "utf8")) as {
        prompts?: unknown[]
      }
      if (!Array.isArray(payload.prompts) || payload.prompts.length > 100) {
        throw new Error("prompts.json must contain at most 100 prompts")
      }
      const ids = new Set<string>()
      const prompts = payload.prompts.map((raw) => {
        if (!raw || typeof raw !== "object") throw new Error("invalid prompt")
        const item = raw as Record<string, unknown>
        if (typeof item.id !== "string" || !PROMPT_ID_PATTERN.test(item.id) || ids.has(item.id)) {
          throw new Error("prompt ids must be valid and unique")
        }
        ids.add(item.id)
        for (const field of ["title", "scenario", "prompt"] as const) {
          if (typeof item[field] !== "string" || !item[field].trim()) {
            throw new Error(`${field} must be non-empty text`)
          }
        }
        return {
          id: item.id,
          title: String(item.title).trim(),
          scenario: String(item.scenario).trim(),
          prompt: String(item.prompt).trim(),
          updatedAt:
            typeof item.updatedAt === "string"
              ? item.updatedAt
              : new Date().toISOString(),
        } satisfies PromptItem
      })
      return { available: true, version: 1, prompts }
    } catch (error) {
      return {
        available: false,
        prompts: [],
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  environmentStatus(): EnvironmentStatusResponse {
    const packages = this.installedPackages()
    return {
      scope: "process",
      variables: Object.entries(ENVIRONMENT_VARIABLES).map(([name, details]) => ({
        name,
        label: details.label,
        description: details.description,
        configured: Boolean(process.env[name]),
        source: this.environmentSources.get(name) ?? null,
        providerInstalled: name === "OPENAI_API_KEY" ? packages.has("openai") : true,
      })),
    }
  }

  setEnvironment(payload: { name: string; value: string }) {
    if (!(payload.name in ENVIRONMENT_VARIABLES)) {
      throw new Error("environment variable is not allowed")
    }
    const value = payload.value.trim()
    if (!value || value.length > 2048 || [...value].some((character) => character.charCodeAt(0) < 32)) {
      throw new Error("environment variable value is invalid")
    }
    process.env[payload.name] = value
    this.environmentSources.set(payload.name, "session")
    return this.environmentStatus()
  }

  clearEnvironment(name: string) {
    if (!(name in ENVIRONMENT_VARIABLES)) {
      throw new Error("environment variable is not allowed")
    }
    delete process.env[name]
    this.environmentSources.delete(name)
    return this.environmentStatus()
  }

  sessionEnvironment(name: string, authorization: string | undefined) {
    const expected = Buffer.from(`Bearer ${this.sessionToken}`)
    const actual = Buffer.from(authorization ?? "")
    if (
      !(name in ENVIRONMENT_VARIABLES) ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected) ||
      !process.env[name]
    ) {
      throw new Error("session environment variable is unavailable")
    }
    return process.env[name]
  }
}
