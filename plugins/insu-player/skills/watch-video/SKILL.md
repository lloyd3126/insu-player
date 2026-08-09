---
name: watch-video
description: Add an authorized online video to INSU Player and keep the user on one local library page while downloading, obtaining captions, transcribing locally or through the OpenAI API, translating subtitles, resuming work, and watching in an iframe modal. Use whenever a user asks Codex to watch, download, transcribe, translate, subtitle, or reopen a video.
---

# INSU Player: Watch Video

Keep the user on one workspace-scoped localhost library homepage while Codex manages downloads, captions, transcription, translation, recovery, and cleanup through deterministic scripts.

## Start Safely

1. Read [references/workflow.md](references/workflow.md) for a first installation, interrupted job, cleanup, or unfamiliar request. Read [references/troubleshooting.md](references/troubleshooting.md) when a check fails.
2. Resolve and state the workspace before inspecting localhost services or processes. Use the repository-local `.local/insu-player/` for a portable release. For a developer checkout or installed plugin, use the project-local workspace supplied by the user; when none was supplied, default to `<current-project-root>/.local/insu-player/`.
3. Treat the resolved workspace path as the library identity. Never search outside the current project for a fuller or already-running INSU workspace, and never adopt one merely because it has jobs, a completed runtime, or a server on the default port. Only cross that boundary when the user explicitly selects the other workspace.
4. Port `8000` is only the preferred starting port, not a machine-wide library identity. Start normally without an explicit port. If `8000` is occupied, the server must atomically bind an OS-selected free localhost port and record the actual `host`, `port`, and `pid` in the selected workspace's `.insu-player-server.json`. Reuse a running server only when that workspace-owned descriptor identifies a live process; leave every other workspace untouched. Treat an explicitly supplied port as strict.
5. Make the first user-visible product action opening the selected workspace homepage in the Codex in-app browser. Start or reuse its server, open the actual localhost URL instead of merely printing it, and keep the page open before running doctor, setup, media inspection, download, transcription, or translation. If the in-app browser is unavailable, report the exact URL immediately. If Python 3 is unavailable and the server cannot start, report that blocker, install only through the workspace setup flow, and open the homepage as soon as its Python exists.
6. Before inspecting or downloading subtitles, ask whether the user wants translation. After yes, ask for the target BCP 47 language, confirm or detect the source language, require an explicit `local` or `openai` transcription provider, and pass `--translate TARGET --provider PROVIDER`; translation mode must not inspect or download any platform caption format and must obtain source-language word or token timing from the original audio. After no, pass `--no-translate` and platform playback captions may be used.
7. Confirm that the user has the right to download and process the requested media. Do not bypass DRM, paywalls, memberships, private access, region restrictions, or account controls.
8. Run `scripts/portable/doctor.sh` from the repository root in portable mode, or `scripts/doctor.sh WORKSPACE` from this skill while the homepage remains open.
9. Before the first setup, explain network use and approximate disk impact. Local Whisper can consume several GB; the API provider avoids the model download but uploads audio externally and may incur API charges.

## Choose a Provider

- When translation is not requested, prefer captions exposed by the source platform; they avoid transcription entirely.
- Source support follows the extractor set of the workflow-local yt-dlp version. YouTube is the default example, not the only supported platform. When a URL has no matching extractor, use INSU Player to research the source and a safe implementation path before declaring it unsupported.
- Use "local" when audio must remain on the device. It installs Whisper, PyTorch, and the selected model inside the workspace.
- Use "openai" only after explicit user authorization to upload audio. Require "OPENAI_API_KEY" in the process environment and never save or print it. The workflow uses "whisper-1" because timestamped segment output is required.
- If both are installed, the default remains local unless the user chooses API upload.

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
~~~

Start the server and open the exact homepage URL it reports in the Codex in-app browser before the setup or add-video commands. The same endpoint is recorded in `.insu-player-server.json`. The server can use system Python 3 for the initial empty homepage while the workflow-local runtime is still absent. Keep the same page open so setup and job state appear there as they become available.

For explicit OpenAI transcription:

~~~bash
export OPENAI_API_KEY='set-this-in-the-terminal'
scripts/portable/add-video.sh 'VIDEO_URL' --translate zh-TW --provider openai --allow-api-upload
~~~

When the library server is already running, the user may instead enter `OPENAI_API_KEY` through the navbar's environment modal. The value exists only in that server process and is cleared when the server stops. `transcribe.sh` can launch the API child process with that session value without returning, printing, or writing it. The shell export remains the fallback when the server is not running.

Never add "--allow-api-upload" merely because an API key exists. It records that the user authorized this upload.

The homepage prefers "http://127.0.0.1:8000/". When that port is occupied, use the actual URL reported by the server and recorded in `.insu-player-server.json`; do not guess a fallback port. The homepage is a read-mostly status surface: downloads, transcription, translation, failures, logs, provider metadata, storage, captions, and playback progress remain visible. Watching opens a same-origin iframe modal so the user does not leave the library.

## Translation

When translation was requested, follow `$translate-subtitles`: transcribe the original audio with the explicitly selected local or OpenAI model, use its normalized timed units to reconstruct complete source sentences, translate once as a draft, and polish complete natural target-language sentences. Then follow `$segment-subtitles`: decide target pieces first, freeze them, align continuous source timed-unit spans, validate, and render synchronized source and target tracks. Import the validated pair with explicit languages:

~~~bash
plugins/insu-player/skills/watch-video/scripts/import-bilingual-captions.sh \
  .local/insu-player VIDEO_ID SOURCE.segmented.vtt TARGET.segmented.vtt \
  --source-language SOURCE_BCP47 --target-language TARGET_BCP47 --force
~~~

Do not inspect or download platform captions in translation mode. Keep complete translation sentences separate from derived display segmentation. Final segmented tracks must have identical cue IDs and intervals derived from continuous source timed units. Apply punctuation normalization only through the selected language/output profile. Do not claim that a transcription model translated into an arbitrary target language unless that exact capability was used and recorded.

## Recovery, Updating, and Removal

- Re-run the same job command after interruption; durable "status.json" and logs are the source of truth.
- Use `$player-manager` for repository/plugin updates. Updating code must preserve `.local/` and jobs.
- Preview runtime removal with "scripts/portable/uninstall.sh". Add "--yes" to remove tools and caches while retaining jobs; add "--include-generated --yes" only when the user explicitly wants videos, subtitles, logs, and progress removed.
- For complete portable removal, stop foreground processes, clean up as authorized, then move the exact extracted repository folder to Trash. No workflow-owned persistent data should exist elsewhere.

At handoff, report the provider, workspace, homepage, final job state, artifacts, next-use command, and exact removal boundary.
