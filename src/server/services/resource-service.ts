import {
  existsSync,
  lstatSync,
  readFileSync,
  statSync,
} from "node:fs"
import path from "node:path"

import type {
  PromptItem,
  PromptLibraryResponse,
  SupportedSitesResponse,
} from "@shared/contracts/resources"

const PROMPT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

function executable(candidate: string) {
  try {
    const stat = lstatSync(candidate)
    return stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o111) !== 0
  } catch {
    return false
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
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
  private supportedSitesCache:
    | { key: string; payload: SupportedSitesResponse }
    | undefined

  constructor(readonly workspace: string) {}

  private runtimeRoot() {
    return path.join(this.workspace, ".agent-tools", "insu-player")
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

  promptLibrary(): PromptLibraryResponse {
    const promptPath = path.join(this.workspace, "prompts.json")
    if (!existsSync(promptPath)) return { available: true, version: 1, prompts: [] }
    try {
      const payload = JSON.parse(readFileSync(promptPath, "utf8")) as Record<
        string,
        unknown
      >
      if (
        payload.version !== 1 ||
        Object.keys(payload).some((key) => !["version", "prompts"].includes(key)) ||
        !Array.isArray(payload.prompts) ||
        payload.prompts.length > 100
      ) {
        throw new Error("prompts.json must contain at most 100 prompts")
      }
      const ids = new Set<string>()
      const prompts = payload.prompts.map((raw) => {
        if (!raw || typeof raw !== "object") throw new Error("invalid prompt")
        const item = raw as Record<string, unknown>
        if (
          Object.keys(item).some(
            (key) => !["id", "title", "scenario", "prompt", "updatedAt"].includes(key),
          ) ||
          !["id", "title", "scenario", "prompt", "updatedAt"].every(
            (key) => key in item,
          ) ||
          typeof item.id !== "string" ||
          !PROMPT_ID_PATTERN.test(item.id) ||
          ids.has(item.id)
        ) {
          throw new Error("prompt ids must be valid and unique")
        }
        ids.add(item.id)
        for (const field of ["title", "scenario", "prompt"] as const) {
          if (typeof item[field] !== "string" || !item[field].trim()) {
            throw new Error(`${field} must be non-empty text`)
          }
        }
        if (!validTimestamp(item.updatedAt)) {
          throw new Error("prompt updatedAt must be a timestamp")
        }
        return {
          id: item.id,
          title: String(item.title).trim(),
          scenario: String(item.scenario).trim(),
          prompt: String(item.prompt).trim(),
          updatedAt: item.updatedAt,
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

}
