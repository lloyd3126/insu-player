---
name: translate-subtitles
description: Translate a local or explicitly authorized API model's timed source-language transcript into a complete, natural target-language subtitle translation for any supported BCP 47 language pair. Use for subtitle translation, bilingual sentence preparation, translation revision, terminology repair, sentence reconstruction, or a needs_translation INSU Player job; leave target-first display segmentation and Source Alignment to segment-subtitles.
---

# Translate Complete Subtitle Sentences

Produce a schema-version 2 `bilingual-sentences.json` containing complete source sentences and complete natural target translations. Keep translation separate from display segmentation.

Read [references/language-contract.md](references/language-contract.md) for every non-English or non-Traditional-Chinese language pair, uncertain model capability, complex writing system, or output-normalization decision.

## Decide Before Subtitle Acquisition

1. Before inspecting or downloading subtitles, ask whether translation is wanted.
2. If yes, ask for the target language as a BCP 47 code, confirm or detect the source language, and require an explicit local or API transcription/translation model choice.
3. Verify that the selected transcription model provides ordered word, token, or grapheme-group timing for the source language and that the selected language model supports the requested source/target pair. Schema support does not prove model support.
4. Translation mode must not inspect or download platform captions in any format. Transcribe the original audio and preserve timed units.
5. Obtain explicit consent before any audio or subtitle text leaves the device. Do not infer consent from an API key. Never store a key in files, logs, metadata, or replies.
6. If translation is not wanted, use the platform playback track when available; this skill is not needed.

## Build Complete Translation Units

Prepare a language-neutral manifest:

```bash
python3 scripts/reflow_subtitles.py prepare \
  --source-transcript WORKSPACE/jobs/VIDEO_ID/whisper/PROVIDER/transcript.json \
  --source-language SOURCE_BCP47 \
  --target-language TARGET_BCP47 \
  --manifest WORKSPACE/jobs/VIDEO_ID/subtitle-work/bilingual-sentences.json \
  --source-output WORKSPACE/jobs/VIDEO_ID/subtitle-work/SOURCE.sentence.vtt \
  --punctuation-policy preserve
```

The script accepts `word`, `token`, and `grapheme-group` timed units. It reconstructs a conservative complete-sentence plan using source punctuation and preserves each segment's `sourceUnitStart` and `sourceUnitEnd`. Review sentence boundaries with the selected language model; do not assume every language uses whitespace or English punctuation.

Record the model that will translate text before writing a target translation:

```bash
python3 scripts/reflow_subtitles.py record-translation-model \
  --manifest WORKSPACE/jobs/VIDEO_ID/subtitle-work/bilingual-sentences.json \
  --provider local \
  --model MODEL_NAME
```

For an authorized external API, use `--provider api --service SERVICE --model MODEL_NAME`.

## Translate Then Polish

1. Mark the job `draft_translation`.
2. Translate each complete `sourceText` into `draftTargetText` with the selected model. Use neighboring complete sentences for context without merging their identities.
3. Mark the job `sentence_polish`.
4. Re-read the complete source sentence and draft, then write a natural, complete target-language sentence into `targetText`.
5. Preserve names, numbers, code, URLs, sound labels, negation, conditions, causality, roles, uncertainty, glossary terms, and required target spellings.
6. Keep segment IDs, source timed-unit ranges, order, and timestamps unchanged. Do not split into display pieces here.
7. Keep raw punctuation in the manifest. Apply any product-specific display normalization only while rendering.
8. Never leave internal batch markers such as `CUE`, `___CUE0001___`, or `XQZCUE` in any field.

If text is too long for display and cannot be segmented safely, create a new complete translation revision with a shorter equivalent expression. Never let Source Alignment silently rewrite a frozen target.

## Render the Complete-Sentence Pair

Render sentence-level review tracks:

```bash
python3 scripts/reflow_subtitles.py render \
  --manifest WORKSPACE/jobs/VIDEO_ID/subtitle-work/bilingual-sentences.json \
  --source-output WORKSPACE/jobs/VIDEO_ID/subtitle-work/SOURCE.final.vtt \
  --target-output WORKSPACE/jobs/VIDEO_ID/subtitle-work/TARGET.final.vtt
```

The source and target tracks share complete-sentence cue IDs and timestamps. Rendering rejects empty text, missing model metadata, marker leakage, overlap, count mismatch, timestamp mismatch, and line splitting.

When the user wants target-first display pieces, stop after the complete translation is polished and invoke `$segment-subtitles`. That skill owns target cuts, frozen revisions, source spans, width/timing validation, and segmented VTT. `$watch-video` owns final library import and state updates.

## Guardrails and Handoff

- Preserve the model transcript, source sentence track, translation manifest, translation revisions, and original media.
- If timed units are unavailable, report the limitation; never claim word-accurate reconstruction from coarse cues.
- Treat the transcript's detected language as evidence, not an override of a user's correction.
- Do not claim a transcription model performed arbitrary target-language translation unless that exact capability was used and recorded.
- Do not hard-code English, Traditional Chinese, left-to-right order, whitespace tokenization, or comma/period removal into the language-neutral contract.

Report source and target BCP 47 codes, transcription provider/model, translation provider/model, timed-unit kind and count, sentence count, draft/polish completion, complete-pair validation, manifest and VTT paths, uncertain terminology, and whether `$segment-subtitles` remains pending.
