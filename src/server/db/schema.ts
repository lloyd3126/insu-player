import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

export const jobs = sqliteTable(
  "media_items",
  {
    videoId: text("video_id").primaryKey(),
    title: text("title").notNull(),
    sourceUrl: text("source_url").notNull().default(""),
    state: text("state").notNull(),
    effectiveState: text("effective_state").notNull(),
    stage: text("stage").notNull(),
    progress: real("progress").notNull().default(0),
    message: text("message").notNull().default(""),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
    completedAt: text("completed_at"),
    lastError: text("last_error"),
    watchable: integer("watchable", { mode: "boolean" }).notNull().default(false),
    sizeBytes: integer("size_bytes").notNull().default(0),
    thumbnailUrl: text("thumbnail_url"),
    watchUrl: text("watch_url"),
    hasLog: integer("has_log", { mode: "boolean" }).notNull().default(false),
    durationSeconds: real("duration_seconds"),
    recordJson: text("record_json", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    recordRevision: integer("record_revision").notNull().default(1),
    projectedAt: text("projected_at").notNull(),
  },
  (table) => [
    index("jobs_updated_at_idx").on(table.updatedAt),
    index("jobs_state_idx").on(table.effectiveState),
  ],
)

export const mediaSources = sqliteTable("media_sources", {
  id: text("id").primaryKey(),
  videoId: text("video_id")
    .notNull()
    .references(() => jobs.videoId, { onDelete: "cascade" }),
  sourceUrl: text("source_url").notNull(),
  sourceType: text("source_type").notNull(),
  externalId: text("external_id"),
  createdAt: text("created_at").notNull(),
})

export const operations = sqliteTable(
  "operations",
  {
    id: text("id").primaryKey(),
    videoId: text("video_id").references(() => jobs.videoId, {
      onDelete: "cascade",
    }),
    parentOperationId: text("parent_operation_id"),
    kind: text("kind").notNull(),
    state: text("state").notNull(),
    stage: text("stage").notNull(),
    progress: real("progress").notNull().default(0),
    message: text("message").notNull().default(""),
    processorProvider: text("processor_provider"),
    processorService: text("processor_service"),
    processorModel: text("processor_model"),
    inputsJson: text("inputs_json", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    outputsJson: text("outputs_json", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    consentJson: text("consent_json", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    resumable: integer("resumable", { mode: "boolean" })
      .notNull()
      .default(false),
    attempt: integer("attempt").notNull().default(1),
    pid: integer("pid"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("operations_video_idx").on(table.videoId, table.updatedAt),
    index("operations_state_idx").on(table.state, table.updatedAt),
  ],
)

export const operationEvents = sqliteTable(
  "operation_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    state: text("state").notNull(),
    stage: text("stage").notNull(),
    progress: real("progress").notNull().default(0),
    message: text("message").notNull().default(""),
    dataJson: text("data_json", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("operation_events_sequence_idx").on(
      table.operationId,
      table.sequence,
    ),
  ],
)

export const agentIntents = sqliteTable(
  "agent_intents",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    videoId: text("video_id").references(() => jobs.videoId, {
      onDelete: "cascade",
    }),
    state: text("state").notNull(),
    payloadJson: text("payload_json", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: text("created_at").notNull(),
    copiedAt: text("copied_at"),
    claimedAt: text("claimed_at"),
    completedAt: text("completed_at"),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("agent_intents_state_idx").on(table.state, table.expiresAt)],
)

export const runtimeCapabilities = sqliteTable("runtime_capabilities", {
  key: text("key").primaryKey(),
  state: text("state").notNull(),
  label: text("label").notNull(),
  detail: text("detail").notNull().default(""),
  version: text("version"),
  checkedAt: text("checked_at").notNull(),
})

export const jobHistory = sqliteTable(
  "job_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    videoId: text("video_id")
      .notNull()
      .references(() => jobs.videoId, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    at: text("at"),
    state: text("state"),
    stage: text("stage"),
    message: text("message"),
  },
  (table) => [index("job_history_video_idx").on(table.videoId, table.sequence)],
)

export const jobAssets = sqliteTable(
  "job_assets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    videoId: text("video_id")
      .notNull()
      .references(() => jobs.videoId, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    relativePath: text("relative_path").notNull(),
    sizeBytes: integer("size_bytes"),
    updatedAt: text("updated_at"),
    available: integer("available", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [index("job_assets_video_idx").on(table.videoId, table.kind)],
)

export const mediaRenditions = sqliteTable(
  "media_renditions",
  {
    id: text("id").notNull(),
    videoId: text("video_id")
      .notNull()
      .references(() => jobs.videoId, { onDelete: "cascade" }),
    requestedHeight: integer("requested_height").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    container: text("container").notNull(),
    videoCodec: text("video_codec"),
    audioCodec: text("audio_codec"),
    relativePath: text("relative_path").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksum: text("checksum").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.videoId, table.id] }),
    index("media_renditions_video_height_idx").on(
      table.videoId,
      table.height,
    ),
  ],
)

export const mediaDownloadRuns = sqliteTable(
  "media_download_runs",
  {
    id: text("id").notNull(),
    videoId: text("video_id")
      .notNull()
      .references(() => jobs.videoId, { onDelete: "cascade" }),
    requestedHeight: integer("requested_height"),
    state: text("state").notNull(),
    stage: text("stage").notNull(),
    progress: real("progress").notNull().default(0),
    message: text("message").notNull().default(""),
    error: text("error"),
    startedAt: text("started_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    primaryKey({ columns: [table.videoId, table.id] }),
    index("media_download_runs_video_idx").on(table.videoId),
  ],
)

export const downloadBatches = sqliteTable("download_batches", {
  id: text("id").primaryKey(),
  state: text("state").notNull(),
  rightsConfirmed: integer("rights_confirmed", { mode: "boolean" })
    .notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const downloadBatchItems = sqliteTable(
  "download_batch_items",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => downloadBatches.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    sourceKind: text("source_kind").notNull(),
    pageUrl: text("page_url").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceKey: text("source_key").notNull(),
    sessionId: text("session_id"),
    operationId: text("operation_id")
      .notNull()
      .references(() => operations.id, { onDelete: "cascade" }),
    videoId: text("video_id"),
    lowQualityApproved: integer("low_quality_approved", { mode: "boolean" })
      .notNull(),
    authentication: text("authentication").notNull(),
    authenticationConsentAt: text("authentication_consent_at"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    uniqueIndex("download_batch_item_source_idx").on(
      table.batchId,
      table.sourceKey,
    ),
    uniqueIndex("download_batch_item_operation_idx").on(table.operationId),
    index("download_batch_item_batch_idx").on(table.batchId, table.ordinal),
  ],
)

export const extensionPairings = sqliteTable("extension_pairings", {
  id: text("id").primaryKey(),
  extensionOrigin: text("extension_origin").notNull(),
  tokenHash: text("token_hash").notNull(),
  pairedAt: text("paired_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  revokedAt: text("revoked_at"),
})

export const localModelDownloadRuns = sqliteTable(
  "local_model_download_runs",
  {
    modelId: text("model_id").primaryKey(),
    state: text("state").notNull(),
    progress: real("progress").notNull(),
    downloadedBytes: integer("downloaded_bytes").notNull(),
    totalBytes: integer("total_bytes").notNull(),
    message: text("message").notNull(),
    errorCode: text("error_code"),
    startedAt: text("started_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [index("local_model_download_state_idx").on(table.state)],
)

export const transcriptionSettings = sqliteTable("transcription_settings", {
  id: text("id").primaryKey(),
  modelId: text("model_id").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const subtitlePipelines = sqliteTable("subtitle_pipelines", {
  videoId: text("video_id")
    .primaryKey()
    .references(() => jobs.videoId, { onDelete: "cascade" }),
  mode: text("mode").notNull(),
  stage: text("stage").notNull(),
  sourceLanguage: text("source_language").notNull(),
  outputLanguage: text("output_language").notNull(),
  timingProcessorProvider: text("timing_processor_provider"),
  timingProcessorService: text("timing_processor_service"),
  timingProcessorModel: text("timing_processor_model"),
  contentProcessorProvider: text("content_processor_provider"),
  contentProcessorService: text("content_processor_service"),
  contentProcessorModel: text("content_processor_model"),
  segmentationProcessorProvider: text("segmentation_processor_provider"),
  segmentationProcessorService: text("segmentation_processor_service"),
  segmentationProcessorModel: text("segmentation_processor_model"),
  manualReferenceArtifactIds: text("manual_reference_artifact_ids", {
    mode: "json",
  }).$type<string[]>().notNull(),
  updatedAt: text("updated_at"),
})

export const subtitleArtifacts = sqliteTable(
  "subtitle_artifacts",
  {
    id: text("id").primaryKey(),
    videoId: text("video_id")
      .notNull()
      .references(() => jobs.videoId, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    revision: integer("revision").notNull().default(1),
    lifecycleState: text("lifecycle_state").notNull().default("ready"),
    validationState: text("validation_state").notNull().default("valid"),
    freshnessState: text("freshness_state").notNull().default("current"),
    sourceLanguage: text("source_language").notNull(),
    outputLanguage: text("output_language"),
    sourceType: text("source_type"),
    processorProvider: text("processor_provider").notNull(),
    processorService: text("processor_service"),
    processorModel: text("processor_model"),
    timingUnitKind: text("timing_unit_kind"),
    targetFrozen: integer("target_frozen", { mode: "boolean" })
      .notNull()
      .default(false),
    manifestPath: text("manifest_path"),
    checksum: text("checksum").notNull(),
    warningCount: integer("warning_count").notNull().default(0),
    hardDefectCount: integer("hard_defect_count").notNull().default(0),
    createdAt: text("created_at"),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("subtitle_artifacts_video_kind_idx").on(
      table.videoId,
      table.kind,
    ),
    uniqueIndex("subtitle_artifacts_revision_idx").on(
      table.videoId,
      table.kind,
      table.sourceLanguage,
      table.outputLanguage,
      table.sourceType,
      table.revision,
    ),
  ],
)

export const subtitleArtifactDependencies = sqliteTable(
  "subtitle_artifact_dependencies",
  {
    artifactId: text("artifact_id")
      .notNull()
      .references(() => subtitleArtifacts.id, { onDelete: "cascade" }),
    dependsOnArtifactId: text("depends_on_artifact_id")
      .notNull()
      .references(() => subtitleArtifacts.id, { onDelete: "cascade" }),
    relation: text("relation").notNull().default("input"),
  },
  (table) => [
    primaryKey({
      columns: [table.artifactId, table.dependsOnArtifactId, table.relation],
    }),
    index("subtitle_dependencies_parent_idx").on(table.dependsOnArtifactId),
  ],
)

export const subtitleArtifactTracks = sqliteTable(
  "subtitle_artifact_tracks",
  {
    id: text("id").primaryKey(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => subtitleArtifacts.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => jobs.videoId, { onDelete: "cascade" }),
    languageCode: text("language_code").notNull(),
    role: text("role").notNull(),
    state: text("state").notNull().default("ready"),
    relativePath: text("relative_path").notNull(),
    sizeBytes: integer("size_bytes"),
    cueCount: integer("cue_count").notNull().default(0),
    checksum: text("checksum").notNull(),
    updatedAt: text("updated_at"),
  },
  (table) => [
    index("subtitle_artifact_tracks_artifact_idx").on(table.artifactId),
    index("subtitle_artifact_tracks_video_language_idx").on(
      table.videoId,
      table.languageCode,
    ),
  ],
)

export const activeSubtitleTracks = sqliteTable(
  "active_subtitle_tracks",
  {
    videoId: text("video_id")
      .notNull()
      .references(() => jobs.videoId, { onDelete: "cascade" }),
    languageCode: text("language_code").notNull(),
    trackId: text("track_id")
      .notNull()
      .references(() => subtitleArtifactTracks.id, { onDelete: "cascade" }),
    activatedAt: text("activated_at").notNull(),
    reason: text("reason").notNull().default("resolver"),
  },
  (table) => [
    primaryKey({ columns: [table.videoId, table.languageCode] }),
    uniqueIndex("active_subtitle_track_idx").on(table.trackId),
  ],
)

export const subtitleRuns = sqliteTable(
  "subtitle_runs",
  {
    id: text("id").primaryKey(),
    videoId: text("video_id")
      .notNull()
      .references(() => jobs.videoId, { onDelete: "cascade" }),
    artifactId: text("artifact_id").references(() => subtitleArtifacts.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    state: text("state").notNull(),
    stage: text("stage"),
    processorProvider: text("processor_provider"),
    processorService: text("processor_service"),
    processorModel: text("processor_model"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    error: text("error"),
  },
  (table) => [index("subtitle_runs_video_idx").on(table.videoId)],
)

export const summaryArtifacts = sqliteTable(
  "summary_artifacts",
  {
    id: text("id").primaryKey(),
    videoId: text("video_id")
      .notNull()
      .references(() => jobs.videoId, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    revision: integer("revision").notNull(),
    languageCode: text("language_code").notNull(),
    title: text("title").notNull(),
    processorProvider: text("processor_provider").notNull(),
    processorService: text("processor_service").notNull(),
    relativePath: text("relative_path").notNull(),
    checksum: text("checksum").notNull(),
    validationState: text("validation_state").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("summary_artifacts_video_kind_idx").on(table.videoId, table.kind),
    uniqueIndex("summary_artifacts_revision_idx").on(
      table.videoId,
      table.kind,
      table.languageCode,
      table.revision,
    ),
  ],
)

export const summaryDependencies = sqliteTable(
  "summary_dependencies",
  {
    artifactId: text("artifact_id")
      .notNull()
      .references(() => summaryArtifacts.id, { onDelete: "cascade" }),
    dependencyType: text("dependency_type").notNull(),
    dependencyId: text("dependency_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.artifactId,
        table.dependencyType,
        table.dependencyId,
      ],
    }),
    index("summary_dependencies_source_idx").on(
      table.dependencyType,
      table.dependencyId,
    ),
  ],
)

export const activeSummaryArtifacts = sqliteTable(
  "active_summary_artifacts",
  {
    videoId: text("video_id")
      .notNull()
      .references(() => jobs.videoId, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => summaryArtifacts.id, { onDelete: "cascade" }),
    activatedAt: text("activated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.videoId, table.kind] }),
    uniqueIndex("active_summary_artifact_idx").on(table.artifactId),
  ],
)

export const playbackStates = sqliteTable("playback_states", {
  videoId: text("video_id")
    .primaryKey()
    .references(() => jobs.videoId, { onDelete: "cascade" }),
  time: real("time").notNull().default(0),
  duration: real("duration"),
  captionLanguage: text("caption_language"),
  updatedAt: text("updated_at"),
})

export const notes = sqliteTable(
  "notes",
  {
    id: text("id").primaryKey(),
    videoId: text("video_id")
      .notNull()
      .references(() => jobs.videoId, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("notes_video_idx").on(table.videoId, table.updatedAt)],
)

export const noteAnchors = sqliteTable(
  "note_anchors",
  {
    noteId: text("note_id")
      .primaryKey()
      .references(() => notes.id, { onDelete: "cascade" }),
    startSeconds: real("start_seconds").notNull(),
    endSeconds: real("end_seconds"),
    subtitleTrackId: text("subtitle_track_id"),
    subtitleCueId: text("subtitle_cue_id"),
  },
)

export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const collectionItems = sqliteTable(
  "collection_items",
  {
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => jobs.videoId, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull().default(0),
    addedAt: text("added_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.collectionId, table.videoId] })],
)

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull(),
})

export const tagAssignments = sqliteTable(
  "tag_assignments",
  {
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tagId, table.resourceType, table.resourceId] }),
    index("tag_assignments_resource_idx").on(
      table.resourceType,
      table.resourceId,
    ),
  ],
)
