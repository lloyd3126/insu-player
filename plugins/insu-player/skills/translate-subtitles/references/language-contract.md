# Multilingual translation contract

## Language capability

Accept any structurally valid BCP 47 source/target pair. Before execution, verify that the selected local or OpenAI transcription model supports the spoken source language with usable timed units and that the selected local model, authorized OpenAI model, or Agent supports translation into the requested target language. Report unsupported or uncertain coverage instead of substituting English or Traditional Chinese.

Use `und` only while source language is genuinely unresolved. Resolve it before final translation. Preserve region and script subtags such as `pt-BR`, `zh-Hant`, `sr-Latn`, and `sr-Cyrl` when they affect wording or writing.

## Timed-unit contract

Use `word`, `token`, or `grapheme-group` as the source timing unit. Do not derive language semantics from whitespace alone. Stable timed-unit IDs must survive sentence reconstruction, translation, segmentation, and Source Alignment.

## Sentence reconstruction

Use punctuation and transcript segments as candidates, then review with the selected source-language model. Protect abbreviations, decimals, paired punctuation, code, URLs, names, and language-specific terminators. Preserve short natural utterances as complete units.

## Translation

Translate complete sentences with neighboring context. Preserve meaning, logic, names, numbers, glossary spellings, speaker stance, uncertainty, code, and sound labels. Natural target order has priority over source word order. Store raw punctuation and Unicode logical order.

For right-to-left scripts, never reverse stored strings. For scripts without whitespace word boundaries, do not inject spaces merely to simulate English tokens. For combining scripts, preserve grapheme clusters and canonical Unicode text.

## Output profiles

Keep raw source and target text unchanged in the manifest. `punctuationPolicy` controls only rendered display text:

- `preserve`: retain punctuation for any language pair;
- `remove-commas-periods`: replace `,`, `.`, `，`, and `。` with ASCII spaces for the existing INSU display convention.

Do not apply a language-specific output convention globally. Add a named profile and tests before supporting another transformation.
