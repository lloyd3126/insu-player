---
name: summarize-video
description: Create, validate, and import a versioned text summary for one INSU Player video from a specific validated complete-sentence proofread or translation subtitle artifact. Use when the user asks for a video summary, key points, structured overview, or a new summary revision. Do not use it for transcription, translation, subtitle segmentation, notes, or mind maps.
---

# Summarize an INSU Player Video

Create one traceable text-summary artifact without changing media or subtitles.

## Establish the source

1. Resolve the current project root, its project-local workspace, the exact video ID, and the running same-origin INSU Player URL. Never search another project for matching media.
2. Read [references/summary-contract.md](references/summary-contract.md) completely.
3. Read the current subtitle catalog through the local API. Select only the exact `proofread` or `translation` artifact named in the prompt. It must be `ready`, `valid`, and contain complete-sentence output.
4. Read that artifact's caption comparison through the local API. Do not use a source transcript, segmented subtitle, platform automatic caption, media description, or unrelated revision as the summary source.

## Write the summary

- The current Agent is the content processor. Do not call another API, upload subtitle text, or claim that Whisper produced the summary.
- Preserve the source meaning, qualifications, negation, numbers, names, conclusions, and uncertainty. Do not invent facts or silently merge conflicting claims.
- Produce useful Markdown with one title and a compact hierarchy. Prefer complete sentences and concise bullet lists.
- The output must be understandable without exposing artifact IDs, processor terms, or implementation details in the summary body.
- Keep the requested output language. If the prompt does not identify it, use the selected subtitle artifact's output language or source language.

## Validate and import

Run the deterministic validator before any import:

~~~bash
python3 plugins/insu-player/skills/summarize-video/scripts/validate_summary.py \
  --kind text \
  --video-id VIDEO_ID \
  --language LANGUAGE_TAG \
  --title TITLE \
  --source-subtitle-artifact-id ARTIFACT_ID \
  --content-file SUMMARY_MARKDOWN
~~~

The validator prints the exact current-schema JSON request. POST it to `/api/jobs/VIDEO_ID/summaries/import` on the already-running same-origin service. Do not write `app.db` or the job directory directly.

Import creates a new revision and makes it current only after validation succeeds. Never overwrite or delete an existing revision. If the API rejects the dependency or content, correct the draft and validate again. Do not add a compatibility path.

## Handoff

Report the video, source subtitle revision, summary language, new summary revision, validation result, and that no external API received subtitle text. Direct the user to `影片中心 → 詳細資訊 → 影音摘要`.
