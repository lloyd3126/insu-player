---
name: segment-subtitles
description: Split a completed proofread or translated subtitle revision into output-first display pieces, freeze wording and cuts, align every piece to a continuous source timed-unit span, validate defects, and render synchronized input/output WebVTT. Use for subtitle segmentation, Source Alignment, width repair, reading-timing repair, or bilingual anchor correction.
---

# Segment and Align Subtitles

Consume a completed schema-version 5 content manifest from `$proofread-subtitles` or `$translate-subtitles` and produce a schema-version 4 segmentation plan. This skill is independent from content correction and translation.

## Read the Applicable Contract

1. Always read [references/segmentation-policy.md](references/segmentation-policy.md).
2. Read [references/manifest-schema.md](references/manifest-schema.md) before editing a plan.
3. Read [references/validator-rules.md](references/validator-rules.md) when validation fails or when reporting defects.
4. Read exactly the applicable output-language profile:
   - Chinese, Japanese, or Korean: [references/language-cjk.md](references/language-cjk.md)
   - Left-to-right scripts with reliable language-level spacing: [references/language-spacing.md](references/language-spacing.md)
   - Arabic, Hebrew, Persian, or Urdu: [references/language-rtl.md](references/language-rtl.md)
   - Thai, Khmer, Lao, Myanmar, or another script without reliable whitespace word boundaries: [references/language-complex-no-space.md](references/language-complex-no-space.md)

BCP 47 metadata and verified model capability are authoritative. Do not infer universal model coverage from schema acceptance.

This skill never asks the user to supply a language code, processor, model, Source Alignment choice, width profile, or command parameter. Consume the canonical source and output tags already recorded by the current content artifact. If they are missing or ambiguous, return to the owning content workflow instead of guessing or reading an older schema.

## Require the Correct Inputs

Require all of the following:

- a completed content manifest with `mode`, `sourceLanguage`, `outputLanguage`, complete `sourceText`, and final `outputText`;
- the exact model transcript referenced by that manifest;
- ordered word-, token-, or grapheme-group timing;
- the completed proofread or translation artifact ID;
- glossary and required terms when supplied.

Also preserve the content manifest's distinct `sourceContentArtifactId` and `sourceContentKind`. A translation may use a proofread artifact for words while continuing to use the original model transcript for timing. Segmentation must not collapse these roles or reinterpret the uncorrected transcript as translation content.

Manual CC may be inherited as text-reference provenance through the content artifact. Never use platform cue timing for precise alignment, and never accept platform automatic captions.

Use the current Agent for target/output-first segmentation and Source Alignment, recorded as `agent / codex`. Do not accept a local model or cloud API as the segmentation processor. Source timing remains restricted to local Whisper or an explicitly authorized supported cloud STT contract that returned validated word timing. Do not ask the user to make this internal selection.

## Prepare Output-First Pieces

```bash
python3 scripts/segment_subtitles.py prepare \
  --content-manifest WORKSPACE/jobs/VIDEO_ID/subtitle-work/CONTENT.json \
  --source-transcript WORKSPACE/jobs/VIDEO_ID/whisper/PROVIDER/transcript.json \
  --output WORKSPACE/jobs/VIDEO_ID/subtitle-work/segmentation-plan.json

python3 scripts/segment_subtitles.py record-segmentation-processor \
  --plan WORKSPACE/jobs/VIDEO_ID/subtitle-work/segmentation-plan.json
```

For translated content, this is the target-first rule: decide the natural target-language pieces before source alignment. For same-language proofreading, apply the identical rule to the finalized output language.

For every complete output sentence:

1. Read the complete sentence before proposing any cut.
2. Mark clauses, predicates, objects, modifiers, coordination, parentheticals, quotations, names, fixed terms, numbers, and units.
3. Mark blocked and risky ranges before selecting seams.
4. Split only at output-language semantic and syntactic boundaries.
5. Keep every piece independently readable and below the hard width.
6. If no safe seam resolves hard width, return to the owning content skill for a shorter equivalent revision.
7. Keep concatenated `outputText` pieces text-equivalent to `outputFullText`.

Do not follow original cue boundaries, source word count, pauses, or visual CJK/Latin spacing as mandatory seams.

## Freeze Then Align

```bash
python3 scripts/segment_subtitles.py freeze-target --plan PLAN
```

After freezing, change only `sourceSpan`, anchors, and boundary evidence. Never change output wording, piece count, order, or separators. Use `revise-target --plan PLAN` to create a new target revision before refreezing.

Assign every frozen piece one continuous, chronological source span. The pieces of a content unit must partition its timed units exactly once with no gap or overlap.

Read the source and target meaning before assigning every `sourceSpan`. Never generate spans through equal word counts, duration ratios, display-width ratios, or another proportional allocation. Those methods may be used only to notice suspicious results, never to create Source Alignment.

- Never use a `blocked` or `risky` source boundary.
- Keep names, terms, numbers, and other bilingual anchors in the paired piece.
- Preserve natural output order when languages reorder syntax; solve timing through safe cuts or merges, not unnatural wording.
- Avoid tiny spans and flash fragments.

After all spans and bilingual anchors are semantically reviewed by the current Agent, record that review. Any later span or anchor change invalidates the fingerprint and requires a new review:

```bash
python3 scripts/segment_subtitles.py record-alignment-review --plan PLAN
```

## Validate Render and Import

```bash
python3 scripts/segment_subtitles.py validate --plan PLAN

python3 scripts/segment_subtitles.py render \
  --plan PLAN \
  --input-output WORKSPACE/jobs/VIDEO_ID/subtitle-work/input.segmented.vtt \
  --output WORKSPACE/jobs/VIDEO_ID/subtitle-work/output.segmented.vtt

plugins/insu-player/skills/watch-video/scripts/import-subtitle-revision.sh \
  WORKSPACE VIDEO_ID input.segmented.vtt output.segmented.vtt \
  --source-language SOURCE_BCP47 \
  --output-language OUTPUT_BCP47 \
  --artifact-kind segmentation \
  --revision REVISION \
  --manifest PLAN \
  --timing-source-artifact MODEL_TRANSCRIPT_ARTIFACT_ID \
  --content-parent-artifact CONTENT_ARTIFACT_ID \
  --warning-count WARNING_COUNT \
  --hard-defect-count 0
```

Only a ready, validated segmentation revision with no hard defects can outrank its content parent for playback. A failed, invalid, or processing revision must never replace a valid proofread or translation fallback.

Preserve the model transcript, content manifest, content artifact, and every frozen segmentation revision. The import processor must exactly match `segmentationProcessor` in the plan. Lead with the plain-language result and where the user can view the segmented subtitles. Then report languages, content mode, timing/content/segmentation processors, timing and content parent IDs, artifact ID/revision, piece count, width profile, warnings, hard defects, alignment coverage, rendered paths, and active playback result.
