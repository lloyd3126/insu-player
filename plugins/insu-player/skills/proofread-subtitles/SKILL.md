---
name: proofread-subtitles
description: Correct a timed transcript in its original BCP 47 language without translating or changing meaning. Use for same-language subtitle proofreading, ASR repair, punctuation and casing repair, terminology correction, complete-sentence reconstruction, or a needs_proofreading INSU Player job before target-first segmentation.
---

# Proofread Complete Subtitle Sentences

Produce a schema-version 3 subtitle revision whose `mode` is `proofread` and whose source and output language codes are identical. Keep same-language correction separate from translation and display segmentation.

Read [references/proofreading-contract.md](references/proofreading-contract.md) before every correction task.

## Require Evidence

1. Require the normalized model transcript with ordered word, token, or grapheme-group timing.
2. Treat a creator-provided manual CC track as optional text, spelling, and terminology evidence. Never use its cue boundaries as word timing.
3. Reject platform automatic captions as evidence.
4. Confirm the source BCP 47 language and verify that the selected local or explicitly authorized API language model supports it.
5. Obtain consent before subtitle text leaves the device. Do not infer consent from an API key.

## Prepare the Same-Language Revision

```bash
python3 scripts/proofread_subtitles.py prepare \
  --source-transcript WORKSPACE/jobs/VIDEO_ID/whisper/PROVIDER/transcript.json \
  --language SOURCE_BCP47 \
  --timing-source-artifact SOURCE_ARTIFACT_ID \
  --reference-artifact MANUAL_CC_ARTIFACT_ID \
  --manifest WORKSPACE/jobs/VIDEO_ID/subtitle-work/proofread-SOURCE_BCP47.json \
  --source-output WORKSPACE/jobs/VIDEO_ID/subtitle-work/input.sentence.vtt
```

Record the selected correction model before editing output text:

```bash
python3 scripts/proofread_subtitles.py record-content-model \
  --manifest MANIFEST --provider local --model MODEL_NAME
```

Use `--provider openai --service SERVICE` only after explicit subtitle-text upload authorization.

## Correct Then Review

1. Read each complete `sourceText` with neighboring sentences.
2. Write a conservative first correction to `draftOutputText`.
3. Review the complete sentence and write the final same-language text to `outputText`.
4. Correct only evidence-backed recognition errors, names, terminology, casing, punctuation, and sentence structure.
5. Preserve meaning, stance, uncertainty, roles, negation, conditions, causality, numbers, code, URLs, sound labels, glossary terms, dialect, script, and region.
6. Keep segment IDs, source timed-unit ranges, order, and timestamps unchanged. Do not split display pieces here.
7. If the audio and manual CC materially disagree, keep the model transcript as timing evidence and report the uncertainty instead of forcing the CC wording.

## Render and Import

```bash
python3 scripts/proofread_subtitles.py render \
  --manifest MANIFEST --input-output INPUT.vtt --output OUTPUT.vtt
```

Import the validated pair as a `proofread` artifact. It becomes playable immediately. Then hand the manifest and exact model transcript to `$segment-subtitles`; that skill owns output-first cuts, frozen revisions, Source Alignment, and segmented VTT.

```bash
plugins/insu-player/skills/watch-video/scripts/import-subtitle-revision.sh \
  WORKSPACE VIDEO_ID INPUT.vtt OUTPUT.vtt \
  --source-language SOURCE_BCP47 \
  --output-language SOURCE_BCP47 \
  --provider local \
  --model MODEL_NAME \
  --artifact-kind proofread \
  --revision REVISION \
  --manifest MANIFEST \
  --timing-source-artifact MODEL_TRANSCRIPT_ARTIFACT_ID \
  --text-reference-artifact MANUAL_CC_ARTIFACT_ID
```

Omit the optional text reference when no manual CC exists.

Do not create a `translation` artifact, change the language code, or segment subtitles from this skill.
