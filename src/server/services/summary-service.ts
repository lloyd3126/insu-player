import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

import { and, eq } from "drizzle-orm"

import type { AppDatabase } from "@server/db/client"
import {
  activeSummaryArtifacts,
  summaryArtifacts,
  summaryDependencies,
} from "@server/db/schema"
import type { JobRepository } from "@server/repositories/job-repository"
import type {
  SummaryArtifact,
  SummaryArtifactKind,
  SummaryArtifactResponse,
  SummaryCatalogResponse,
  SummaryImportRequest,
} from "@shared/contracts/summary"

const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/
const LANGUAGE_PATTERN = /^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|und)$/
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/
const MAX_CONTENT_BYTES = 250_000

function now() {
  return new Date().toISOString()
}

function checksum(content: string) {
  return createHash("sha256").update(content).digest("hex")
}

function safeText(value: string, field: string, maximum: number) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(trimmed)) {
    throw new SummaryOperationError(`${field} is invalid`, "invalid-summary", 400)
  }
  return trimmed
}

function validateMindmap(content: string, videoId: string) {
  if (/<[^>]+>/.test(content)) {
    throw new SummaryOperationError(
      "mind map raw HTML is not allowed",
      "unsafe-mindmap",
      400,
    )
  }
  if (/<\/?(?:script|iframe|img|video|audio|object|embed|style|svg)\b/i.test(content)) {
    throw new SummaryOperationError(
      "mind map HTML and embeds are not allowed",
      "unsafe-mindmap",
      400,
    )
  }
  if (/```|!\[[^\]]*\]\(/.test(content)) {
    throw new SummaryOperationError(
      "mind map code blocks and images are not allowed",
      "unsafe-mindmap",
      400,
    )
  }
  const nodes = content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
  if (nodes.length === 0 || nodes.length > 120) {
    throw new SummaryOperationError(
      "mind map must contain between 1 and 120 nodes",
      "invalid-mindmap",
      400,
    )
  }
  const roots = nodes.filter((line) => /^#\s+/.test(line))
  if (roots.length !== 1 || nodes[0] !== roots[0]) {
    throw new SummaryOperationError(
      "mind map requires exactly one root heading",
      "invalid-mindmap",
      400,
    )
  }
  for (const line of nodes) {
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    const list = line.match(/^(\s*)-\s+(.+)$/)
    if (!heading && !list) {
      throw new SummaryOperationError(
        "mind map only accepts headings and list items",
        "invalid-mindmap",
        400,
      )
    }
    const label = (heading?.[2] ?? list?.[2] ?? "").trim()
    if (!label || label.length > 160) {
      throw new SummaryOperationError(
        "mind map node text is invalid",
        "invalid-mindmap",
        400,
      )
    }
    if (list) {
      const spaces = list[1].length
      if (spaces % 2 !== 0 || spaces / 2 + 2 > 4) {
        throw new SummaryOperationError(
          "mind map nesting exceeds four levels",
          "invalid-mindmap",
          400,
        )
      }
    }
    for (const match of label.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1]
      const expected = `/player/${encodeURIComponent(videoId)}?time=`
      if (!target.startsWith(expected) || !/^\d+(?:\.\d{1,3})?$/.test(target.slice(expected.length))) {
        throw new SummaryOperationError(
          "mind map links must be same-origin player timestamps",
          "unsafe-mindmap-link",
          400,
        )
      }
    }
  }
}

export class SummaryOperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 404 | 409 | 500,
  ) {
    super(message)
  }
}

export class SummaryService {
  constructor(
    private readonly jobs: JobRepository,
    private readonly db: AppDatabase,
  ) {}

  private ensureJob(videoId: string) {
    try {
      const job = this.jobs.summarize(videoId)
      if (!job.watchable) throw new Error("video is not watchable")
      return this.jobs.jobDirectory(videoId)
    } catch {
      throw new SummaryOperationError("video job not found", "resource-not-found", 404)
    }
  }

  private artifactDirectory(videoId: string, artifactId: string) {
    if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
      throw new SummaryOperationError("invalid summary artifact ID", "invalid-artifact", 400)
    }
    return path.join(this.jobs.jobDirectory(videoId), "summaries", artifactId)
  }

  private artifactRows(videoId: string) {
    return this.db
      .select()
      .from(summaryArtifacts)
      .where(eq(summaryArtifacts.videoId, videoId))
      .all()
  }

  catalog(videoId: string): SummaryCatalogResponse {
    this.ensureJob(videoId)
    const activeRows = this.db
      .select()
      .from(activeSummaryArtifacts)
      .where(eq(activeSummaryArtifacts.videoId, videoId))
      .all()
    const active = new Map(activeRows.map((row) => [row.kind, row.artifactId]))
    const dependencies = this.db
      .select()
      .from(summaryDependencies)
      .all()
      .reduce((map, dependency) => {
        const list = map.get(dependency.artifactId) ?? []
        list.push({
          type: dependency.dependencyType as "subtitle" | "summary",
          id: dependency.dependencyId,
        })
        map.set(dependency.artifactId, list)
        return map
      }, new Map<string, Array<{ type: "subtitle" | "summary"; id: string }>>())
    const artifacts = this.artifactRows(videoId)
      .map((row) => ({
        id: row.id,
        videoId: row.videoId,
        kind: row.kind as SummaryArtifactKind,
        revision: row.revision,
        languageCode: row.languageCode,
        title: row.title,
        processor: { provider: "agent" as const, service: "codex" as const },
        checksum: row.checksum,
        validationState: "valid" as const,
        createdAt: row.createdAt,
        active: active.get(row.kind) === row.id,
        dependencies: dependencies.get(row.id) ?? [],
      }))
      .sort((left, right) => right.revision - left.revision)
    return {
      schemaVersion: 1,
      videoId,
      artifacts,
      activeArtifactIds: Object.fromEntries(active) as SummaryCatalogResponse["activeArtifactIds"],
    }
  }

  artifact(videoId: string, artifactId: string): SummaryArtifactResponse {
    const catalog = this.catalog(videoId)
    const artifact = catalog.artifacts.find((candidate) => candidate.id === artifactId)
    if (!artifact) {
      throw new SummaryOperationError("summary artifact not found", "resource-not-found", 404)
    }
    const row = this.db
      .select()
      .from(summaryArtifacts)
      .where(
        and(
          eq(summaryArtifacts.videoId, videoId),
          eq(summaryArtifacts.id, artifactId),
        ),
      )
      .get()!
    const candidate = path.join(this.jobs.jobDirectory(videoId), row.relativePath)
    const root = this.artifactDirectory(videoId, artifactId)
    if (
      !candidate.startsWith(`${root}${path.sep}`) ||
      !existsSync(candidate) ||
      lstatSync(candidate).isSymbolicLink() ||
      !lstatSync(candidate).isFile()
    ) {
      throw new SummaryOperationError("summary content is unavailable", "artifact-unavailable", 409)
    }
    const content = readFileSync(candidate, "utf8")
    if (!CHECKSUM_PATTERN.test(row.checksum) || checksum(content) !== row.checksum) {
      throw new SummaryOperationError("summary checksum mismatch", "artifact-invalid", 409)
    }
    return { artifact, content }
  }

  import(videoId: string, request: SummaryImportRequest) {
    const jobDirectory = this.ensureJob(videoId)
    const languageCode = safeText(request.languageCode, "languageCode", 40)
    if (!LANGUAGE_PATTERN.test(languageCode)) {
      throw new SummaryOperationError("languageCode is invalid", "invalid-summary", 400)
    }
    const title = safeText(request.title, "title", 160)
    const content = safeText(request.content, "content", MAX_CONTENT_BYTES)
    if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) {
      throw new SummaryOperationError("summary content is too large", "invalid-summary", 400)
    }
    if (request.kind === "mindmap") validateMindmap(content, videoId)
    if (request.kind === "text") {
      if (!request.sourceSubtitleArtifactId || request.sourceSummaryArtifactId) {
        throw new SummaryOperationError(
          "text summaries require one subtitle source",
          "invalid-dependency",
          400,
        )
      }
      const subtitle = this.jobs
        .subtitleCatalog(videoId)
        .artifacts.find((artifact) => artifact.id === request.sourceSubtitleArtifactId)
      if (
        !subtitle ||
        !["proofread", "translation"].includes(subtitle.kind) ||
        subtitle.lifecycleState !== "ready" ||
        subtitle.validationState !== "valid"
      ) {
        throw new SummaryOperationError(
          "summary source must be a validated complete-sentence subtitle",
          "invalid-dependency",
          409,
        )
      }
    } else {
      if (!request.sourceSummaryArtifactId || request.sourceSubtitleArtifactId) {
        throw new SummaryOperationError(
          "mind maps require one text summary source",
          "invalid-dependency",
          400,
        )
      }
      const source = this.db
        .select()
        .from(summaryArtifacts)
        .where(eq(summaryArtifacts.id, request.sourceSummaryArtifactId))
        .get()
      if (
        !source ||
        source.videoId !== videoId ||
        source.kind !== "text" ||
        source.validationState !== "valid"
      ) {
        throw new SummaryOperationError(
          "mind map source must be a text summary for this video",
          "invalid-dependency",
          409,
        )
      }
    }
    const revision =
      Math.max(
        0,
        ...this.artifactRows(videoId)
          .filter((artifact) => artifact.kind === request.kind && artifact.languageCode === languageCode)
          .map((artifact) => artifact.revision),
      ) + 1
    const artifactId = `${videoId}-${request.kind}-${languageCode}-r${revision}`
    const directory = path.join(jobDirectory, "summaries", artifactId)
    if (existsSync(directory)) {
      throw new SummaryOperationError("summary artifact already exists", "artifact-exists", 409)
    }
    mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 })
    mkdirSync(directory, { recursive: false, mode: 0o700 })
    const contentName = request.kind === "text" ? "summary.md" : "mindmap.md"
    const contentPath = path.join(directory, contentName)
    const digest = checksum(content)
    try {
      const temporary = path.join(directory, `.${contentName}.tmp`)
      writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 })
      renameSync(temporary, contentPath)
      writeFileSync(
        path.join(directory, "manifest.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          artifactId,
          videoId,
          kind: request.kind,
          revision,
          languageCode,
          title,
          processor: { provider: "agent", service: "codex" },
          checksum: digest,
          validationState: "valid",
          sourceSubtitleArtifactId: request.sourceSubtitleArtifactId ?? null,
          sourceSummaryArtifactId: request.sourceSummaryArtifactId ?? null,
          createdAt: now(),
        }, null, 2)}\n`,
        { encoding: "utf8", mode: 0o600 },
      )
      chmodSync(directory, 0o700)
      const createdAt = now()
      this.db.transaction((transaction) => {
        transaction
          .insert(summaryArtifacts)
          .values({
            id: artifactId,
            videoId,
            kind: request.kind,
            revision,
            languageCode,
            title,
            processorProvider: "agent",
            processorService: "codex",
            relativePath: path.relative(jobDirectory, contentPath),
            checksum: digest,
            validationState: "valid",
            createdAt,
          })
          .run()
        transaction
          .insert(summaryDependencies)
          .values({
            artifactId,
            dependencyType: request.kind === "text" ? "subtitle" : "summary",
            dependencyId:
              request.sourceSubtitleArtifactId ?? request.sourceSummaryArtifactId!,
          })
          .run()
      })
    } catch (error) {
      rmSync(directory, { recursive: true, force: true })
      throw error
    }
    return this.activate(videoId, request.kind, artifactId)
  }

  activate(videoId: string, kind: SummaryArtifactKind, artifactId: string) {
    const artifact = this.db
      .select()
      .from(summaryArtifacts)
      .where(eq(summaryArtifacts.id, artifactId))
      .get()
    if (!artifact || artifact.videoId !== videoId || artifact.kind !== kind) {
      throw new SummaryOperationError("summary artifact not found", "resource-not-found", 404)
    }
    this.db
      .insert(activeSummaryArtifacts)
      .values({ videoId, kind, artifactId, activatedAt: now() })
      .onConflictDoUpdate({
        target: [activeSummaryArtifacts.videoId, activeSummaryArtifacts.kind],
        set: { artifactId, activatedAt: now() },
      })
      .run()
    return this.catalog(videoId)
  }

}
