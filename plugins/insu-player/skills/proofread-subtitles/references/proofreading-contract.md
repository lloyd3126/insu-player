# Same-language subtitle proofreading contract

## Language and timing

Consume the detected source language from the model transcript and resolve it to identical valid BCP 47 source and output tags. Do not ask the user to guess the language or supply codes. Clarify with an ordinary language name only when detection is unreliable, speech is multilingual, or script and region materially affect spelling or wording. Preserve script and region subtags when they matter. Use `word`, `token`, or `grapheme-group` model timing. Never claim word-accurate alignment from platform cue timing.

## Allowed corrections

- recognition errors supported by audio or a matching manual CC track;
- names, products, APIs, code, numbers, casing, punctuation, and terminology;
- conservative complete-sentence reconstruction;
- removal of transcription artifacts that carry no spoken meaning.

## Forbidden changes

- translation or script conversion not requested by the user;
- summary, paraphrase for style alone, added explanation, or invented content;
- changed negation, conditions, causality, roles, uncertainty, numbers, or speaker stance;
- wording copied from a mismatched, incomplete, or automatic platform caption.

## Writing systems

Do not infer word boundaries from whitespace alone. Preserve Unicode logical order for RTL scripts, grapheme clusters for combining scripts, and natural text for scripts without reliable spaces. Schema acceptance does not prove model capability; verify the selected model before execution.

## Manual CC evidence

A creator-provided CC track is a high-value spelling and terminology reference, not timing authority. When CC and ASR align confidently, correct text while retaining the mapped model-timed unit span. When they conflict materially, preserve the audio-backed source and report the uncertain passage.
