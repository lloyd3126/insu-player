---
name: map-video-summary
description: Create, validate, and import a safe versioned Markmap mind map for one INSU Player video from a specific existing text-summary artifact. Use when the user asks for a mind map, concept map, visual outline, or a new mind-map revision. Do not use it to summarize subtitles directly or to create subtitles or notes.
---

# Map an INSU Player Summary

Turn one validated text-summary revision into a safe Markmap tree.

## Establish the source

1. Resolve the current project root, its project-local workspace, exact video ID, and running same-origin INSU Player URL. Never search another project.
2. Read [references/mindmap-contract.md](references/mindmap-contract.md) completely.
3. Read the current summary catalog and the exact `text` summary artifact named in the prompt. Do not read subtitles directly or silently substitute another summary revision.

## Build the map

- The current Agent is the content processor. Do not call an external API.
- Preserve the selected summary's meaning and hierarchy. Do not add conclusions that are absent from the text summary.
- Produce Markdown with exactly one level-one root heading, at most four hierarchy levels, and at most 120 non-empty nodes.
- Use headings and two-space-indented list items only.
- Do not include raw HTML, images, embedded media, code blocks, or external links.
- Optional time links must target only `/player/VIDEO_ID?time=SECONDS` for the same video.

## Validate and import

Run the deterministic validator:

~~~bash
python3 plugins/insu-player/skills/map-video-summary/scripts/validate_mindmap.py \
  --kind mindmap \
  --video-id VIDEO_ID \
  --language LANGUAGE_TAG \
  --title TITLE \
  --source-summary-artifact-id SUMMARY_ID \
  --content-file MINDMAP_MARKDOWN
~~~

POST the emitted current-schema JSON to `/api/jobs/VIDEO_ID/summaries/import` on the already-running same-origin service. Do not write `app.db` or the job directory directly.

Every successful import creates a new immutable mind-map revision that depends on the exact text-summary revision. Never overwrite or delete an existing artifact. Do not add a fallback parser or compatibility path.

## Handoff

Report the video, exact source summary, new mind-map revision, node count, depth, validation result, and that no external API received summary text. Direct the user to `影片中心 → 詳細資訊 → 影音摘要`.
