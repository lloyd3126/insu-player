# Segmentation plan contract

`segmentation-plan.json` is a derived immutable-revision artifact. Its model transcript and completed schema-version 3 content manifest remain independent inputs.

```json
{
  "schemaVersion": 2,
  "contentMode": "translate",
  "sourceLanguage": "en",
  "outputLanguage": "zh-TW",
  "sourceTranscript": "transcript.json",
  "contentManifest": "translate-en-zh-TW.json",
  "languageModel": {"provider": "local", "model": "model-name"},
  "targetRevision": 1,
  "targetFrozen": true,
  "targetFingerprint": "sha256",
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
          "outputPieceId": "S0001-P02"
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

Before `targetFrozen`, edit output pieces and linguistic evidence only. After freezing, preserve `outputFullText`, piece IDs, text, count, and order. Populate only `sourceSpan`, anchors, and boundary evidence.

Piece spans must partition each parent content unit exactly. Cue start comes from the first timed unit and cue end from the last. Never store model-invented cue timestamps.
