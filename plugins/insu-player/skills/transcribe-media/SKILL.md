---
name: transcribe-media
description: Transcribe local audio or video into normalized JSON, plain text, and timestamped WebVTT using workspace-local Whisper or a strictly selected OpenAI, Groq, ElevenLabs, xAI, or OpenRouter STT endpoint. Use when a user requests a transcript, subtitles, timestamp preservation, provider comparison, or API transcription for media files.
---

# Transcribe Media

Produce the same three artifacts regardless of provider: "transcript.json", "transcript.txt", and "transcript.vtt". The JSON includes normalized top-level timed words or tokens with start/end timestamps so multilingual translation and segmentation workflows can rebuild complete sentences and align display pieces.

## Provider Contract

- Treat provider names, model IDs, language codes, timestamp granularities, and command flags as internal details. Ask the user only about the data boundary in ordinary language.
- When invoked through INSU Player, read the exact selection from the singleton `transcription_settings` record. The wrapper must not accept a provider or model override. The saved selection is the only source of truth for a new run and is pinned in that run's processor metadata.
- A first installation selects validated local Whisper `medium` automatically. Later selection changes happen only in the unified `轉錄設定` model catalog and apply only to new runs. The Agent must not switch models or providers, infer a fallback, or turn a failure into a different route.
- Direct use of `transcribe_media.py` outside INSU Player still requires an explicit provider and model contract supplied by the caller.
- Use a selected cloud provider only after stating which service receives audio chunks, that charges may apply, and what the local alternative is, then obtaining explicit authorization for that run.
- Do not infer upload authorization from the presence of any API key.
- Cloud provider selection is strict and has no fallback. A missing key, unsupported model, endpoint failure, or response without word timing must fail the run.
- Before extracting or uploading audio, the INSU Player wrapper must validate the current job transition and the exact provider, service, and model identity against the current schema. A contract that cannot be recorded must fail before any API request.

Current timing contracts:

| Provider | Service | Model | Key |
| --- | --- | --- | --- |
| `local` | `openai-whisper` | explicit local model such as `medium` | none |
| `openai` | `audio/transcriptions` | `whisper-1` | `OPENAI_API_KEY` |
| `groq` | `audio/transcriptions` | `whisper-large-v3` or `whisper-large-v3-turbo` | `GROQ_API_KEY` |
| `elevenlabs` | `speech-to-text` | `scribe_v2` | `ELEVENLABS_API_KEY` |
| `xai` | `v1/stt` | no model field | `XAI_API_KEY` |
| `openrouter` | `audio/transcriptions` | exactly `openai/whisper-large-v3` | `OPENROUTER_API_KEY` |

## Prepare the Isolated Runtime

In this repository, use the `$watch-video` setup:

~~~bash
scripts/portable/setup.sh --model medium
~~~

This installs all dependencies below `.local/insu-player/.agent-tools/`. Never store the API key in the repository, an environment file, logs, or generated metadata.

When this skill is invoked through the INSU `watch-video` workflow, the user selects the model in the homepage feature settings and may provide its provider key from that cloud model's details. Models from the same provider share one session credential. The model selection, key presence, and per-run upload consent remain three separate states. The key remains in the active library server process only, and `transcribe.sh` passes it directly into the authorized child process without writing or printing it. Direct invocation of `transcribe_media.py` still requires the current process environment.

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

One cloud example, after authorization:

~~~bash
export OPENAI_API_KEY='set-this-in-the-terminal'
.local/insu-player/.agent-tools/insu-player/.venv/bin/python \
  plugins/insu-player/skills/transcribe-media/scripts/transcribe_media.py INPUT \
  --output-dir OUTPUT \
  --provider openai --model whisper-1 --consent-to-audio-upload \
  --ffmpeg .local/insu-player/.agent-tools/insu-player/bin/ffmpeg
~~~

The local path enables Whisper word timestamps. Cloud paths convert media to mono 16 kHz, 48 kbps MP3 chunks of ten minutes, request provider-native word timestamps, and offset every chunk back onto one continuous timeline. Every chunk stays below the strict 25 MB cross-provider upload ceiling. Provider-returned segments are only transport cues and never become complete-sentence boundaries.

Detect the source language from audio by default. Do not ask the user to guess it before transcription. Ask for an ordinary language name only when detection is unreliable, speech is multilingual, or script and regional variation materially affect the desired text. The calling Agent resolves any answer to a canonical BCP 47 tag. For a regional tag such as `en-US` or `zh-Hant-TW`, the provider adapter passes only the parameter that the selected endpoint accepts while preserving the full stored tag. `und` means automatic detection and is never sent as a model parameter. The schema-version 3 transcript must replace it with the detected canonical `language`, record `engineLanguage`, and embed the exact timing processor identity. Unsupported model languages fail explicitly instead of being substituted.

Some Whisper-compatible endpoints return a human-readable detected language such as `english` instead of a language tag. Normalize only explicitly supported names to the stored BCP 47 tag, derive the provider engine parameter separately, and reject unknown names before importing the transcript. Never write a provider display name into `language` or `engineLanguage`.

When INSU Player starts a transcription that outlives the current turn, return orchestration to `$monitor-player-job`. This skill remains responsible only for transcription artifacts and must not create its own scheduler, polling loop, or duplicate transcription process.

Validate that VTT begins with "WEBVTT", contains cues, and has increasing timestamps. For proofreading, translation, or segmentation jobs, also require the exact schema-version 3 `transcript.json` fields, non-empty monotonic word timing, a resolved BCP 47 `language`, `engineLanguage`, chunk checksums, and the selected processor identity. Reject every older schema. Do not migrate or coerce it. Report the provider, service, model when applicable, detected language, model parameter, and timing granularity. Never report or echo the API key. This skill transcribes speech but does not proofread, translate, or segment subtitles.
