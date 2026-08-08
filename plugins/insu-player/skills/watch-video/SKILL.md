---
name: watch-video
description: Add an authorized online video to INSU Player and keep the user on one local library page while downloading, obtaining captions, transcribing locally or through the OpenAI API, translating subtitles, resuming work, and watching in an iframe modal. Use whenever a user asks Codex to watch, download, transcribe, translate, subtitle, or reopen a video.
---

# INSU Player: Watch Video

Keep the user on one workspace-scoped localhost library homepage while Codex manages downloads, captions, transcription, translation, recovery, and cleanup through deterministic scripts.

## Start Safely

1. Read [references/workflow.md](references/workflow.md) for a first installation, interrupted job, cleanup, or unfamiliar request. Read [references/troubleshooting.md](references/troubleshooting.md) when a check fails.
2. Confirm that the user has the right to download and process the requested media. Do not bypass DRM, paywalls, memberships, private access, region restrictions, or account controls.
3. Resolve and state the workspace before inspecting localhost services or processes. Use the repository-local `.local/insu-player/` for a portable release. For a developer checkout or installed plugin, use the project-local workspace supplied by the user; when none was supplied, default to `<current-project-root>/.local/insu-player/`.
4. Treat the resolved workspace path as the library identity. Never search outside the current project for a fuller or already-running INSU workspace, and never adopt one merely because it has jobs, a completed runtime, or a server on the default port. Only cross that boundary when the user explicitly selects the other workspace.
5. Run `scripts/portable/doctor.sh` from the repository root in portable mode, or `scripts/doctor.sh WORKSPACE` from this skill.
6. Port `8000` is a default for the selected workspace, not a machine-wide library identity. Reuse a running server only when the selected workspace's `.insu-player-server.pid` and `.insu-environment-session.json` belong to that live process. If another workspace occupies the port, leave it untouched and start the selected workspace on another port such as `8010`.
7. Before the first setup, explain network use and approximate disk impact. Local Whisper can consume several GB; the API provider avoids the model download but uploads audio externally and may incur API charges.

## Choose a Provider

- Prefer captions exposed by the source platform; they avoid transcription entirely.
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
scripts/portable/serve.sh 8000
scripts/portable/add-video.sh 'https://www.youtube.com/watch?v=VIDEO_ID'
~~~

For explicit OpenAI transcription:

~~~bash
export OPENAI_API_KEY='set-this-in-the-terminal'
scripts/portable/add-video.sh 'VIDEO_URL' --provider openai --allow-api-upload
~~~

When the library server is already running, the user may instead enter `OPENAI_API_KEY` through the navbar's environment modal. The value exists only in that server process and is cleared when the server stops. `transcribe.sh` can launch the API child process with that session value without returning, printing, or writing it. The shell export remains the fallback when the server is not running.

Never add "--allow-api-upload" merely because an API key exists. It records that the user authorized this upload.

The homepage defaults to "http://127.0.0.1:8000/" and uses the actual selected port when a conflict requires another one. It is a read-mostly status surface: downloads, transcription, translation, failures, logs, provider metadata, storage, captions, and playback progress remain visible. Watching opens a same-origin iframe modal so the user does not leave the library.

## Translation

Use an existing target-language track when available. Otherwise follow `$translate-subtitles`: translate cue text while preserving every VTT timestamp and cue order, validate the VTT, then import it:

~~~bash
plugins/insu-player/skills/watch-video/scripts/import-caption.sh \
  .local/insu-player VIDEO_ID zh-TW translated.vtt \
  --source agent-translation --label '繁體中文'
~~~

Do not claim that Whisper translated into Traditional Chinese; Whisper's translation task targets English.

## Recovery, Updating, and Removal

- Re-run the same job command after interruption; durable "status.json" and logs are the source of truth.
- Use `$player-manager` for repository/plugin updates. Updating code must preserve `.local/` and jobs.
- Preview runtime removal with "scripts/portable/uninstall.sh". Add "--yes" to remove tools and caches while retaining jobs; add "--include-generated --yes" only when the user explicitly wants videos, subtitles, logs, and progress removed.
- For complete portable removal, stop foreground processes, clean up as authorized, then move the exact extracted repository folder to Trash. No workflow-owned persistent data should exist elsewhere.

At handoff, report the provider, workspace, homepage, final job state, artifacts, next-use command, and exact removal boundary.
