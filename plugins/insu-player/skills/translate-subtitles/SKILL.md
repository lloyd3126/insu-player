---
name: translate-subtitles
description: Translate a local or OpenAI model's word-timed English transcript into polished Traditional Chinese, then rebuild synchronized complete-sentence English and Traditional Chinese WebVTT tracks. Use for subtitle translation, bilingual caption preparation, a needs_translation job, sentence-boundary repair, or fixing an invalid translated VTT.
---

# Translate and Reflow Subtitles

Produce polished `en` and `zh-TW` WebVTT tracks whose cues share one complete-sentence timeline. When translation is requested, the source of truth is model-generated English word timing, never a platform caption track.

## Decide Before Subtitle Acquisition

1. Before inspecting or downloading subtitles, ask whether the user wants Traditional Chinese translation.
2. If the answer is yes, ask the user to choose `local` or `openai`, then call the watch workflow with `--translate zh-TW --provider PROVIDER`. Translation mode must not inspect or download platform captions in any format; transcribe the original audio with the selected model and preserve word timestamps. If the answer is no, use `--no-translate`; a platform playback VTT is then acceptable.
3. OpenAI audio transcription needs explicit upload consent and `--allow-api-upload`. Do not infer consent from an API key. Agent-local text translation does not send transcript text to a separate translation service; name the service and obtain consent before any other external text request.

## Build the Sentence Plan

The transcription workflow creates `<job>/subtitle-work/bilingual-sentences.json` from the selected model's normalized `transcript.json`. If it must be recreated, run:

```bash
python3 scripts/reflow_subtitles.py prepare \
  --source-transcript WORKSPACE/jobs/VIDEO_ID/whisper/PROVIDER/transcript.json \
  --manifest WORKSPACE/jobs/VIDEO_ID/subtitle-work/bilingual-sentences.json \
  --english-output WORKSPACE/jobs/VIDEO_ID/subtitle-work/en.sentence.vtt
```

The script requires a `local` or `openai` transcript provider, model metadata, and normalized word entries with start/end timestamps. It reconstructs complete English sentences and assigns one start/end interval to each sentence before translation.

## Translate Then Polish

1. Mark the workflow `draft_translation` before editing the manifest so the homepage remains the status source.
2. Translate every segment once as a draft and place it in `draftTraditionalChinese`. Preserve names, numbers, code, URLs, meaningful sound labels, and uncertainty.
3. Mark the workflow `sentence_polish`, then re-read each complete English sentence and its draft. Write a natural Taiwanese Traditional Chinese sentence into `traditionalChinese`; this is a polishing pass, not a copy of fragmented cue translations.
4. Keep every segment ID and timestamp unchanged. Do not add, remove, reorder, merge, or split sentence segments during translation.
5. Never leave internal batch markers such as `CUE`, `___CUE0001___`, or `XQZCUE` in either text field.

## Render and Import Both Tracks

Mark the workflow `subtitle_reflow`, then render final files outside `captions/` first:

```bash
python3 scripts/reflow_subtitles.py render \
  --manifest WORKSPACE/jobs/VIDEO_ID/subtitle-work/bilingual-sentences.json \
  --english-output WORKSPACE/jobs/VIDEO_ID/subtitle-work/en.final.vtt \
  --traditional-chinese-output WORKSPACE/jobs/VIDEO_ID/subtitle-work/zh-TW.final.vtt
```

Rendering enforces the product layout:

- English and Traditional Chinese use identical cue IDs and start/end timestamps.
- Each cue contains one complete sentence on one physical line; a sentence is never split between cues.
- Commas and periods in both languages (`，`, `。`, `,`, `.`) become half-width spaces, and whitespace collapses to single ASCII spaces.
- Internal markers, empty text, overlap, count mismatch, timestamp mismatch, and line splitting fail validation.

Import both tracks together only after pair validation succeeds:

```bash
../watch-video/scripts/import-bilingual-captions.sh \
  WORKSPACE VIDEO_ID \
  WORKSPACE/jobs/VIDEO_ID/subtitle-work/en.final.vtt \
  WORKSPACE/jobs/VIDEO_ID/subtitle-work/zh-TW.final.vtt \
  --force
```

The importer preserves the first pre-reflow English and Traditional Chinese tracks as `en.pre-reflow.vtt` and `zh-TW.pre-reflow.vtt`, replaces both playback tracks, updates both metadata entries, and marks the job ready only after the synchronized pair is installed.

## Guardrails

- When translation is requested, never inspect or download platform captions, including VTT and JSON caption formats. Re-transcribe legacy audio with an explicitly selected local or OpenAI model.
- Keep the model `transcript.json` and sentence manifest outside the final playback tracks. VTT remains the browser output format.
- Never overwrite the only source. The word transcript, pre-reflow backups, and original audio must remain recoverable.
- If word timing is unavailable, report that exact limitation. Do not claim sentence timing was reconstructed from data that only contains coarse cue timing.
- Do not claim Whisper translated to Traditional Chinese; Whisper's translation task targets English.

Report the provider/model, transcript path, word count, complete-sentence count, draft and polish completion, shared-timeline validation, final English and Traditional Chinese paths, imported job state, and uncertain terminology.
