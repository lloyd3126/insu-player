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

Fail rendering on every hard defect. Keep a reason code and affected translation unit, piece, term, anchor, or timed-unit ID.

## Warnings

- `TARGET_OVER_FIT`: width is above fit but not hard.
- `FLASH_FRAGMENT`: duration is below the configured minimum without an explicit natural-short-utterance exception.
- `READING_RATE_HIGH`: display units per second exceed the writing-system profile.
- `ALIGNMENT_ASYMMETRIC`: source and target load is uneven but still semantically and temporally valid.

Warnings remain visible in the plan and UI. Do not regenerate a natural translation solely to remove visual imbalance.

## Linguistic review

The selected local or authorized API language model must review semantic boundaries, dangling syntax, bound phrases, named entities, shortening equivalence, and language reordering. Deterministic validation must still enforce schema, frozen integrity, ranges, widths, required terms, anchors, and timing.
