# Target-first subtitle segmentation policy

## Contents

1. Immutable inputs and priority
2. Target-first decision process
3. Safe and blocked cuts
4. Width and rewriting
5. Source Alignment
6. Timing and reading rhythm
7. Revisions and defect severity

## Immutable inputs and priority

Use a complete, natural target-language translation as the segmentation input. Do not translate pre-cut source fragments. Preserve meaning, negation, conditions, causality, numbers, entities, roles, speaker stance, glossary spellings, and locked terms.

Apply this priority:

1. semantic accuracy;
2. syntactic completeness;
3. names, terms, fixed phrases, and bound structures;
4. readability;
5. display width;
6. Source Alignment;
7. visual balance.

Do not add content merely to simplify alignment. Compression may remove redundancy or choose a shorter equivalent expression, but it belongs to the translation revision and must not change meaning.

## Target-first decision process

Use this order:

```text
complete source sentence
→ complete natural target translation
→ target-language semantic analysis
→ target pieces
→ frozen target revision
→ continuous source timed-unit spans
```

Never begin from platform cue breaks, source word count, source length, pauses, equal duration, or visual symmetry. A short source may need multiple target pieces; a long source may remain one target piece.

For each complete target sentence:

1. Identify clauses, predicates, arguments, modifiers, coordination, parentheticals, quotations, and named entities.
2. Mark fixed phrases, terminology, names, number-unit expressions, paired punctuation, and other bound ranges.
3. Find candidate seams at complete clauses, natural semantic transitions, completed parallel actions, or genuine language whitespace that is also syntactically safe.
4. Keep a piece intact when it fits.
5. When it exceeds fit, use a safe seam if available.
6. When it exceeds hard and no safe seam exists, return for a shorter equivalent translation.
7. Reject cuts that leave either side as a grammatical fragment or flash fragment.

## Safe and blocked cuts

A good break requires all of the following:

```text
SemanticBoundary
AND SyntaxCompleteLeft
AND SyntaxCompleteRight
AND NOT BreakBoundPhrase
AND NOT BreakNamedEntity
AND NOT BreakRequiredTerm
AND NOT RiskyOrBlockedBoundary
AND ReadableTiming
```

Do not split:

- determiners, quantities, classifiers, or strongly attached modifiers from their head;
- a transitive verb from a required object;
- a verb from a required result, direction, or complement;
- an incomplete copular, causative, disposal, prepositional, locative, modal, or connective frame;
- coordination such as A-and-B or a shared head from its coordinated modifiers;
- fixed phrases, idioms, technical terms, product names, people, companies, models, APIs, numbers and units, URLs, code, or glossary terms;
- short quoted, bracketed, or parenthetical names;
- a visible CJK/Latin spacing boundary that has no linguistic seam.

Punctuation is evidence, not authority. A list separator is not automatically safe. Paired punctuation should remain intact unless long content contains a genuine semantic boundary.

## Width and rewriting

`fitUnits` is the preferred width and `hardUnits` is the deterministic upper bound.

- `width <= fit`: normally keep the semantic unit intact.
- `fit < width <= hard`: split only at a safe seam; otherwise accept the complete unit and report a warning.
- `width > hard`: resolve by safe segmentation or by requesting a shorter translation revision.

Never cut at the nearest whitespace merely to satisfy width. Measure normalized Unicode grapheme display units through the configured writing-system profile, not source length or raw code-point count.

## Source Alignment

Align only after the target revision is frozen. Each target piece maps to one continuous source timed-unit range. Ranges must be chronological, non-overlapping, gap-free, and collectively cover the complete source translation unit.

Source pauses are optional hints and never override syntax. Source platform cues are not segmentation boundaries. Do not use a boundary classified as `risky` or `blocked`.

Keep names, terms, numbers, and other bilingual anchors in the same paired piece. When language reordering prevents a valid monotonic anchor mapping, revise or merge target cuts before freezing. If no valid plan satisfies meaning, hard width, and alignment, report the unresolved defect instead of corrupting target order or timing.

A substantial target piece should not map to an implausibly tiny source range. Use language-aware reading load and semantic evidence rather than a universal word-count ratio.

## Timing and reading rhythm

Reject overlapping or reversed timing. Report pieces below the minimum duration as `FLASH_FRAGMENT` unless a naturally short utterance is explicitly accepted. Report reading load above the profile threshold as `READING_RATE_HIGH`.

Do not merge or lengthen every naturally short utterance merely to normalize duration. Adjust only when a safe merge exists or the reading problem is objective.

## Revisions and defect severity

Freezing records a fingerprint of target wording, order, count, and cuts. Alignment may change source spans and evidence, not the target fingerprint.

- To revise only target cuts, open a new segmentation revision and clear alignment.
- To shorten or retranslate wording, create a new translation revision, then a new segmentation plan.
- Never silently mutate a frozen revision.

Hard defects must be fixed before rendering. Soft imperfections, including mild imbalance or natural mapping asymmetry below hard limits, should not trigger destructive regeneration.
