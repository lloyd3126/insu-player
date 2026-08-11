# Multilingual translation contract

## Language capability

Consume the detected source language from the model transcript. Ask the user only for the desired translated language in ordinary language, then resolve both sides to a structurally valid BCP 47 source/target pair. Do not ask the user to guess the source language or provide codes. Before execution, verify that local Whisper or the explicitly authorized supported cloud STT contract supports the spoken source language and returned usable word timing, and that the current Agent can reliably translate into the requested target language. Report unsupported or uncertain coverage instead of substituting English or Traditional Chinese. Do not delegate subtitle text to another API model.

Use `und` only while source language is genuinely unresolved. Resolve it before final translation. Preserve region and script subtags such as `pt-BR`, `zh-Hant`, `sr-Latn`, and `sr-Cyrl` when they affect wording or writing.

## Timed-unit contract

Use `word`, `token`, or `grapheme-group` as the source timing unit. Do not derive language semantics from whitespace alone. Stable timed-unit IDs must survive sentence reconstruction, translation, segmentation, and Source Alignment.

## Sentence reconstruction

Use punctuation and transcript segments as candidates, then have the current Agent review the full source-language context and every sentence boundary. Protect abbreviations, decimals, paired punctuation, code, URLs, names, and language-specific terminators. Preserve short natural utterances as complete units.

## Translation

Translate complete sentences with neighboring context. Preserve meaning, logic, names, numbers, glossary spellings, speaker stance, uncertainty, code, and sound labels. Natural target order has priority over source word order. Store raw punctuation and Unicode logical order.

For right-to-left scripts, never reverse stored strings. For scripts without whitespace word boundaries, do not inject spaces merely to simulate English tokens. For combining scripts, preserve grapheme clusters and canonical Unicode text.

## Output profiles

Keep raw source and target text unchanged in the manifest. `punctuationPolicy` controls only rendered display text:

- `preserve`: retain punctuation for any language pair;
- `remove-commas-periods`: replace `,`, `.`, `，`, and `。` with ASCII spaces for the existing INSU display convention.

Do not apply a language-specific output convention globally. Add a named profile and tests before supporting another transformation.
