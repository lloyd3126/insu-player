# Segmentation plan contract

`segmentation-plan.json` is a schema-version 4 derived immutable-revision artifact. Its model transcript and completed schema-version 5 content manifest remain independent inputs.

```json
{
  "schemaVersion": 4,
  "contentMode": "translate",
  "sourceLanguage": "en",
  "outputLanguage": "zh-TW",
  "sourceTranscript": "transcript.json",
  "contentManifest": "translate-en-zh-TW.json",
  "sourceContentArtifactId": "artifact-video-proofread-en-en-r1",
  "sourceContentKind": "proofread",
  "timingProcessor": {"provider": "local", "service": "openai-whisper", "model": "medium"},
  "contentProcessor": {"provider": "agent", "service": "codex", "updatedAt": "2026-08-10T00:00:00Z"},
  "sentenceReview": {"provider": "agent", "service": "codex", "reviewedAt": "2026-08-10T00:00:00Z"},
  "segmentationProcessor": {"provider": "agent", "service": "codex"},
  "alignmentMethod": "agent-semantic",
  "alignmentReview": {"provider": "agent", "service": "codex", "reviewedAt": "2026-08-10T00:10:00Z"},
  "alignmentFingerprint": "sha256",
  "targetRevision": 1,
  "targetFrozen": true,
  "targetFingerprint": "sha256",
  "targetFrozenAt": "2026-08-10T00:05:00Z",
  "widthProfile": {
    "name": "cjk",
    "fitUnits": 40,
    "hardUnits": 56,
    "maxReadingUnitsPerSecond": 20.0
  },
  "timingProfile": {"minimumPieceMilliseconds": 800},
  "timedUnits": [
    {"id": "U000001", "text": "Hello", "start": 1.0, "end": 1.4, "kind": "word"}
  ],
  "boundaryHints": [
    {"afterUnitId": "U000003", "state": "safe", "reasonCodes": ["SOURCE_CLAUSE_END"]}
  ],
  "contentUnits": [
    {
      "id": "S0001",
      "sourceUnitStart": "U000001",
      "sourceUnitEnd": "U000006",
      "sourceText": "Complete source sentence",
      "outputFullText": "完整自然翻譯",
      "requiredTerms": ["API"],
      "anchors": [
        {
          "sourceUnitStart": "U000004",
          "sourceUnitEnd": "U000004",
          "outputText": "API",
          "targetPieceId": "S0001-P02"
        }
      ],
      "pieces": [
        {
          "id": "S0001-P01",
          "outputText": "完整自然",
          "sourceSpan": {"startUnitId": "U000001", "endUnitId": "U000003"},
          "allowShortTiming": false
        }
      ]
    }
  ]
}
```

Use BCP 47 language codes. `contentMode` is `proofread` or `translate`. `timedUnits.kind` is `word`, `token`, or `grapheme-group`; do not infer whitespace-delimited words for every writing system.

`sourceContentKind` is `model-transcript` or `proofread`. Proofreading always uses its model transcript as both content and timing source. Translation may use either the model transcript directly or a validated proofread artifact as its content source. `timingProcessor` and timed units always remain tied to the original model transcript.

`timingProcessor` must exactly match one current word-timing contract: local Whisper, OpenAI `whisper-1`, Groq `whisper-large-v3` or `whisper-large-v3-turbo`, ElevenLabs `scribe_v2`, xAI `/v1/stt`, or OpenRouter `openai/whisper-large-v3`. Every identity records `provider`, `service`, and nullable `model`. `contentProcessor` and `segmentationProcessor` must both record exactly `provider: agent`, `service: codex`, and their own `updatedAt` timestamp. `sentenceReview` records the Agent review of complete-sentence boundaries. `alignmentMethod` must be `agent-semantic`, and `alignmentReview` plus `alignmentFingerprint` prove the finalized source spans and anchors were reviewed after editing. Never infer or copy one processor to fill another role.

Before `targetFrozen`, edit output pieces and linguistic evidence only. After freezing, preserve `outputFullText`, piece IDs, text, count, and order. Populate only `sourceSpan`, anchors, and boundary evidence.

`targetFrozenAt` is required on every frozen schema-version 4 manifest and records when the immutable target revision was created. Draft plans omit it. Producer, import, and server validation all read the exact field set from `plugins/insu-player/contracts/subtitle-manifest-contract.json`; unknown or missing fields fail the current contract.

Piece spans must partition each parent content unit exactly. Cue start comes from the first timed unit and cue end from the last. Never store model-invented cue timestamps.

Do not generate Source Alignment through word-count, duration, display-width, or proportional allocation. The current Agent must read source and output meaning, assign spans, record bilingual anchors, and then run `record-alignment-review`. Any later span or anchor edit invalidates the recorded fingerprint.
