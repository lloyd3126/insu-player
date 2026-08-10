---
name: transcribe-media
description: Transcribe local audio or video into normalized JSON, plain text, and timestamped WebVTT using workspace-local Whisper or the OpenAI transcription API. Use when a user requests a transcript, subtitles, timestamp preservation, provider comparison, or API transcription for media files.
---

# Transcribe Media

Produce the same three artifacts regardless of provider: "transcript.json", "transcript.txt", and "transcript.vtt". The JSON includes normalized top-level timed words or tokens with start/end timestamps so multilingual translation and segmentation workflows can rebuild complete sentences and align display pieces.

## Provider Decision

- Treat provider names, model IDs, language codes, timestamp granularities, and command flags as Agent-owned implementation details. Ask the user only about the data boundary in ordinary language.
- Choose "local" by default when privacy matters or the user has not authorized external upload.
- Choose "openai" only after stating that audio chunks leave the device and may incur API charges, then obtaining explicit authorization.
- Do not infer upload authorization from the presence of "OPENAI_API_KEY".
- The API path uses "whisper-1" with segment and word timestamp granularities. Other transcription models may be selected only after this script can obtain equivalent word timing.

## Prepare the Isolated Runtime

In this repository, use the `$watch-video` setup:

~~~bash
scripts/portable/setup.sh --provider local --model medium
scripts/portable/setup.sh --provider openai
~~~

This installs all dependencies below `.local/insu-player/.agent-tools/`. Never store the API key in the repository, an environment file, logs, or generated metadata.

When this skill is invoked through the INSU `watch-video` workflow, the user may provide `OPENAI_API_KEY` through the homepage environment modal. That value remains in the active library server process only, and `transcribe.sh` passes it directly into the authorized child process without writing or printing it. Direct invocation of `transcribe_media.py` still requires the current process environment.

## Run

Local:

~~~bash
.local/insu-player/.agent-tools/insu-player/.venv/bin/python \
  plugins/insu-player/skills/transcribe-media/scripts/transcribe_media.py INPUT \
  --output-dir OUTPUT \
  --provider local --model medium \
  --ffmpeg .local/insu-player/.agent-tools/insu-player/bin/ffmpeg \
  --whisper-cli .local/insu-player/.agent-tools/insu-player/.venv/bin/whisper \
  --model-dir .local/insu-player/.agent-tools/insu-player/models
~~~

OpenAI, after authorization:

~~~bash
export OPENAI_API_KEY='set-this-in-the-terminal'
.local/insu-player/.agent-tools/insu-player/.venv/bin/python \
  plugins/insu-player/skills/transcribe-media/scripts/transcribe_media.py INPUT \
  --output-dir OUTPUT \
  --provider openai --model whisper-1 --consent-to-upload \
  --ffmpeg .local/insu-player/.agent-tools/insu-player/bin/ffmpeg
~~~

The local path enables Whisper word timestamps. The API path converts media to mono 16 kHz, 48 kbps MP3 chunks of ten minutes, requests segment and word timestamps, and offsets every chunk back onto one continuous timeline. Every chunk stays below the API's 25 MB file limit.

Detect the source language from audio by default. Do not ask the user to guess it before transcription. Ask for an ordinary language name only when detection is unreliable, speech is multilingual, or script and regional variation materially affect the desired text. The calling Agent resolves any answer to a canonical BCP 47 tag. For a regional tag such as `en-US` or `zh-Hant-TW`, the provider adapter verifies current Whisper capability and passes its accepted base subtag (`en` or `zh`) while preserving the full tag. `und` means automatic detection and is never sent as a model parameter. The schema-version 2 transcript must replace it with the detected canonical `language` and record the actual `engineLanguage`. Unsupported model languages fail explicitly instead of being substituted.

When INSU Player starts a transcription that outlives the current turn, return orchestration to `$monitor-player-job`. This skill remains responsible only for transcription artifacts and must not create its own scheduler, polling loop, or duplicate transcription process.

Validate that VTT begins with "WEBVTT", contains cues, and has increasing timestamps. For proofreading, translation, or segmentation jobs, also require a schema-version 2 `transcript.json` with non-empty normalized timed units, a resolved BCP 47 `language`, and `engineLanguage`. Reject every older schema; do not migrate or coerce it. Report the provider, model, detected language, model parameter, and timing granularity; never report or echo the API key. This skill transcribes speech but does not proofread, translate, or segment subtitles.
