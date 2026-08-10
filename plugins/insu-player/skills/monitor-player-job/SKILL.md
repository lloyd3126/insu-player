---
name: monitor-player-job
description: Monitor and resume an already-started INSU Player setup, download, rendition, transcription, proofreading, translation, segmentation, or player-preparation job with a scheduled heartbeat attached to the current task. Use when an INSU Player operation outlives the current turn, when a user asks Codex to check back later, or when an interrupted workflow must be inspected and safely resumed.
---

# Monitor INSU Player Job

Keep one long-running INSU Player workflow attached to the current Codex task without duplicating the media operation or adding a scheduler to the application.

## Inspect Before Scheduling

1. Resolve the current project root, its selected project-local workspace, and the exact video ID. Never search another project for a matching job.
2. Read [references/monitoring-contract.md](references/monitoring-contract.md) completely before creating, updating, resuming, or stopping a heartbeat.
3. Inspect the job with the deterministic read-only helper:

~~~bash
python3 plugins/insu-player/skills/monitor-player-job/scripts/inspect_player_job.py \
  --project-root CURRENT_PROJECT_ROOT \
  --workspace CURRENT_PROJECT_ROOT/.local/insu-player \
  --video-id VIDEO_ID
~~~

For an exact-height rendition operation, add `--operation rendition` and the catalog operation's `--run-id` when known.

The helper accepts only the current job schema and catalog schema. Treat an unsupported schema as a hard incompatibility; do not migrate, coerce, or fall back to a legacy reader.

## Create One Current-Task Heartbeat

- Use the Codex app's scheduled-task capability only when it is available. If it is absent, report that automatic follow-up is unavailable; do not implement terminal polling, sleep loops, cron, or another scheduling fallback.
- Create a heartbeat attached to the current task. Never create a standalone scheduled task or a new task per run.
- Run against the saved project in its local checkout, never an isolated worktree. The selected `.local/insu-player` workspace, localhost service, media process, and model cache belong to that checkout.
- Use a five-minute cadence for the first implementation. Prefer updating an existing heartbeat for the same current task and video ID over creating a duplicate.
- Name the heartbeat `INSU Player · VIDEO_ID` and keep its prompt durable: identify the project, workspace, video ID, authorized subtitle mode and processors, whether this task contains explicit API-upload consent, the per-run inspection procedure, and the stop conditions.
- Never include an API key, cookie, signed media URL, raw log contents, or arbitrary user path in the scheduled prompt.

## Handle Each Wake-Up

Run the inspector again and follow its classification:

- `monitor`: the owned process is alive and the state is active. Do not start another process. Keep the heartbeat and report only a stage change, a new 10-percent progress bucket, or an error.
- `continue-workflow`: the external process finished at a deterministic handoff. Resume only the already-authorized next skill or script from `$watch-video`.
- `complete`: verify the expected media or subtitle artifacts and the localhost library projection, report completion, then delete the heartbeat.
- `needs-user`: stop automatic work and ask for the missing choice or authorization. Keep no recurring heartbeat while user input is required.
- `diagnose`: inspect the allowlisted workflow log tail and process facts. Resume an idempotent operation at most once when the contract permits it; otherwise report the blocker and delete the heartbeat.

Do not switch workspace, provider, model, language, subtitle mode, requested rendition height, active rendition, or active subtitle track during monitoring.

## Resume Through Existing Skills

- Use `$watch-video` for top-level ingestion recovery and deterministic phase continuation.
- Use `$proofread-subtitles` only from `needs_proofreading` with the confirmed source language and content processor.
- Use `$translate-subtitles` only from `needs_translation` with the confirmed source/output languages and content processor.
- Use `$segment-subtitles` only from `needs_segmentation` after the complete proofread or translation revision exists.
- Monitor an already-started OpenAI request, but never start or retry an API upload unless the current task contains explicit authorization for that upload.

Stop after a second interruption or repeated equivalent failure. Never delete media, subtitles, jobs, or the workspace as a recovery action.

## Handoff

Report the workspace, video ID, last state and stage, final artifact or blocker, whether one automatic resume occurred, and that the heartbeat was removed or is still active. The homepage remains the user's live progress surface; this skill only coordinates Agent wake-ups.
