---
name: segment-subtitles
description: Split a completed multilingual subtitle translation into target-first display pieces, freeze the target wording and cuts, align each piece to contiguous source word or token timing, validate linguistic and deterministic defects, and render synchronized source/target WebVTT. Use for subtitle segmentation, source alignment, reflow, width repair, reading-timing repair, bilingual anchor correction, or a segmentation plan in INSU Player.
---

# Segment and Align Subtitles

Consume a completed schema-version 2 translation manifest from `$translate-subtitles`. Keep translation, segmentation, and library import as separate responsibilities.

## Read the Applicable Contract

1. Read [references/segmentation-policy.md](references/segmentation-policy.md) for every segmentation or alignment task.
2. Read [references/manifest-schema.md](references/manifest-schema.md) before creating or editing `segmentation-plan.json`.
3. Read [references/validator-rules.md](references/validator-rules.md) when validation fails or when reporting defects.
4. Read exactly the applicable writing-system profile:
   - Chinese, Japanese, or Korean: [references/language-cjk.md](references/language-cjk.md)
   - Left-to-right scripts with reliable language-level spacing: [references/language-spacing.md](references/language-spacing.md)
   - Arabic, Hebrew, Persian, or Urdu: [references/language-rtl.md](references/language-rtl.md)
   - Thai, Khmer, Lao, Myanmar, or another script without reliable whitespace word boundaries: [references/language-complex-no-space.md](references/language-complex-no-space.md)

Treat BCP 47 language metadata and the selected model's capabilities as the authority. Do not claim universal model coverage merely because the schema accepts any valid language code.

## Require the Correct Inputs

Require all of the following:

- a completed `bilingual-sentences.json` with `sourceLanguage`, `targetLanguage`, complete `sourceText`, and polished `targetText`;
- the exact model transcript referenced by that manifest;
- ordered word-, token-, or grapheme-group timing;
- the selected local or explicitly authorized API language model for linguistic segmentation decisions;
- glossary and required terms when supplied.

Do not use a platform cue track for precise Source Alignment. If timed units are unavailable, report that exact limitation and stop.

## Prepare the Target-First Plan

Create a plan without source spans:

```bash
python3 scripts/segment_subtitles.py prepare \
  --translation-manifest WORKSPACE/jobs/VIDEO_ID/subtitle-work/bilingual-sentences.json \
  --source-transcript WORKSPACE/jobs/VIDEO_ID/whisper/PROVIDER/transcript.json \
  --output WORKSPACE/jobs/VIDEO_ID/subtitle-work/segmentation-plan.json
```

For every complete target sentence:

1. Read the complete natural translation before proposing a cut.
2. Mark clauses, predicates, objects, modifiers, coordination, parentheticals, quotations, names, terms, numbers, and units.
3. Mark bound or blocked ranges before selecting seams.
4. Split only at target-language semantic and syntactic boundaries.
5. Keep each piece independently readable and below the configured hard width.
6. If no safe seam resolves hard width, return to `$translate-subtitles` for a shorter equivalent translation. Do not rewrite translation inside this skill.
7. Keep the concatenated target pieces text-equivalent to `targetFullText`.

Use the same chosen local or API language model that owns the translation contract unless the user explicitly selects another model. Obtain consent before sending subtitle text to a new external service.

## Freeze Before Alignment

After target pieces are final, run:

```bash
python3 scripts/segment_subtitles.py freeze-target \
  --plan WORKSPACE/jobs/VIDEO_ID/subtitle-work/segmentation-plan.json
```

After freezing, change only `sourceSpan`, anchors, and boundary evidence. Never change target wording, piece count, piece order, or separators. To reconsider cuts without changing the translation, create a new revision:

```bash
python3 scripts/segment_subtitles.py revise-target --plan PLAN
```

If the complete translation itself must change, return to `$translate-subtitles`, produce a new translation revision, and prepare a new segmentation plan.

## Align Source Timed Units

Assign each frozen target piece one continuous, chronological `sourceSpan`. Together, the pieces of a translation unit must cover its source timed units exactly once, with no gap or overlap.

- Treat pauses and source cue boundaries only as hints.
- Never use a `risky` or `blocked` boundary.
- Keep bilingual anchors in the same paired piece.
- When source and target order differ, preserve natural target order and adjust or merge target cuts before freezing. Do not create non-monotonic playback timing.
- Do not manufacture tiny source spans for visually large target pieces.

## Validate and Render

Validate the plan:

```bash
python3 scripts/segment_subtitles.py validate --plan PLAN
```

Hard defects fail. Fit-width, flash-fragment, and reading-rate observations remain explicit warnings unless the policy classifies the underlying condition as a hard defect.

Render paired tracks only after validation succeeds:

```bash
python3 scripts/segment_subtitles.py render \
  --plan PLAN \
  --source-output WORKSPACE/jobs/VIDEO_ID/subtitle-work/SOURCE.segmented.vtt \
  --target-output WORKSPACE/jobs/VIDEO_ID/subtitle-work/TARGET.segmented.vtt
```

The renderer derives timestamps from aligned source timed units and gives both tracks identical cue IDs and intervals. Preserve the original transcript, complete translation manifest, prior translation tracks, and every frozen segmentation revision.

Hand the validated pair to `$watch-video` for import and job-state updates. Report languages, model/provider, target revision, piece count, width profile, warnings, hard defects, alignment coverage, rendered paths, and any unresolved terminology.
