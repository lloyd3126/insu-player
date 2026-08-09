import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core"

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

export const subtitleTracks = sqliteTable(
  "subtitle_tracks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    videoId: text("video_id")
      .notNull()
      .references(() => jobs.videoId, { onDelete: "cascade" }),
    languageCode: text("language_code").notNull(),
    state: text("state"),
    source: text("source"),
    label: text("label"),
    relativePath: text("relative_path"),
    sizeBytes: integer("size_bytes"),
    cueCount: integer("cue_count").notNull().default(0),
    updatedAt: text("updated_at"),
  },
  (table) => [
    index("subtitle_tracks_video_language_idx").on(
      table.videoId,
      table.languageCode,
    ),
  ],
)

export const subtitleWorkflows = sqliteTable("subtitle_workflows", {
  videoId: text("video_id")
    .primaryKey()
    .references(() => jobs.videoId, { onDelete: "cascade" }),
  stage: text("stage"),
  source: text("source"),
  provider: text("provider"),
  model: text("model"),
  sourceLanguage: text("source_language"),
  targetLanguage: text("target_language"),
  updatedAt: text("updated_at"),
})

export const playbackStates = sqliteTable("playback_states", {
  videoId: text("video_id")
    .primaryKey()
    .references(() => jobs.videoId, { onDelete: "cascade" }),
  time: real("time").notNull().default(0),
  duration: real("duration"),
  updatedAt: text("updated_at"),
})
