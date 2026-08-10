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
  "jobs",
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
    statusModifiedAt: integer("status_modified_at").notNull().default(0),
    projectedAt: text("projected_at").notNull(),
  },
  (table) => [
    index("jobs_updated_at_idx").on(table.updatedAt),
    index("jobs_state_idx").on(table.effectiveState),
  ],
)

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

export const playbackStates = sqliteTable("playback_states", {
  videoId: text("video_id")
    .primaryKey()
    .references(() => jobs.videoId, { onDelete: "cascade" }),
  time: real("time").notNull().default(0),
  duration: real("duration"),
  captionLanguage: text("caption_language"),
  updatedAt: text("updated_at"),
})
