---
name: transcribe-media
description: Transcribe local audio or video into normalized JSON, plain text, and timestamped WebVTT using workspace-local Whisper or the OpenAI transcription API. Use when a user requests a transcript, subtitles, timestamp preservation, provider comparison, or API transcription for media files.
---

# Transcribe Media

Produce the same three artifacts regardless of provider: "transcript.json", "transcript.txt", and "transcript.vtt". The JSON includes normalized top-level `words` with start/end timestamps so the translation workflow can rebuild complete sentences.

## Provider Decision

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

Validate that VTT begins with "WEBVTT", contains cues, and has increasing timestamps. For translation jobs, also validate that `transcript.json` contains non-empty normalized words. Report the provider and model; never report or echo the API key. This skill transcribes speech but does not translate it into Traditional Chinese.
