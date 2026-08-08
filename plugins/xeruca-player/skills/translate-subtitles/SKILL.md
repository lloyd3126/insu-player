---
name: translate-subtitles
description: Translate a WebVTT subtitle track into Traditional Chinese while preserving every cue, timestamp, order, and valid VTT structure, then import it into an INSU Player job. Use for subtitle translation, bilingual caption preparation, a needs_translation job, or fixing an invalid translated VTT.
---

# Translate Subtitles

Produce a faithful `zh-TW` WebVTT track; do not summarize, merge away content, or change timing merely to improve prose.

## Workflow

1. Resolve the exact source VTT and read it completely. Prefer a human-authored source track, then a source-language automatic track, then a Whisper transcript.
2. Parse the header, optional metadata, cue identifiers, timestamps, cue settings, and text. Count cues before translation.
3. Translate only spoken text into natural Taiwanese Traditional Chinese. Preserve names, numbers, code, URLs, meaningful sound labels, and uncertainty. Do not fabricate inaudible content.
4. Preserve every timestamp, cue order, cue identifier, cue setting, and blank-line separator. Do not convert Traditional Chinese to Simplified Chinese.
5. Save UTF-8 WebVTT outside the source path. Compare cue counts and validate increasing, non-negative timestamps.
6. Import through the sibling canonical skill, which validates again and updates the durable job state:

```bash
../watch-video/scripts/import-caption.sh \
  WORKSPACE VIDEO_ID zh-TW translated.vtt \
  --source agent-translation --label '繁體中文'
```

For portable mode from the repository root, use `plugins/xeruca-player/skills/watch-video/scripts/import-caption.sh` and `.local/xeruca-player`.

## Guardrails

- Keep one output cue for each input cue unless the input itself is structurally invalid. If repair is needed, explain the exact change.
- Do not claim Whisper translated to Traditional Chinese; Whisper's translation task targets English.
- If the source is too long for one pass, translate contiguous cue ranges and concatenate only after verifying unique order and unchanged timestamps.
- Never overwrite the only source caption. The imported track must be a separate `zh-TW.vtt`.

Report source language/path, input and output cue counts, output path, validation result, imported job state, and any uncertain terms.
