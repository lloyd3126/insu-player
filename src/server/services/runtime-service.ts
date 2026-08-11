import { realpathSync, statSync } from "node:fs"
import path from "node:path"

import { desc, eq } from "drizzle-orm"

import type { AppDatabase } from "@server/db/client"
import {
  agentIntents,
  operations,
  runtimeCapabilities,
} from "@server/db/schema"
import type {
  AgentIntentResponse,
  RuntimeCapability,
  RuntimeStatusResponse,
} from "@shared/contracts/resources"

function regularFile(candidate: string, allowedRoot: string) {
  try {
    const resolvedRoot = realpathSync(allowedRoot)
    const resolvedCandidate = realpathSync(candidate)
    const relative = path.relative(resolvedRoot, resolvedCandidate)
    return (
      statSync(resolvedCandidate).isFile() &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
  } catch {
    return false
  }
}

export class RuntimeService {
  constructor(
    private readonly workspace: string,
    private readonly db: AppDatabase,
  ) {}

  status(): RuntimeStatusResponse {
    const root = path.join(this.workspace, ".agent-tools", "insu-player")
    const now = new Date().toISOString()
    const definitions = [
      [
        "database",
        "影音庫資料庫",
        path.join(this.workspace, "app.db"),
        "SQLite 已建立",
        this.workspace,
      ],
      [
        "bun",
        "網頁執行環境",
        path.join(root, "bun-runtime", "bin", "bun"),
        "Bun 已安裝在 workspace",
        root,
      ],
      [
        "python",
        "影音處理套件",
        path.join(root, ".venv", "bin", "python"),
        "影音處理套件已安裝在 workspace",
        root,
      ],
      [
        "ffmpeg",
        "影音轉換工具",
        path.join(root, "bin", "ffmpeg"),
        "FFmpeg 已安裝在 workspace",
        root,
      ],
      [
        "yt-dlp",
        "來源下載工具",
        path.join(root, ".venv", "bin", "yt-dlp"),
        "yt-dlp 已安裝在 workspace",
        root,
      ],
      [
        "whisper",
        "本機語音辨識",
        path.join(root, ".venv", "bin", "whisper"),
        "Whisper 已安裝在 workspace",
        root,
      ],
      [
        "whisper-medium",
        "本機逐字時間模型",
        path.join(root, "models", "medium.pt"),
        "Whisper medium 已下載",
        root,
      ],
    ] as const
    const capabilities: RuntimeCapability[] = definitions.map(
      ([key, label, candidate, readyDetail, allowedRoot]) => {
        const ready = regularFile(candidate, allowedRoot)
        return {
          key,
          label,
          state: ready ? "ready" : "missing",
          detail: ready ? readyDetail : "尚未準備",
          version: null,
          checkedAt: now,
        }
      },
    )
    this.db.transaction((transaction) => {
      for (const capability of capabilities) {
        transaction
          .insert(runtimeCapabilities)
          .values(capability)
          .onConflictDoUpdate({
            target: runtimeCapabilities.key,
            set: capability,
          })
          .run()
      }
    })
    const setup = this.db
      .select()
      .from(operations)
      .where(eq(operations.kind, "setup"))
      .orderBy(desc(operations.updatedAt))
      .get()
    return {
      initialized: capabilities.every((capability) => capability.state === "ready"),
      capabilities,
      activeSetup:
        setup && ["queued", "running", "validating", "needs_user"].includes(setup.state)
          ? {
              id: setup.id,
              state: setup.state,
              stage: setup.stage,
              progress: setup.progress,
              message: setup.message,
              updatedAt: setup.updatedAt,
            }
          : null,
    }
  }

  recordIntent(payload: {
    kind: string
    videoId?: string
    source: string
  }): AgentIntentResponse {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(payload.kind)) {
      throw new Error("intent kind is invalid")
    }
    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const id = `intent-${crypto.randomUUID()}`
    this.db
      .insert(agentIntents)
      .values({
        id,
        kind: payload.kind,
        videoId: payload.videoId ?? null,
        state: "copied",
        payloadJson: { source: payload.source.slice(0, 500) },
        createdAt,
        copiedAt: createdAt,
        expiresAt,
      })
      .run()
    return { id, kind: payload.kind, state: "copied", createdAt, expiresAt }
  }
}
