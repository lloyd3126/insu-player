# Segmentation validator rules

## Hard defects

- `TARGET_MUTATED_AFTER_FREEZE`: frozen target fingerprint changed.
- `TARGET_TEXT_CHANGED`: pieces do not reconstruct the complete translation.
- `REQUIRED_TERM_SPLIT`: a locked or required target term crosses pieces.
- `TARGET_OVER_HARD`: target display width exceeds `hardUnits`.
- `SOURCE_SPAN_MISSING`: a target piece has no source range.
- `SOURCE_SPAN_GAP`: aligned source ranges do not cover the unit continuously.
- `SOURCE_SPAN_OVERLAP`: multiple pieces consume the same source unit.
- `SOURCE_SPAN_REVERSED`: a source range runs backward.
- `SOURCE_BOUNDARY_BLOCKED`: a used boundary is blocked.
- `SOURCE_BOUNDARY_RISKY`: a used boundary is risky.
- `ANCHOR_MISMATCH`: an anchor lies outside the source span paired with its target piece.
- `INVALID_TIMING`: derived cue timing overlaps, reverses, or is empty.
- `INTERNAL_MARKER`: generated text contains an internal batch marker.
- `SENTENCE_REVIEW_MISSING`: complete-sentence boundaries were not reviewed by the current Agent.
- `SOURCE_SENTENCE_IMPLAUSIBLE`: one claimed source sentence exceeds the current timed-unit or duration ceiling.
- `ALIGNMENT_REVIEW_MISSING`: Source Alignment was not reviewed as `agent-semantic` by the current Agent.
- `ALIGNMENT_CHANGED_AFTER_REVIEW`: a source span or bilingual anchor changed after the Agent review fingerprint was recorded.

Fail rendering on every hard defect. Keep a reason code and affected translation unit, piece, term, anchor, or timed-unit ID.

## Warnings

- `TARGET_OVER_FIT`: width is above fit but not hard.
- `FLASH_FRAGMENT`: duration is below the configured minimum without an explicit natural-short-utterance exception.
- `READING_RATE_HIGH`: display units per second exceed the writing-system profile.
- `ALIGNMENT_ASYMMETRIC`: source and target load is uneven but still semantically and temporally valid.

Warnings remain visible in the plan and UI. Do not regenerate a natural translation solely to remove visual imbalance.

## Linguistic review

The current Agent must review semantic boundaries, dangling syntax, bound phrases, named entities, shortening equivalence, language reordering, and every Source Alignment span. Deterministic validation still enforces schema, frozen integrity, reviewed fingerprints, ranges, widths, required terms, anchors, and timing. A supported cloud STT API may only supply audio transcription timing and cannot satisfy this linguistic review.
