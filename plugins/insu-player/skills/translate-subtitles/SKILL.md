---
name: translate-subtitles
description: Translate a model-timed source-language transcript into complete, natural subtitle sentences in another BCP 47 language. Use for subtitle translation, terminology repair, sentence reconstruction, or a needs_translation INSU Player job; leave display segmentation and Source Alignment to segment-subtitles.
---

# Translate Complete Subtitle Sentences

Create a schema-version 5 `translate` content manifest. This skill owns complete-sentence translation and polishing only. `$segment-subtitles` separately owns display cuts and Source Alignment.

Read [references/language-contract.md](references/language-contract.md) whenever the language pair, writing system, normalization, or selected model capability is uncertain.

## Require the Correct Evidence

1. Require a normalized model transcript with ordered `word`, `token`, or `grapheme-group` timing from the original audio. It remains the timing source even when a proofread artifact supplies the translation text.
2. Consume the detected source language from the schema-version 3 model transcript. Ask only which language the user wants for the translated subtitles, using ordinary language names. Never ask for codes. Resolve the source and output to distinct canonical BCP 47 tags before invoking scripts.
3. A creator-provided manual CC track may be used as optional spelling and terminology evidence. Its cue boundaries are never timing authority.
4. Never inspect, download, import, or reference platform automatic captions.
5. Use the current Agent for complete-sentence reconstruction, translation, and polishing. Record it as `agent / codex`. Cloud STT APIs are not subtitle-text processors in this product. Schema support does not prove language capability.
6. Do not ask the user for a model ID, provider, processor, BCP 47 tag, or command parameter. Explain only the relevant data boundary and result in ordinary language.
7. A supported cloud STT API may only receive audio for transcription after explicit consent. Never send subtitle text to any cloud API model and never persist an API key.

## Prepare Complete Sentences

```bash
python3 scripts/reflow_subtitles.py prepare \
  --source-transcript WORKSPACE/jobs/VIDEO_ID/whisper/PROVIDER/transcript.json \
  --manifest WORKSPACE/jobs/VIDEO_ID/subtitle-work/translate-SOURCE-TARGET.json \
  --mode translate \
  --source-language SOURCE_BCP47 \
  --output-language TARGET_BCP47 \
  --timing-source-artifact MODEL_TRANSCRIPT_ARTIFACT_ID \
  --reference-artifact MANUAL_CC_ARTIFACT_ID \
  --source-output WORKSPACE/jobs/VIDEO_ID/subtitle-work/input.sentence.vtt \
  --punctuation-policy preserve
```

Omit `--reference-artifact` when no manual CC exists. The manifest records complete source sentences, immutable source timed-unit ranges, `draftOutputText`, `outputText`, required terms, timing provenance, and optional text-reference provenance.

When a ready, validated proofread artifact exists, use its immutable manifest as the translation content source instead of translating the uncorrected transcript:

```bash
python3 scripts/reflow_subtitles.py prepare \
  --source-transcript WORKSPACE/jobs/VIDEO_ID/whisper/PROVIDER/transcript.json \
  --manifest WORKSPACE/jobs/VIDEO_ID/subtitle-work/translate-SOURCE-TARGET.json \
  --mode translate \
  --source-language SOURCE_BCP47 \
  --output-language TARGET_BCP47 \
  --timing-source-artifact MODEL_TRANSCRIPT_ARTIFACT_ID \
  --source-content-artifact PROOFREAD_ARTIFACT_ID \
  --source-content-manifest PROOFREAD_MANIFEST \
  --source-output WORKSPACE/jobs/VIDEO_ID/subtitle-work/input.sentence.vtt
```

The proofread manifest must match the transcript sentence IDs, timed-unit ranges, language, and timing artifact exactly. Its final `outputText` becomes each translation segment's `sourceText`. Inherit its manual CC references and do not pass new `--reference-artifact` values in this path.

When translating directly from a model transcript, read the fine-grained timed units and create a reviewed sentence-boundary file before writing translation text:

```json
{"schemaVersion":1,"boundaryAfterUnitIds":["U000021","U000047"]}
```

The final ID must be the final timed unit. Record the Agent-reviewed sentence boundaries first. When translating from a proofread artifact, this review is inherited and this command must not be used again.

```bash
python3 scripts/reflow_subtitles.py record-sentence-review \
  --manifest MANIFEST \
  --boundaries BOUNDARIES.json \
  --source-output INPUT.sentence.vtt
```

Then record the fixed content processor:

```bash
python3 scripts/reflow_subtitles.py record-content-processor \
  --manifest MANIFEST
```

## Translate Then Polish

1. Translate every complete `sourceText` into `draftOutputText`, using neighboring complete sentences for context without merging identities.
2. Re-read the complete source and draft, then write the final natural sentence to `outputText`.
3. Preserve names, numbers, code, URLs, sound labels, negation, conditions, causality, roles, uncertainty, glossary terms, and required spellings.
4. Keep segment IDs, source timed-unit ranges, order, and sentence timestamps unchanged.
5. Do not create display pieces or follow source cue breaks here.
6. Keep raw punctuation in the manifest. Display normalization belongs to rendering policy.
7. Never leave internal batch markers in any field.

If an output sentence is too long and has no safe display seam, create a shorter equivalent content revision here. Do not let alignment silently rewrite a frozen output.

## Render and Import the Translation Revision

```bash
python3 scripts/reflow_subtitles.py render \
  --manifest MANIFEST \
  --input-output WORKSPACE/jobs/VIDEO_ID/subtitle-work/input.final.vtt \
  --output WORKSPACE/jobs/VIDEO_ID/subtitle-work/output.final.vtt

plugins/insu-player/skills/watch-video/scripts/import-subtitle-revision.sh \
  WORKSPACE VIDEO_ID input.final.vtt output.final.vtt \
  --source-language SOURCE_BCP47 \
  --output-language TARGET_BCP47 \
  --artifact-kind translation \
  --revision REVISION \
  --manifest MANIFEST \
  --timing-source-artifact MODEL_TRANSCRIPT_ARTIFACT_ID \
  --content-source-artifact MODEL_TRANSCRIPT_OR_PROOFREAD_ARTIFACT_ID \
  --text-reference-artifact MANUAL_CC_ARTIFACT_ID
```

The validated translation revision becomes playable immediately. Omit the optional text reference when absent. When translating from proofreading, omit direct text references because the translation inherits them through its content source. Do not create a `proofread` or `segmentation` artifact from this skill.

Hand the content manifest, exact model transcript, timing-source artifact ID, and translation artifact ID to `$segment-subtitles`. Failed or processing segmentation must leave the last valid translation revision available.

## Report

Lead with the plain-language result and state that subtitle segmentation is still pending. Then report source and output BCP 47 codes, timing processor, content processor, timed-unit kind and count, sentence count, manual CC references, validation result, translation artifact ID/revision, manifest and VTT paths, unresolved terminology, and active playback result. Do not announce the whole subtitle workflow as complete until `$segment-subtitles` succeeds.
