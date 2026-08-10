CREATE TABLE `active_subtitle_tracks` (
	`video_id` text NOT NULL,
	`language_code` text NOT NULL,
	`track_id` text NOT NULL,
	`activated_at` text NOT NULL,
	`reason` text DEFAULT 'resolver' NOT NULL,
	PRIMARY KEY(`video_id`, `language_code`),
	FOREIGN KEY (`video_id`) REFERENCES `jobs`(`video_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `subtitle_artifact_tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `active_subtitle_track_idx` ON `active_subtitle_tracks` (`track_id`);--> statement-breakpoint
CREATE TABLE `job_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`kind` text NOT NULL,
	`relative_path` text NOT NULL,
	`size_bytes` integer,
	`updated_at` text,
	`available` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `jobs`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_assets_video_idx` ON `job_assets` (`video_id`,`kind`);--> statement-breakpoint
CREATE TABLE `job_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`at` text,
	`state` text,
	`stage` text,
	`message` text,
	FOREIGN KEY (`video_id`) REFERENCES `jobs`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_history_video_idx` ON `job_history` (`video_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`video_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`state` text NOT NULL,
	`effective_state` text NOT NULL,
	`stage` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`created_at` text,
	`updated_at` text,
	`completed_at` text,
	`last_error` text,
	`watchable` integer DEFAULT false NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`thumbnail_url` text,
	`watch_url` text,
	`has_log` integer DEFAULT false NOT NULL,
	`status_modified_at` integer DEFAULT 0 NOT NULL,
	`projected_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_updated_at_idx` ON `jobs` (`updated_at`);--> statement-breakpoint
CREATE INDEX `jobs_state_idx` ON `jobs` (`effective_state`);--> statement-breakpoint
CREATE TABLE `media_download_runs` (
	`id` text NOT NULL,
	`video_id` text NOT NULL,
	`requested_height` integer,
	`state` text NOT NULL,
	`stage` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`error` text,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	PRIMARY KEY(`video_id`, `id`),
	FOREIGN KEY (`video_id`) REFERENCES `jobs`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_download_runs_video_idx` ON `media_download_runs` (`video_id`);--> statement-breakpoint
CREATE TABLE `media_renditions` (
	`id` text NOT NULL,
	`video_id` text NOT NULL,
	`requested_height` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`container` text NOT NULL,
	`video_codec` text,
	`audio_codec` text,
	`relative_path` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`checksum` text NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`video_id`, `id`),
	FOREIGN KEY (`video_id`) REFERENCES `jobs`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_renditions_video_height_idx` ON `media_renditions` (`video_id`,`height`);--> statement-breakpoint
CREATE TABLE `playback_states` (
	`video_id` text PRIMARY KEY NOT NULL,
	`time` real DEFAULT 0 NOT NULL,
	`duration` real,
	`caption_language` text,
	`updated_at` text,
	FOREIGN KEY (`video_id`) REFERENCES `jobs`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `subtitle_artifact_dependencies` (
	`artifact_id` text NOT NULL,
	`depends_on_artifact_id` text NOT NULL,
	`relation` text DEFAULT 'input' NOT NULL,
	PRIMARY KEY(`artifact_id`, `depends_on_artifact_id`),
	FOREIGN KEY (`artifact_id`) REFERENCES `subtitle_artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_artifact_id`) REFERENCES `subtitle_artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subtitle_dependencies_parent_idx` ON `subtitle_artifact_dependencies` (`depends_on_artifact_id`);--> statement-breakpoint
CREATE TABLE `subtitle_artifact_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`video_id` text NOT NULL,
	`language_code` text NOT NULL,
	`role` text NOT NULL,
	`state` text DEFAULT 'ready' NOT NULL,
	`relative_path` text NOT NULL,
	`size_bytes` integer,
	`cue_count` integer DEFAULT 0 NOT NULL,
	`checksum` text NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`artifact_id`) REFERENCES `subtitle_artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_id`) REFERENCES `jobs`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subtitle_artifact_tracks_artifact_idx` ON `subtitle_artifact_tracks` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `subtitle_artifact_tracks_video_language_idx` ON `subtitle_artifact_tracks` (`video_id`,`language_code`);--> statement-breakpoint
CREATE TABLE `subtitle_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`kind` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`lifecycle_state` text DEFAULT 'ready' NOT NULL,
	`validation_state` text DEFAULT 'valid' NOT NULL,
	`freshness_state` text DEFAULT 'current' NOT NULL,
	`source_language` text NOT NULL,
	`output_language` text,
	`source_type` text,
	`processor_provider` text NOT NULL,
	`processor_service` text,
	`processor_model` text,
	`timing_unit_kind` text,
	`target_frozen` integer DEFAULT false NOT NULL,
	`manifest_path` text,
	`checksum` text NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`hard_defect_count` integer DEFAULT 0 NOT NULL,
	`created_at` text,
	`completed_at` text,
	FOREIGN KEY (`video_id`) REFERENCES `jobs`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subtitle_artifacts_video_kind_idx` ON `subtitle_artifacts` (`video_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `subtitle_artifacts_revision_idx` ON `subtitle_artifacts` (`video_id`,`kind`,`source_language`,`output_language`,`source_type`,`revision`);--> statement-breakpoint
CREATE TABLE `subtitle_pipelines` (
	`video_id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`stage` text NOT NULL,
	`source_language` text NOT NULL,
	`output_language` text NOT NULL,
	`timing_processor_provider` text,
	`timing_processor_service` text,
	`timing_processor_model` text,
	`content_processor_provider` text,
	`content_processor_service` text,
	`content_processor_model` text,
	`segmentation_processor_provider` text,
	`segmentation_processor_service` text,
	`segmentation_processor_model` text,
	`manual_reference_artifact_ids` text NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`video_id`) REFERENCES `jobs`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `subtitle_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`artifact_id` text,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`stage` text,
	`processor_provider` text,
	`processor_service` text,
	`processor_model` text,
	`started_at` text,
	`completed_at` text,
	`error` text,
	FOREIGN KEY (`video_id`) REFERENCES `jobs`(`video_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `subtitle_artifacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `subtitle_runs_video_idx` ON `subtitle_runs` (`video_id`);