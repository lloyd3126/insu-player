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
CREATE TABLE `playback_states` (
	`video_id` text PRIMARY KEY NOT NULL,
	`time` real DEFAULT 0 NOT NULL,
	`duration` real,
	`updated_at` text,
	FOREIGN KEY (`video_id`) REFERENCES `jobs`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `subtitle_tracks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`language_code` text NOT NULL,
	`state` text,
	`source` text,
	`label` text,
	`relative_path` text,
	`size_bytes` integer,
	`cue_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`video_id`) REFERENCES `jobs`(`video_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subtitle_tracks_video_language_idx` ON `subtitle_tracks` (`video_id`,`language_code`);--> statement-breakpoint
CREATE TABLE `subtitle_workflows` (
	`video_id` text PRIMARY KEY NOT NULL,
	`stage` text,
	`source` text,
	`provider` text,
	`model` text,
	`source_language` text,
	`target_language` text,
	`updated_at` text,
	FOREIGN KEY (`video_id`) REFERENCES `jobs`(`video_id`) ON UPDATE no action ON DELETE cascade
);
