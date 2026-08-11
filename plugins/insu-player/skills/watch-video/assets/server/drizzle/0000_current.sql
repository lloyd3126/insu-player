CREATE TABLE `active_subtitle_tracks` (
	`video_id` text NOT NULL,
	`language_code` text NOT NULL,
	`track_id` text NOT NULL,
	`activated_at` text NOT NULL,
	`reason` text DEFAULT 'resolver' NOT NULL,
	PRIMARY KEY(`video_id`, `language_code`),
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `subtitle_artifact_tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `active_subtitle_track_idx` ON `active_subtitle_tracks` (`track_id`);--> statement-breakpoint
CREATE TABLE `active_summary_artifacts` (
	`video_id` text NOT NULL,
	`kind` text NOT NULL,
	`artifact_id` text NOT NULL,
	`activated_at` text NOT NULL,
	PRIMARY KEY(`video_id`, `kind`),
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `summary_artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `active_summary_artifact_idx` ON `active_summary_artifacts` (`artifact_id`);--> statement-breakpoint
CREATE TABLE `agent_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`video_id` text,
	`state` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`copied_at` text,
	`claimed_at` text,
	`completed_at` text,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_intents_state_idx` ON `agent_intents` (`state`,`expires_at`);--> statement-breakpoint
CREATE TABLE `collection_items` (
	`collection_id` text NOT NULL,
	`video_id` text NOT NULL,
	`ordinal` integer DEFAULT 0 NOT NULL,
	`added_at` text NOT NULL,
	PRIMARY KEY(`collection_id`, `video_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `download_queue_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_kind` text NOT NULL,
	`page_url` text NOT NULL,
	`source_url` text NOT NULL,
	`source_key` text NOT NULL,
	`session_id` text,
	`operation_id` text NOT NULL,
	`video_id` text,
	`rights_confirmed` integer NOT NULL,
	`low_quality_approved` integer NOT NULL,
	`authentication` text NOT NULL,
	`authentication_consent_at` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `download_queue_item_source_idx` ON `download_queue_items` (`source_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `download_queue_item_operation_idx` ON `download_queue_items` (`operation_id`);--> statement-breakpoint
CREATE INDEX `download_queue_item_created_idx` ON `download_queue_items` (`created_at`);--> statement-breakpoint
CREATE TABLE `download_queue_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`concurrency` integer DEFAULT 2 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `extension_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_origin` text NOT NULL,
	`token_hash` text NOT NULL,
	`paired_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE TABLE `job_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`kind` text NOT NULL,
	`relative_path` text NOT NULL,
	`size_bytes` integer,
	`updated_at` text,
	`available` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade
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
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_history_video_idx` ON `job_history` (`video_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `media_items` (
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
	`duration_seconds` real,
	`record_json` text NOT NULL,
	`record_revision` integer DEFAULT 1 NOT NULL,
	`projected_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_updated_at_idx` ON `media_items` (`updated_at`);--> statement-breakpoint
CREATE INDEX `jobs_state_idx` ON `media_items` (`effective_state`);--> statement-breakpoint
CREATE TABLE `local_model_download_runs` (
	`model_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`progress` real NOT NULL,
	`downloaded_bytes` integer NOT NULL,
	`total_bytes` integer NOT NULL,
	`message` text NOT NULL,
	`error_code` text,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `local_model_download_state_idx` ON `local_model_download_runs` (`state`);--> statement-breakpoint
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
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade
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
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_renditions_video_height_idx` ON `media_renditions` (`video_id`,`height`);--> statement-breakpoint
CREATE TABLE `media_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`source_url` text NOT NULL,
	`source_type` text NOT NULL,
	`external_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `note_anchors` (
	`note_id` text PRIMARY KEY NOT NULL,
	`start_seconds` real NOT NULL,
	`end_seconds` real,
	`subtitle_track_id` text,
	`subtitle_cue_id` text,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notes_video_idx` ON `notes` (`video_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `operation_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`state` text NOT NULL,
	`stage` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_events_sequence_idx` ON `operation_events` (`operation_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text,
	`parent_operation_id` text,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`stage` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`processor_provider` text,
	`processor_service` text,
	`processor_model` text,
	`inputs_json` text DEFAULT '{}' NOT NULL,
	`outputs_json` text DEFAULT '{}' NOT NULL,
	`consent_json` text DEFAULT '{}' NOT NULL,
	`resumable` integer DEFAULT false NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`pid` integer,
	`error_code` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `operations_video_idx` ON `operations` (`video_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `operations_state_idx` ON `operations` (`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `playback_states` (
	`video_id` text PRIMARY KEY NOT NULL,
	`time` real DEFAULT 0 NOT NULL,
	`duration` real,
	`caption_language` text,
	`updated_at` text,
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `runtime_capabilities` (
	`key` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`label` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`version` text,
	`checked_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subtitle_artifact_dependencies` (
	`artifact_id` text NOT NULL,
	`depends_on_artifact_id` text NOT NULL,
	`relation` text DEFAULT 'input' NOT NULL,
	PRIMARY KEY(`artifact_id`, `depends_on_artifact_id`, `relation`),
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
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade
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
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade
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
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade
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
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `subtitle_artifacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `subtitle_runs_video_idx` ON `subtitle_runs` (`video_id`);--> statement-breakpoint
CREATE TABLE `summary_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`kind` text NOT NULL,
	`revision` integer NOT NULL,
	`language_code` text NOT NULL,
	`title` text NOT NULL,
	`processor_provider` text NOT NULL,
	`processor_service` text NOT NULL,
	`relative_path` text NOT NULL,
	`checksum` text NOT NULL,
	`validation_state` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `media_items`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `summary_artifacts_video_kind_idx` ON `summary_artifacts` (`video_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `summary_artifacts_revision_idx` ON `summary_artifacts` (`video_id`,`kind`,`language_code`,`revision`);--> statement-breakpoint
CREATE TABLE `summary_dependencies` (
	`artifact_id` text NOT NULL,
	`dependency_type` text NOT NULL,
	`dependency_id` text NOT NULL,
	PRIMARY KEY(`artifact_id`, `dependency_type`, `dependency_id`),
	FOREIGN KEY (`artifact_id`) REFERENCES `summary_artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `summary_dependencies_source_idx` ON `summary_dependencies` (`dependency_type`,`dependency_id`);--> statement-breakpoint
CREATE TABLE `tag_assignments` (
	`tag_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tag_id`, `resource_type`, `resource_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tag_assignments_resource_idx` ON `tag_assignments` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `transcription_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`updated_at` text NOT NULL
);
