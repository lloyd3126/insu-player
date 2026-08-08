---
name: transcribe-media
description: Transcribe local audio or video into normalized JSON, plain text, and timestamped WebVTT using workspace-local Whisper or the OpenAI transcription API. Use when a user requests a transcript, subtitles, timestamp preservation, provider comparison, or API transcription for media files.
---

# Transcribe Media

Produce the same three artifacts regardless of provider: "transcript.json", "transcript.txt", and "transcript.vtt".

## Provider Decision

- Choose "local" by default when privacy matters or the user has not authorized external upload.
- Choose "openai" only after stating that audio chunks leave the device and may incur API charges, then obtaining explicit authorization.
- Do not infer upload authorization from the presence of "OPENAI_API_KEY".
- The API path uses "whisper-1" for segment timestamps. Other current transcription models may be selected only if the requested output does not require timestamped VTT and this script is extended accordingly.

## Prepare the Isolated Runtime

In this repository, use the `$watch-video` setup:

~~~bash
scripts/portable/setup.sh --provider local --model turbo
scripts/portable/setup.sh --provider openai
~~~

This installs all dependencies below `.local/xeruca-player/.agent-tools/`. Never store the API key in the repository, an environment file, logs, or generated metadata.

## Run

Local:

~~~bash
.local/xeruca-player/.agent-tools/xeruca-player/.venv/bin/python \
  plugins/xeruca-player/skills/transcribe-media/scripts/transcribe_media.py INPUT \
  --output-dir OUTPUT \
  --provider local --model turbo \
  --ffmpeg .local/xeruca-player/.agent-tools/xeruca-player/bin/ffmpeg \
  --whisper-cli .local/xeruca-player/.agent-tools/xeruca-player/.venv/bin/whisper \
  --model-dir .local/xeruca-player/.agent-tools/xeruca-player/models
~~~

OpenAI, after authorization:

~~~bash
export OPENAI_API_KEY='set-this-in-the-terminal'
.local/xeruca-player/.agent-tools/xeruca-player/.venv/bin/python \
  plugins/xeruca-player/skills/transcribe-media/scripts/transcribe_media.py INPUT \
  --output-dir OUTPUT \
  --provider openai --model whisper-1 --consent-to-upload \
  --ffmpeg .local/xeruca-player/.agent-tools/xeruca-player/bin/ffmpeg
~~~

The API path converts media to mono 16 kHz, 48 kbps MP3 chunks of ten minutes. Every chunk stays below the API's 25 MB file limit, and segment timestamps are offset back onto one continuous timeline.

Validate that VTT begins with "WEBVTT", contains cues, and has increasing timestamps. Report the provider and model; never report or echo the API key. This skill transcribes speech but does not translate it into Traditional Chinese.
