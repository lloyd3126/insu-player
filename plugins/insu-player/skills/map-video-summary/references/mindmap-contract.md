# Mind-map contract

The source is exactly one current-schema `text` summary artifact for the same video.

The import request has this shape:

~~~json
{
  "kind": "mindmap",
  "languageCode": "en",
  "title": "Mind map title",
  "content": "# Root\n- Topic\n  - Detail",
  "sourceSummaryArtifactId": "video-text-en-r1"
}
~~~

Validation rules:

- exactly one root heading and it is the first non-empty node
- headings and list nodes only
- one to 120 nodes
- no more than four levels
- node label length is at most 160 characters
- no raw HTML, code blocks, images, embedded media, or external links
- time links use only `/player/VIDEO_ID?time=SECONDS`
- the Agent is recorded as `agent/codex`
- every revision has a checksum and explicit dependency
- no legacy map format or inferred source is accepted
