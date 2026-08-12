import { createHash } from "node:crypto"
import { readFileSync, statSync } from "node:fs"
import path from "node:path"

import subtitleManifestContract from "../../../plugins/insu-player/contracts/subtitle-manifest-contract.json"
import { safeContainedFile } from "@server/lib/files"
import {
  SUBTITLE_ARTIFACT_KINDS,
  SUBTITLE_ARTIFACT_PROVIDERS,
  SUBTITLE_DEPENDENCY_RELATIONS,
  SUBTITLE_SOURCE_TYPES,
  SUBTITLE_TIMING_UNIT_KINDS,
  SUBTITLE_TRACK_ROLES,
  type ActiveSubtitleTrack,
  type SubtitleArtifact,
  type SubtitleArtifactDependency,
  type SubtitleArtifactKind,
  type SubtitleArtifactProcessor,
  type SubtitleArtifactTrack,
  type SubtitleCatalogResponse,
  type SubtitleFreshnessState,
  type SubtitleLifecycleState,
  type SubtitlePlaybackLanguage,
  type SubtitleSourceType,
  type SubtitleTrackRole,
  type SubtitleValidationState,
} from "@shared/contracts/subtitle-catalog"
import { parseWebVtt } from "@shared/domain/subtitle"

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/
const LANGUAGE_PATTERN = /^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|und)$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const TIMING_PROCESSOR_CONTRACTS = {
  local: { service: "openai-whisper", models: null },
  openai: { service: "audio/transcriptions", models: new Set(["whisper-1"]) },
  groq: {
    service: "audio/transcriptions",
    models: new Set(["whisper-large-v3", "whisper-large-v3-turbo"]),
  },
  elevenlabs: { service: "speech-to-text", models: new Set(["scribe_v2"]) },
  xai: { service: "v1/stt", models: new Set<string>() },
  openrouter: {
    service: "audio/transcriptions",
    models: new Set(["openai/whisper-large-v3"]),
  },
} as const
const PLAYBACK_ROLES = new Set<SubtitleTrackRole>([
  "source_raw",
  "output_sentence",
  "output_segmented",
])
const ARTIFACT_FIELDS = new Set([
  "id",
  "kind",
  "revision",
  "lifecycleState",
  "validationState",
  "freshnessState",
  "sourceLanguage",
  "outputLanguage",
  "sourceType",
  "processor",
  "timingUnitKind",
  "targetFrozen",
  "manifestPath",
  "checksum",
  "warningCount",
  "hardDefectCount",
  "dependencies",
  "tracks",
  "createdAt",
  "completedAt",
])
const TRACK_FIELDS = new Set([
  "id",
  "languageCode",
  "role",
  "state",
  "path",
  "checksum",
  "updatedAt",
  "bytes",
])
const REQUIRED_TRACK_FIELDS = [...TRACK_FIELDS].filter((field) => field !== "bytes")
const CONTENT_MANIFEST_FIELDS = new Set(subtitleManifestContract.content.fields)
const SEGMENTATION_MANIFEST_FIELDS = new Set(
  subtitleManifestContract.segmentation.fields,
)
const AGENT_PROCESSOR_FIELDS = new Set(
  subtitleManifestContract.agentProcessor.fields,
)

export class SubtitleCatalogContractError extends Error {
  readonly code = "subtitle-schema-incompatible"

  constructor(message: string) {
    super(message)
    this.name = "SubtitleCatalogContractError"
  }
}

interface ResolvedSubtitleArtifactTrack extends SubtitleArtifactTrack {
  relativePath: string
  absolutePath: string
}

interface ResolvedSubtitleArtifact extends Omit<SubtitleArtifact, "tracks"> {
  manifestPath: string | null
  tracks: ResolvedSubtitleArtifactTrack[]
}

interface SubtitleCandidate {
  artifact: ResolvedSubtitleArtifact
  track: ResolvedSubtitleArtifactTrack
}

export interface ResolvedSubtitleCatalog {
  videoId: string
  artifacts: ResolvedSubtitleArtifact[]
  activeTracks: Array<
    ActiveSubtitleTrack & { absolutePath: string; relativePath: string }
  >
  playbackLanguages: SubtitlePlaybackLanguage[]
  availableLanguageCodes: string[]
}

export interface SubtitleCatalogInput {
  videoId: string
  jobDirectory: string
  rawArtifacts: unknown
  explicitActiveTracks: unknown
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function requiredString(value: unknown, label: string) {
  const resolved = stringValue(value)
  if (!resolved) throw new Error(`${label} must be non-empty text`)
  return resolved
}

function requiredPositiveInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

function requiredCount(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return value
}

function requiredBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`)
  return value
}

function requiredEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
) {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} is unsupported`)
  }
  return value as T
}

function requiredLanguage(value: unknown, label: string) {
  const language = requiredString(value, label)
  if (!LANGUAGE_PATTERN.test(language)) {
    throw new Error(`${label} must be a BCP 47 language code`)
  }
  return language
}

function requiredTimestamp(value: unknown, label: string) {
  const timestamp = requiredString(value, label)
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} must be a timestamp`)
  }
  return timestamp
}

function resolvedProcessor(
  value: unknown,
  label: string,
): SubtitleArtifactProcessor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const candidate = value as Record<string, unknown>
  if (
    Object.keys(candidate).some(
      (key) => !["provider", "service", "model"].includes(key),
    )
  ) {
    throw new Error(`${label} contains unsupported fields`)
  }
  const provider = requiredEnum(
    candidate.provider,
    SUBTITLE_ARTIFACT_PROVIDERS,
    `${label}.provider`,
  )
  if (provider === "agent") {
    if (
      Object.keys(candidate).length !== 2 ||
      candidate.service !== "codex" ||
      "model" in candidate
    ) {
      throw new Error(`${label} must use agent / codex`)
    }
    return { provider, service: "codex" }
  }
  if (provider === "yt-dlp") {
    if (Object.keys(candidate).length !== 1) {
      throw new Error(`${label} yt-dlp identity contains unsupported fields`)
    }
    return { provider }
  }
  if (!["provider", "service", "model"].every((key) => key in candidate)) {
    throw new Error(`${label} timing identity is incomplete`)
  }
  const contract = TIMING_PROCESSOR_CONTRACTS[provider]
  const model = candidate.model
  if (candidate.service !== contract.service) {
    throw new Error(`${label} service does not match ${provider}`)
  }
  if (provider === "xai") {
    if (model !== null) throw new Error(`${label} xAI model must be null`)
  } else if (typeof model !== "string" || !model.trim()) {
    throw new Error(`${label} model is required`)
  } else if (provider === "openrouter") {
    if (model !== "openai/whisper-large-v3") {
      throw new Error(`${label} OpenRouter model is invalid`)
    }
  } else if (contract.models) {
    if (!(contract.models as ReadonlySet<string>).has(model)) {
      throw new Error(`${label} model is unsupported`)
    }
  } else if (!/^[A-Za-z0-9._-]+$/.test(model)) {
    throw new Error(`${label} model is invalid`)
  }
  return { provider, service: contract.service, model: model as string | null }
}

function checksum(contents: string) {
  return createHash("sha256").update(contents).digest("hex")
}

function isCompletedAgentProcessor(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    Object.keys(candidate).length === AGENT_PROCESSOR_FIELDS.size &&
    Object.keys(candidate).every((key) => AGENT_PROCESSOR_FIELDS.has(key)) &&
    candidate.provider === subtitleManifestContract.agentProcessor.provider &&
    candidate.service === subtitleManifestContract.agentProcessor.service &&
    typeof candidate.updatedAt === "string" &&
    Number.isFinite(Date.parse(candidate.updatedAt))
  )
}

function validateManifestSchema(
  manifestPath: string,
  kind: SubtitleArtifactKind,
  artifactId: string,
) {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  } catch {
    throw new SubtitleCatalogContractError(
      `${artifactId}.manifestPath is not valid JSON`,
    )
  }
  const expectedVersion =
    kind === "segmentation"
      ? subtitleManifestContract.segmentation.schemaVersion
      : subtitleManifestContract.content.schemaVersion
  const record = manifest as Record<string, unknown>
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    record.schemaVersion !== expectedVersion
  ) {
    throw new SubtitleCatalogContractError(
      `${artifactId}.manifestPath must use schemaVersion ${expectedVersion}`,
    )
  }
  const expectedFields =
    kind === "segmentation"
      ? SEGMENTATION_MANIFEST_FIELDS
      : CONTENT_MANIFEST_FIELDS
  if (
    Object.keys(record).length !== expectedFields.size ||
    Object.keys(record).some((key) => !expectedFields.has(key))
  ) {
    throw new SubtitleCatalogContractError(
      `${artifactId}.manifestPath fields do not match the current schema`,
    )
  }
  if (kind === "segmentation") {
    if (
      record.targetFrozen !== true ||
      typeof record.targetFrozenAt !== "string" ||
      !Number.isFinite(Date.parse(record.targetFrozenAt)) ||
      record.alignmentMethod !== "agent-semantic" ||
      !isCompletedAgentProcessor(record.contentProcessor) ||
      !isCompletedAgentProcessor(record.segmentationProcessor)
    ) {
      throw new SubtitleCatalogContractError(
        `${artifactId}.manifestPath is not a completed Agent segmentation`,
      )
    }
  } else if (
    record.mode !== (kind === "translation" ? "translate" : "proofread") ||
    !isCompletedAgentProcessor(record.contentProcessor)
  ) {
    throw new SubtitleCatalogContractError(
      `${artifactId}.manifestPath is not completed Agent content`,
    )
  }
}

function resolvedTrack(
  jobDirectory: string,
  artifactId: string,
  raw: Record<string, unknown>,
): ResolvedSubtitleArtifactTrack {
  const id = requiredString(raw.id, `${artifactId}.track.id`)
  const languageCode = requiredLanguage(
    raw.languageCode,
    `${artifactId}.${id}.languageCode`,
  )
  const relativePath = requiredString(raw.path, `${artifactId}.${id}.path`)
  if (!IDENTIFIER_PATTERN.test(id)) {
    throw new Error(`invalid subtitle track ID: ${id}`)
  }
  const artifactRoot = `subtitle-work/artifacts/${artifactId}/`
  if (!relativePath.startsWith(artifactRoot)) {
    throw new Error(`subtitle track must stay inside ${artifactRoot}`)
  }
  const absolutePath = safeContainedFile(
    jobDirectory,
    path.join(jobDirectory, relativePath),
  )
  if (!absolutePath) {
    throw new Error(`subtitle track is unavailable: ${relativePath}`)
  }
  let contents: string
  let cueCount: number
  try {
    contents = readFileSync(absolutePath, "utf8")
    cueCount = parseWebVtt(contents).length
  } catch {
    throw new Error(`subtitle track is not valid WebVTT: ${relativePath}`)
  }
  const actualChecksum = checksum(contents)
  if (stringValue(raw.checksum) !== actualChecksum) {
    throw new Error(`subtitle track checksum mismatch: ${relativePath}`)
  }
  const role = requiredEnum(
    raw.role,
    SUBTITLE_TRACK_ROLES,
    `${artifactId}.${id}.role`,
  )
  const metadata = statSync(absolutePath)
  return {
    id,
    artifactId,
    languageCode,
    role,
    state: requiredString(raw.state, `${artifactId}.${id}.state`),
    playbackEligible: PLAYBACK_ROLES.has(role),
    relativePath,
    absolutePath,
    sizeBytes: metadata.size,
    cueCount,
    checksum: actualChecksum,
    updatedAt: requiredTimestamp(raw.updatedAt, `${artifactId}.${id}.updatedAt`),
  }
}

function dependencies(value: unknown, artifactId: string) {
  if (!Array.isArray(value)) {
    throw new Error(`${artifactId}.dependencies must be an array`)
  }
  const seen = new Set<string>()
  return value.map((raw): SubtitleArtifactDependency => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`${artifactId}.dependency must be an object`)
    }
    const candidate = raw as Record<string, unknown>
    if (
      Object.keys(candidate).some(
        (key) => !["artifactId", "relation"].includes(key),
      ) ||
      !("artifactId" in candidate) ||
      !("relation" in candidate)
    ) {
      throw new Error(`${artifactId}.dependency fields are invalid`)
    }
    const dependency = {
      artifactId: requiredString(
        candidate.artifactId,
        `${artifactId}.dependency.artifactId`,
      ),
      relation: requiredEnum(
        candidate.relation,
        SUBTITLE_DEPENDENCY_RELATIONS,
        `${artifactId}.dependency.relation`,
      ),
    }
    if (!IDENTIFIER_PATTERN.test(dependency.artifactId)) {
      throw new Error(`invalid subtitle dependency ID: ${dependency.artifactId}`)
    }
    const key = `${dependency.relation}:${dependency.artifactId}`
    if (seen.has(key)) throw new Error(`${artifactId} has a duplicate dependency`)
    seen.add(key)
    return dependency
  })
}

function expectedRoles(kind: SubtitleArtifactKind): SubtitleTrackRole[] {
  if (kind === "source") return ["source_raw"]
  if (kind === "segmentation") {
    return ["input_segmented", "output_segmented"]
  }
  return ["input_sentence", "output_sentence"]
}

function validateTrackContract(artifact: ResolvedSubtitleArtifact) {
  const expected = expectedRoles(artifact.kind)
  const expectedSet = new Set(expected)
  const byRole = new Map(artifact.tracks.map((track) => [track.role, track]))
  if (artifact.lifecycleState === "ready") {
    const actual = [...byRole.keys()].sort()
    const required = [...expected].sort()
    if (
      artifact.tracks.length !== required.length ||
      actual.some((role, index) => role !== required[index])
    ) {
      throw new Error(
        `${artifact.id}.tracks do not match the ${artifact.kind} artifact contract`,
      )
    }
  }
  for (const track of artifact.tracks) {
    if (!expectedSet.has(track.role)) {
      throw new Error(`${artifact.id}.${track.role} is not valid for its kind`)
    }
    const expectedLanguage =
      track.role === "source_raw" || track.role.startsWith("input_")
        ? artifact.sourceLanguage
        : artifact.outputLanguage
    if (track.languageCode !== expectedLanguage) {
      throw new Error(`${artifact.id}.${track.role} language does not match`)
    }
  }
}

function registeredArtifacts(input: SubtitleCatalogInput) {
  if (!Array.isArray(input.rawArtifacts)) {
    throw new Error("media item record must contain subtitleArtifacts")
  }
  const artifactIds = new Set<string>()
  const trackIds = new Set<string>()
  const artifacts = input.rawArtifacts.map((raw): ResolvedSubtitleArtifact => {
    if (!raw || typeof raw !== "object") {
      throw new Error("subtitle artifact must be an object")
    }
    const candidate = raw as Record<string, unknown>
    if (
      Object.keys(candidate).some((key) => !ARTIFACT_FIELDS.has(key)) ||
      [...ARTIFACT_FIELDS].some((key) => !(key in candidate))
    ) {
      throw new Error("subtitle artifact fields do not match the current schema")
    }
    const id = requiredString(candidate.id, "subtitle artifact id")
    if (!IDENTIFIER_PATTERN.test(id) || artifactIds.has(id)) {
      throw new Error(`invalid or duplicate subtitle artifact ID: ${id}`)
    }
    artifactIds.add(id)
    const kind = requiredEnum(
      candidate.kind,
      SUBTITLE_ARTIFACT_KINDS,
      `${id}.kind`,
    )
    const processor = resolvedProcessor(candidate.processor, `${id}.processor`)
    const lifecycleState = requiredEnum<SubtitleLifecycleState>(
      candidate.lifecycleState,
      ["draft", "processing", "ready", "failed", "archived"],
      `${id}.lifecycleState`,
    )
    let validationState = requiredEnum<SubtitleValidationState>(
      candidate.validationState,
      ["pending", "valid", "warning", "invalid"],
      `${id}.validationState`,
    )
    const freshnessState = requiredEnum<SubtitleFreshnessState>(
      candidate.freshnessState,
      ["current", "stale", "superseded"],
      `${id}.freshnessState`,
    )
    const sourceLanguage = requiredLanguage(
      candidate.sourceLanguage,
      `${id}.sourceLanguage`,
    )
    const outputLanguage =
      kind === "source"
        ? null
        : requiredLanguage(candidate.outputLanguage, `${id}.outputLanguage`)
    if (kind === "source" && stringValue(candidate.outputLanguage)) {
      throw new Error(`${id}.outputLanguage must be null for a source artifact`)
    }
    if (kind === "proofread" && outputLanguage !== sourceLanguage) {
      throw new Error(`${id} proofreading must preserve the source language`)
    }
    if (kind === "translation" && outputLanguage === sourceLanguage) {
      throw new Error(`${id} translation output must use another language`)
    }
    const sourceType =
      kind === "source"
        ? requiredEnum(
            candidate.sourceType,
            SUBTITLE_SOURCE_TYPES,
            `${id}.sourceType`,
          )
        : null
    if (kind !== "source" && stringValue(candidate.sourceType)) {
      throw new Error(`${id}.sourceType is only allowed on source artifacts`)
    }
    const timingUnitKind =
      candidate.timingUnitKind === null || candidate.timingUnitKind === undefined
        ? null
        : requiredEnum(
            candidate.timingUnitKind,
            SUBTITLE_TIMING_UNIT_KINDS,
            `${id}.timingUnitKind`,
          )
    if (kind === "source" && sourceType === "manual-cc") {
      if (
        processor.provider !== "yt-dlp" ||
        processor.model ||
        timingUnitKind !== "cue"
      ) {
        throw new Error(`${id} manual CC must use yt-dlp cue timing`)
      }
    } else if (kind === "source") {
      if (
        !(processor.provider in TIMING_PROCESSOR_CONTRACTS)
      ) {
        throw new Error(`${id} model transcripts require a timing processor`)
      }
      if (!timingUnitKind || timingUnitKind === "cue") {
        throw new Error(`${id} model transcripts require fine-grained timing`)
      }
    } else if (processor.provider === "yt-dlp") {
      throw new Error(`${id} subtitle revisions cannot use yt-dlp as a processor`)
    } else if (
      processor.provider !== "agent" ||
      processor.service !== "codex" ||
      processor.model
    ) {
      throw new Error(`${id} subtitle revisions must use agent / codex`)
    }
    if (!Array.isArray(candidate.tracks)) {
      throw new Error(`${id}.tracks must be an array`)
    }
    const tracks = candidate.tracks.map((track) => {
      if (!track || typeof track !== "object") {
        throw new Error(`${id}.track must be an object`)
      }
      const rawTrack = track as Record<string, unknown>
      if (
        Object.keys(rawTrack).some((key) => !TRACK_FIELDS.has(key)) ||
        REQUIRED_TRACK_FIELDS.some((key) => !(key in rawTrack))
      ) {
        throw new Error(`${id}.track fields do not match the current schema`)
      }
      const resolved = resolvedTrack(
        input.jobDirectory,
        id,
        rawTrack,
      )
      if (trackIds.has(resolved.id)) {
        throw new Error(`duplicate subtitle track ID: ${resolved.id}`)
      }
      trackIds.add(resolved.id)
      return resolved
    })
    const manifestRelativePath = stringValue(candidate.manifestPath)
    if (
      manifestRelativePath &&
      !manifestRelativePath.startsWith(`subtitle-work/artifacts/${id}/`)
    ) {
      throw new Error(`${id}.manifestPath must stay inside its artifact directory`)
    }
    const manifestPath = manifestRelativePath
      ? safeContainedFile(
          input.jobDirectory,
          path.join(input.jobDirectory, manifestRelativePath),
        )
      : null
    if (manifestRelativePath && !manifestPath) {
      throw new Error(`${id}.manifestPath is unavailable`)
    }
    if (kind === "source" && manifestPath) {
      throw new Error(`${id}.manifestPath is not allowed for source artifacts`)
    }
    if (kind !== "source" && !manifestPath) {
      throw new Error(`${id}.manifestPath is required`)
    }
    let schemaError: string | null = null
    if (manifestPath) {
      try {
        validateManifestSchema(manifestPath, kind, id)
      } catch (error) {
        if (
          freshnessState !== "superseded" ||
          !(error instanceof SubtitleCatalogContractError)
        ) {
          throw error
        }
        schemaError = error.message
        validationState = "invalid"
      }
    }
    const targetFrozen = requiredBoolean(candidate.targetFrozen, `${id}.targetFrozen`)
    if ((kind === "segmentation") !== targetFrozen) {
      throw new Error(`${id}.targetFrozen does not match the artifact kind`)
    }
    const registeredArtifactChecksum = requiredString(
      candidate.checksum,
      `${id}.checksum`,
    )
    if (!SHA256_PATTERN.test(registeredArtifactChecksum)) {
      throw new Error(`${id}.checksum must be a lowercase SHA-256 value`)
    }
    const artifactHasher = createHash("sha256")
    for (const track of tracks) {
      artifactHasher.update(track.languageCode, "utf8")
      artifactHasher.update(track.checksum, "ascii")
    }
    if (manifestPath) {
      artifactHasher.update(
        createHash("sha256").update(readFileSync(manifestPath)).digest(),
      )
    }
    if (artifactHasher.digest("hex") !== registeredArtifactChecksum) {
      throw new Error(`${id}.checksum does not match its registered files`)
    }
    const artifact: ResolvedSubtitleArtifact = {
      id,
      kind,
      revision: requiredPositiveInteger(candidate.revision, `${id}.revision`),
      lifecycleState,
      validationState,
      freshnessState,
      sourceLanguage,
      outputLanguage,
      sourceType,
      processor,
      timingUnitKind,
      targetFrozen,
      manifestPath,
      manifestAvailable: Boolean(manifestPath),
      schemaError,
      checksum: registeredArtifactChecksum,
      warningCount: requiredCount(candidate.warningCount, `${id}.warningCount`),
      hardDefectCount: requiredCount(
        candidate.hardDefectCount,
        `${id}.hardDefectCount`,
      ),
      dependencies: dependencies(candidate.dependencies, id),
      tracks,
      createdAt: requiredTimestamp(candidate.createdAt, `${id}.createdAt`),
      completedAt:
        lifecycleState === "ready"
          ? requiredTimestamp(candidate.completedAt, `${id}.completedAt`)
          : candidate.completedAt === null
            ? null
            : requiredTimestamp(candidate.completedAt, `${id}.completedAt`),
    }
    validateTrackContract(artifact)
    return artifact
  })

  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  for (const artifact of artifacts) validateDependencies(artifact, byId)
  return artifacts
}

function related(
  artifact: ResolvedSubtitleArtifact,
  relation: SubtitleArtifactDependency["relation"],
  byId: Map<string, ResolvedSubtitleArtifact>,
) {
  return artifact.dependencies.flatMap((dependency) => {
    if (dependency.relation !== relation) return []
      const parent = byId.get(dependency.artifactId)
      if (!parent) throw new Error(`${artifact.id} references a missing dependency`)
      return [parent]
    })
}

function validateDependencies(
  artifact: ResolvedSubtitleArtifact,
  byId: Map<string, ResolvedSubtitleArtifact>,
) {
  if (artifact.kind === "source") {
    if (artifact.dependencies.length !== 0) {
      throw new Error(`${artifact.id} source artifacts cannot have dependencies`)
    }
    return
  }
  const timingSources = related(artifact, "timing-source", byId)
  const contentSources = related(artifact, "content-source", byId)
  const references = related(artifact, "text-reference", byId)
  const contentParents = related(artifact, "content-parent", byId)
  if (
    timingSources.length !== 1 ||
    timingSources[0]?.kind !== "source" ||
    timingSources[0]?.sourceType !== "model-transcript" ||
    timingSources[0]?.sourceLanguage !== artifact.sourceLanguage
  ) {
    throw new Error(`${artifact.id} requires one model transcript timing source`)
  }
  if (
    references.some(
      (reference) =>
        reference.kind !== "source" ||
        reference.sourceType !== "manual-cc" ||
        reference.sourceLanguage !== artifact.sourceLanguage,
    )
  ) {
    throw new Error(`${artifact.id} text references must be same-language manual CC`)
  }
  if (artifact.kind === "proofread" || artifact.kind === "translation") {
    if (contentParents.length !== 0 || contentSources.length !== 1) {
      throw new Error(
        `${artifact.id} content revisions require one content source and no content parent`,
      )
    }
    const contentSource = contentSources[0]
    if (
      artifact.kind === "proofread" &&
      contentSource?.id !== timingSources[0]?.id
    ) {
      throw new Error(`${artifact.id} proofread content source must be its model transcript`)
    }
    if (artifact.kind === "translation") {
      if (
        contentSource?.kind !== "proofread" ||
          contentSource.sourceLanguage !== artifact.sourceLanguage ||
          contentSource.outputLanguage !== artifact.sourceLanguage
      ) {
        throw new Error(`${artifact.id} translation requires matching proofread content`)
      }
      if (references.length !== 0) {
        throw new Error(`${artifact.id} inherits references from proofreading`)
      }
    }
    return
  }
  if (
    contentSources.length !== 0 ||
    references.length !== 0 ||
    contentParents.length !== 1
  ) {
    throw new Error(`${artifact.id} segmentation requires one content parent`)
  }
  const contentParent = contentParents[0]
  if (
    (contentParent?.kind !== "proofread" &&
      contentParent?.kind !== "translation") ||
    contentParent.sourceLanguage !== artifact.sourceLanguage ||
    contentParent.outputLanguage !== artifact.outputLanguage
  ) {
    throw new Error(`${artifact.id} content parent languages do not match`)
  }
}

function resolverEligible(artifact: ResolvedSubtitleArtifact) {
  return (
    artifact.lifecycleState === "ready" &&
    artifact.validationState !== "invalid" &&
    artifact.hardDefectCount === 0
  )
}

function playbackCandidates(artifacts: ResolvedSubtitleArtifact[]) {
  return artifacts.flatMap((artifact): SubtitleCandidate[] =>
    resolverEligible(artifact)
      ? artifact.tracks.flatMap((track) =>
          track.playbackEligible && track.state === "ready" && track.cueCount > 0
            ? [{ artifact, track }]
            : [],
        )
      : [],
  )
}

function trackPriority({ artifact, track }: SubtitleCandidate) {
  const roleScore =
    track.role === "output_segmented"
      ? 400
      : track.role === "output_sentence"
        ? 300
        : artifact.sourceType === "manual-cc"
          ? 200
          : 100
  const freshnessScore: Record<SubtitleFreshnessState, number> = {
    current: 30,
    stale: 10,
    superseded: 0,
  }
  return (
    roleScore * 1_000_000 +
    freshnessScore[artifact.freshnessState] * 10_000 +
    artifact.revision
  )
}

function sortedCandidates(candidates: SubtitleCandidate[]) {
  return [...candidates].sort(
    (left, right) => trackPriority(right) - trackPriority(left),
  )
}

function resolveActiveTracks(
  candidates: SubtitleCandidate[],
  explicit: unknown,
) {
  if (!explicit || typeof explicit !== "object" || Array.isArray(explicit)) {
    throw new Error("media item record must contain activeSubtitleTracks")
  }
  const explicitMap = explicit as Record<string, unknown>
  for (const [languageCode, trackId] of Object.entries(explicitMap)) {
    if (!LANGUAGE_PATTERN.test(languageCode) || !stringValue(trackId)) {
      throw new Error("activeSubtitleTracks must map language codes to track IDs")
    }
  }
  const languages = [...new Set(candidates.map(({ track }) => track.languageCode))]
    .sort((left, right) => left.localeCompare(right))
  return languages.flatMap((languageCode) => {
    const options = sortedCandidates(
      candidates.filter(({ track }) => track.languageCode === languageCode),
    )
    const explicitTrackId = stringValue(explicitMap[languageCode])
    const explicitlySelected = explicitTrackId
      ? options.find(({ track }) => track.id === explicitTrackId)
      : null
    const selected = explicitlySelected ?? options[0]
    if (!selected) return []
    return [
      {
        ...selected.track,
        artifactKind: selected.artifact.kind,
        sourceType: selected.artifact.sourceType,
        revision: selected.artifact.revision,
        active: true as const,
        reason: explicitlySelected ? ("explicit" as const) : ("resolver" as const),
      },
    ]
  })
}

function publicTrack(track: ResolvedSubtitleArtifactTrack): SubtitleArtifactTrack {
  return {
    id: track.id,
    artifactId: track.artifactId,
    languageCode: track.languageCode,
    role: track.role,
    state: track.state,
    playbackEligible: track.playbackEligible,
    sizeBytes: track.sizeBytes,
    cueCount: track.cueCount,
    checksum: track.checksum,
    updatedAt: track.updatedAt,
  }
}

function playbackLabel(candidate: SubtitleCandidate) {
  const { artifact, track } = candidate
  if (artifact.kind === "source") {
    const sourceLabel =
      artifact.sourceType === "manual-cc" ? "人工 CC" : "模型轉錄"
    return `${track.languageCode} · ${sourceLabel} · r${artifact.revision}`
  }
  const label =
    artifact.kind === "proofread"
      ? "校正字幕"
      : artifact.kind === "translation"
        ? "翻譯字幕"
        : "切分字幕"
  return `${track.languageCode} · ${label} · r${artifact.revision}`
}

function buildPlaybackLanguages(
  candidates: SubtitleCandidate[],
  activeTracks: ResolvedSubtitleCatalog["activeTracks"],
) {
  return activeTracks.map((active): SubtitlePlaybackLanguage => {
    const options = sortedCandidates(
      candidates.filter(({ track }) => track.languageCode === active.languageCode),
    ).map(({ artifact, track }) => ({
      ...publicTrack(track),
      artifactKind: artifact.kind,
      sourceType: artifact.sourceType,
      revision: artifact.revision,
      label: playbackLabel({ artifact, track }),
      active: track.id === active.id,
    }))
    return {
      languageCode: active.languageCode,
      activeTrackId: active.id,
      activeReason: active.reason,
      options,
    }
  })
}

export function resolveSubtitleCatalog(
  input: SubtitleCatalogInput,
): ResolvedSubtitleCatalog {
  const artifacts = registeredArtifacts(input)
  const candidates = playbackCandidates(artifacts)
  const activeTracks = resolveActiveTracks(candidates, input.explicitActiveTracks)
  return {
    videoId: input.videoId,
    artifacts,
    activeTracks,
    playbackLanguages: buildPlaybackLanguages(candidates, activeTracks),
    availableLanguageCodes: activeTracks.map((track) => track.languageCode),
  }
}

export function publicSubtitleCatalog(
  catalog: ResolvedSubtitleCatalog,
): SubtitleCatalogResponse {
  return {
    videoId: catalog.videoId,
    artifacts: catalog.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      revision: artifact.revision,
      lifecycleState: artifact.lifecycleState,
      validationState: artifact.validationState,
      freshnessState: artifact.freshnessState,
      sourceLanguage: artifact.sourceLanguage,
      outputLanguage: artifact.outputLanguage,
      sourceType: artifact.sourceType,
      processor: artifact.processor,
      timingUnitKind: artifact.timingUnitKind,
      targetFrozen: artifact.targetFrozen,
      manifestAvailable: artifact.manifestAvailable,
      schemaError: artifact.schemaError,
      checksum: artifact.checksum,
      warningCount: artifact.warningCount,
      hardDefectCount: artifact.hardDefectCount,
      dependencies: artifact.dependencies,
      tracks: artifact.tracks.map(publicTrack),
      createdAt: artifact.createdAt,
      completedAt: artifact.completedAt,
    })),
    activeTracks: catalog.activeTracks.map((track) => ({
      ...publicTrack(track),
      artifactKind: track.artifactKind,
      sourceType: track.sourceType,
      revision: track.revision,
      active: true,
      reason: track.reason,
    })),
    playbackLanguages: catalog.playbackLanguages,
    availableLanguageCodes: catalog.availableLanguageCodes,
  }
}

export function isSelectableSubtitleTrack(
  catalog: ResolvedSubtitleCatalog,
  languageCode: string,
  trackId: string,
) {
  return catalog.playbackLanguages.some(
    (language) =>
      language.languageCode === languageCode &&
      language.options.some((option) => option.id === trackId),
  )
}
