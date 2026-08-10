---
name: watch-video
description: Add an authorized online video to INSU Player and keep the user on one local library page while downloading, obtaining captions, transcribing locally or through the OpenAI API, translating subtitles, monitoring long-running work, resuming interruptions, and watching in an iframe modal. Use whenever a user asks Codex to watch, download, transcribe, translate, subtitle, or reopen a video.
---

# INSU Player: Watch Video

Keep the user on one workspace-scoped localhost library homepage while Codex manages downloads, captions, transcription, translation, recovery, and cleanup through deterministic scripts.

## Start Safely

1. Read [references/workflow.md](references/workflow.md) for a first installation, interrupted job, cleanup, or unfamiliar request. Read [references/troubleshooting.md](references/troubleshooting.md) when a check fails.
2. Resolve and state the workspace before inspecting localhost services or processes. Use the repository-local `.local/insu-player/` for a portable release. For a developer checkout or installed plugin, use the project-local workspace supplied by the user; when none was supplied, default to `<current-project-root>/.local/insu-player/`.
3. Treat the resolved workspace path as the library identity. Never search outside the current project for a fuller or already-running INSU workspace, and never adopt one merely because it has jobs, a completed runtime, or a server on the default port. Only cross that boundary when the user explicitly selects the other workspace.
4. Port `8000` is only the preferred starting port, not a machine-wide library identity. Start normally without an explicit port. If `8000` is occupied, the server must atomically bind an OS-selected free localhost port and record the actual `host`, `port`, and `pid` in the selected workspace's `.insu-player-server.json`. Reuse a running server only when that workspace-owned descriptor identifies a live process; leave every other workspace untouched. Treat an explicitly supplied port as strict.
5. Make the first user-visible product action opening the selected workspace homepage in the Codex in-app browser. Start or reuse its server, open the actual localhost URL instead of merely printing it, and keep the page open before running doctor, setup, media inspection, download, transcription, or translation. If the in-app browser is unavailable, report the exact URL immediately. If Python 3 is unavailable and the server cannot start, report that blocker, install only through the workspace setup flow, and open the homepage as soon as its Python exists.
6. Treat the user as a first-time user who may not know technical terms or how to describe the desired result. Before inspecting or downloading subtitles, ask in ordinary language whether they want the video's original-language subtitles cleaned up or translated. For translation, ask only for an ordinary target-language name. Do not ask the user to choose a skill, model ID, provider, processor, timing method, artifact, Source Alignment, BCP 47 tag, or model parameter.
7. Detect the source language from the original audio by default. Ask about it only when detection is unreliable, speech is multilingual, or script and regional variation materially affect the result. Internally resolve ordinary language names to canonical stored BCP 47 tags and then to the timing model's accepted parameter. A completed artifact must contain the detected canonical language rather than `und`.
8. Inspect installed capabilities and recommend one safe processing plan in plain language. Default to local Whisper medium for fine-grained audio timing and the current Agent for complete-sentence content and subtitle segmentation. Explain whether audio remains local, whether the Agent reads transcript text, whether another API will receive data, and whether charges may apply. Ask for explicit consent only when an API will actually receive audio or subtitle text. Internally record timing, content, and segmentation processors separately.
9. Creator-provided manual CC may be downloaded, imported, used as text evidence, and played immediately in either path. Platform automatic captions must never be inspected, downloaded, imported, or referenced. Proofreading, translation, and segmentation always require source-language word, token, or grapheme-group timing produced from the original audio by the selected timing model.
10. Confirm in plain language that the user owns the media or has permission to download, transcribe, and watch it. Never claim authorization on the user's behalf. Do not bypass DRM, paywalls, memberships, private access, region restrictions, or account controls.
11. Run `scripts/portable/doctor.sh` from the repository root in portable mode, or `scripts/doctor.sh WORKSPACE` from this skill while the homepage remains open.
12. Before the first setup, explain network use and approximate disk impact. Local Whisper can consume several GB. An API provider avoids the model download but uploads data externally and may incur charges.

## Resolve Processing Internally

- Creator-provided manual CC is the preferred immediate playback track and optional text reference. It never replaces model timing for proofreading, translation, or segmentation. When no manual CC exists, the model transcript is the initial playable source track.
- Source support follows the extractor set of the workflow-local yt-dlp version. YouTube is the default example, not the only supported platform. When a URL has no matching extractor, use INSU Player to research the source and a safe implementation path before declaring it unsupported.
- Use local timing by default. It installs Whisper, PyTorch, and the recommended `medium` model inside the workspace.
- Use OpenAI timing only after explicit user authorization to upload audio. Require "OPENAI_API_KEY" in the process environment and never save or print it. The workflow uses "whisper-1" because timestamped segment output is required.
- Choose content and segmentation processors independently after inspecting what is actually available. The current Agent is the default for these text stages. A verified local model or explicitly authorized OpenAI model may be used when it better matches the user's plain-language privacy or quality request.
- Record Codex as `agent / codex`. Do not add it to the installed model inventory.
- If the user says "you decide", use the safe default. If the user says "keep everything local", verify a capable local content and segmentation model rather than treating Whisper as a translation model.

## Preserve Playback Quality

- Treat a single HTTP 403 as a transient stream failure, not proof that a quality tier is unavailable. Resolve a fresh media URL and run a small HTTP Range probe twice before moving to a lower height.
- Prefer the highest verified browser-oriented MP4 up to 1080p. Automatic fallback may select another verified format at or above 720p; anything below the 720p quality floor requires the user's explicit approval and `--allow-low-quality`.
- Keep playback video selection independent from transcription. Whisper uses the separately prepared audio track, so lowering video resolution is not a transcription optimization.
- Store source availability, every verified local rendition, the active rendition, and the current operation in `media-work/catalog.json`. Store each run's probes, selection, media info, and log below `media-work/runs/<run-id>/`; never retain signed stream URLs. Verify the exact requested height with workflow-local FFmpeg before atomically publishing it below `source/renditions/`.
- Never silently retain a lower-quality file after a higher-quality failure. Report the selected height and whether fresh higher-quality attempts failed.
- Initial ingestion may choose the highest verified browser-oriented MP4 up to 1080p. Later user-initiated downloads from the `畫質管理` tab are exact-height operations: refresh source metadata, probe fresh URLs twice, download only the selected height, validate it, and keep the current active rendition unchanged until the user explicitly switches it.
- The player quality selector lists only already downloaded renditions. Changing it updates `activeRenditionId`; it never starts a download. A non-active rendition can be removed through the shared direct-removal dialog, but the active rendition must be switched first.

Portable setup:

~~~bash
scripts/portable/setup.sh --provider local --model medium
scripts/portable/setup.sh --provider openai
scripts/portable/setup.sh --provider both --model medium
~~~

Do not use sudo, Homebrew, apt, a global pip, or a global npm install. The setup script installs uv, Python, Deno, FFmpeg, Python packages, models, and known caches below the workspace.

## Run the Library

~~~bash
scripts/portable/serve.sh
scripts/portable/add-video.sh 'https://www.youtube.com/watch?v=VIDEO_ID' --translate zh-TW --provider local
scripts/portable/add-video.sh 'https://www.youtube.com/watch?v=VIDEO_ID' --proofread --provider local --language en
~~~

Start the server and open the exact homepage URL it reports in the Codex in-app browser before the setup or add-video commands. The same endpoint is recorded in `.insu-player-server.json`. The server can use system Python 3 for the initial empty homepage while the workflow-local runtime is still absent. Keep the same page open so setup and job state appear there as they become available.

For explicit OpenAI transcription:

~~~bash
export OPENAI_API_KEY='set-this-in-the-terminal'
scripts/portable/add-video.sh 'VIDEO_URL' --translate zh-TW --provider openai --allow-api-upload
~~~

When the library server is already running, the user may instead enter `OPENAI_API_KEY` through the navbar's environment modal. The value exists only in that server process and is cleared when the server stops. `transcribe.sh` can launch the API child process with that session value without returning, printing, or writing it. The shell export remains the fallback when the server is not running.

Never add "--allow-api-upload" merely because an API key exists. It records that the user authorized this upload.

The homepage prefers "http://127.0.0.1:8000/". When that port is occupied, use the actual URL reported by the server and recorded in `.insu-player-server.json`; do not guess a fallback port. The homepage is a read-mostly status surface: downloads, transcription, translation, failures, logs, processor metadata, storage, captions, and playback progress remain visible. Watching opens a same-origin iframe modal so the user does not leave the library.

## Subtitle Production

The source layer accepts only creator-provided manual CC or a model transcript. Manual CC is playable and may guide spelling and terminology. Its cue boundaries never supply precise alignment. Automatic platform captions are forbidden in every path.

For same-language correction, follow `$proofread-subtitles`. For translation, follow `$translate-subtitles`. Both paths transcribe the original audio with the internally resolved local or explicitly authorized OpenAI timing model, preserve normalized fine-grained timed units, reconstruct complete source sentences, and produce a complete polished output before display cuts. Import the validated complete revision as `proofread` or `translation` respectively:

~~~bash
plugins/insu-player/skills/watch-video/scripts/import-subtitle-revision.sh \
  .local/insu-player VIDEO_ID INPUT.final.vtt OUTPUT.final.vtt \
  --source-language SOURCE_BCP47 --output-language OUTPUT_BCP47 \
  --artifact-kind proofread_or_translation --revision REVISION \
  --manifest MANIFEST --timing-source-artifact MODEL_SOURCE_ARTIFACT_ID \
  --text-reference-artifact MANUAL_CC_ARTIFACT_ID \
  --processor-provider agent --processor-service codex
~~~

Each complete proofread or translation revision is playable before segmentation. Then follow `$segment-subtitles` to create a separate downstream artifact: decide finalized output-language pieces first, freeze them, align continuous source timed-unit spans, validate, render, and import with the timing-source and content-parent artifact IDs. A processing or invalid new artifact must never hide the last valid active track.

Keep complete corrected or translated sentences separate from derived display segmentation. Final segmented tracks must have identical cue IDs and intervals derived from continuous source timed units. Apply punctuation normalization only through the selected language/output profile. Do not claim that a processor supports an arbitrary language unless that exact capability was verified and recorded. The player exposes only ready validated tracks; artifact kind, provenance, revisions, processor, validation, active-version switching, and deletion belong in 字幕管理.

Current data contracts are clean-break only: job status uses schema 5 and model transcripts use schema 2. Reject any other version and rebuild the job; never migrate, coerce, or invoke a legacy reader.

## Recovery, Updating, and Removal

- When setup, download, rendition management, transcription, or another external process remains active after the first minute of direct observation, use `$monitor-player-job` to create or update one five-minute heartbeat attached to the current task. Keep the selected workspace, video ID, subtitle choices, processor choices, and upload consent boundary in that task. Never create a standalone scheduled task or a worktree for media monitoring.
- The heartbeat re-reads `status.json` or the selected media catalog operation and never duplicates a live process. It may continue deterministic already-authorized handoffs, but it must stop for new API consent, a low-quality exception, deletion, provider or language changes, repeated failure, or any other user decision.
- Delete the heartbeat after verified completion or when the workflow cannot safely continue. If scheduled tasks are unavailable, report that automatic follow-up is unavailable; do not add a polling, cron, daemon, or database fallback.
- Re-run the same job command after interruption; durable "status.json" and logs are the source of truth.
- Use `$player-manager` for repository/plugin updates. Updating code must preserve `.local/` and jobs.
- Preview runtime removal with "scripts/portable/uninstall.sh". Add "--yes" to remove tools and caches while retaining jobs; add "--include-generated --yes" only when the user explicitly wants videos, subtitles, logs, and progress removed.
- For complete portable removal, stop foreground processes, clean up as authorized, then move the exact extracted repository folder to Trash. No workflow-owned persistent data should exist elsewhere.

Do not announce overall completion after download, transcription, or a complete-sentence content revision alone. Overall completion requires playable media plus validated complete-sentence and segmentation artifacts in the subtitle catalog.

At handoff, lead with the plain-language result and where the user can view it. Then report the timing, content, and segmentation processors, workspace, homepage, final job state, artifacts, heartbeat disposition, next-use command, and exact removal boundary without asking the user to interpret those internal fields.
