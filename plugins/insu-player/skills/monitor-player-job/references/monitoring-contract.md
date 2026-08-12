# INSU Player heartbeat monitoring contract

## Purpose

Use a Codex current-task heartbeat to revisit an already-started INSU Player operation without keeping the initiating turn blocked. INSU Player does not own the scheduler. Its SQLite operation records remain the source of truth.

## Sources of truth

For one validated project-local workspace and video ID, inspect only:

- `app.db` media item, operation, event, and registered artifact rows for the exact video ID
- `jobs/<video-id>/media-work/catalog.json` only to validate registered rendition files
- `jobs/<video-id>/logs/workflow.log` only when diagnosis is required
- `jobs/<video-id>/media-work/runs/<run-id>/workflow.log` only for the selected rendition run
- `.insu-player-server.json` only to confirm the selected workspace's localhost endpoint
- the pinned processor identity on the current operation or subtitle pipeline, which must match the singleton transcription selection captured when the run started

Do not use job-directory JSON as a fallback workflow state. A missing or invalid current SQLite record fails closed and requires a rebuild.

## Scheduling boundary

- Create one heartbeat for one video ID in the current Codex task.
- Use the saved project's local checkout. Never use a worktree for media monitoring.
- Use a five-minute cadence.
- Update a matching heartbeat instead of creating a duplicate.
- Delete the heartbeat when work completes, cannot safely continue, requires user input, or is cancelled/interrupted by the user.
- If the scheduled-task capability is unavailable, report that limitation. Do not emulate it with `sleep`, terminal polling, cron, launch agents, background daemons, or application database rows.

## Job-state decisions

| State | Classification | Action |
| --- | --- | --- |
| `checking`, `downloading`, `transcribing`, `proofreading`, `translating`, `segmenting`, `preparing_player` with live PID | `monitor` | Keep one heartbeat; do not duplicate the process. |
| Active state with missing PID | `diagnose` | Inspect the log, then perform at most one idempotent resume. |
| `downloaded` | `continue-workflow` | Return `ask-subtitle-mode`. Ask only for the missing ordinary-language subtitle choice. |
| `needs_transcription` | `continue-workflow` | Return `transcribe`. Continue only with choices and consent already captured in this task. |
| `needs_proofreading` | `continue-workflow` | Return `proofread` and use `$proofread-subtitles`. |
| `needs_translation` | `continue-workflow` | Return `translate` and use `$translate-subtitles`. |
| `needs_segmentation` | `continue-workflow` | Return `segment` and use `$segment-subtitles`. |
| `ready` | `complete` | Verify assets and library projection, report, and delete the heartbeat. |
| `queued` | `needs-user` | The monitor does not start an unconfirmed job. |
| `interrupted`, `failed` | `diagnose` | Diagnose; resume once only when explicitly safe, otherwise report and stop. |

An active process whose `updatedAt` timestamp is older than 15 minutes is classified as `diagnose`, even if its PID still exists.

## Rendition-operation decisions

Read `media-work/catalog.json` when monitoring exact-height quality management.

| Operation state | Classification | Action |
| --- | --- | --- |
| `discovering`, `probing`, `downloading`, `merging`, `validating` with live PID | `monitor` | Continue monitoring the exact selected height. |
| Active operation with missing PID | `diagnose` | Inspect the selected run and allow at most one exact-height resume. |
| `ready` | `complete` | Report the downloaded rendition; never activate it automatically. |
| `failed`, `interrupted` | `diagnose` | Do not choose another height or automatic fallback. |
| Missing operation or mismatched run ID | `needs-user` | Stop and report the stale or missing selection. |

## Safe automatic resume

One automatic resume is permitted only when all of the following hold:

1. The job and workspace identities are unchanged.
2. The original operation is idempotent and documented as resumable by `$watch-video`.
3. No new API upload, quality-floor exception, deletion, transcription selection change, language change, or account access is required.
4. The same operation has not already been automatically resumed by this heartbeat.

After one resume, a second interruption or equivalent failure requires user attention. The heartbeat must stop rather than retry indefinitely.

The heartbeat never re-resolves a provider or model from conversation text and never passes a provider override. If the user changed the feature-setting selection after this run started, the existing run keeps its pinned processor. A retry that would require a different model is a new user decision rather than an automatic resume.

## API and secret handling

The heartbeat prompt may record that explicit upload consent exists in the current task. It must never contain the API key itself. New or expanded uploads require explicit consent. Do not print environment values, signed stream URLs, cookies, authorization headers, or unredacted log content in a scheduled result.

## Reporting policy

Report only when:

- the state or stage changes;
- progress crosses a new 10-percent bucket;
- a process becomes missing or stale;
- an automatic resume occurs;
- work reaches `complete`, `needs-user`, or an unrecoverable failure.

Include the exact workspace, video ID, state, stage, progress, next action, and heartbeat disposition. Do not claim completion until expected artifacts and the library projection are verified.
