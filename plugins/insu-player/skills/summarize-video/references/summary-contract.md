# Text summary contract

The summary source is exactly one current-schema subtitle artifact:

- kind: `proofread` or `translation`
- lifecycle: `ready`
- validation: `valid`
- content: complete sentences

The import request has this shape:

~~~json
{
  "kind": "text",
  "languageCode": "en",
  "title": "Summary title",
  "content": "# Summary title\n\nComplete summary text",
  "sourceSubtitleArtifactId": "artifact-video-proofread-en-en-r1"
}
~~~

Rules:

- `videoId`, language tag, and artifact ID use strict safe identifiers.
- content is UTF-8 Markdown, non-empty, and at most 250,000 bytes.
- the Agent is recorded as `agent/codex`.
- no remote images, embedded media, secret material, raw logs, or invented citations.
- each import is a new immutable revision with a checksum and explicit dependency.
- no legacy summary files, fallback database, or inferred dependency is accepted.
