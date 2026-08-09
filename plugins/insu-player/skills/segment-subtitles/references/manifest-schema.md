# Segmentation plan contract

`segmentation-plan.json` is a derived, revisioned artifact. Its source transcript and completed translation manifest remain immutable inputs.

```json
{
  "schemaVersion": 1,
  "sourceLanguage": "en",
  "targetLanguage": "zh-TW",
  "targetRevision": 1,
  "targetFrozen": true,
  "targetFingerprint": "sha256",
  "languageModel": {"provider": "local", "model": "model-name"},
  "widthProfile": {
    "name": "cjk",
    "fitUnits": 40,
    "hardUnits": 56,
    "maxReadingUnitsPerSecond": 20.0
  },
  "timedUnits": [
    {"id": "U000001", "text": "Hello", "start": 1.0, "end": 1.4, "kind": "word"}
  ],
  "boundaryHints": [
    {"afterUnitId": "U000003", "state": "safe", "reasonCodes": ["SOURCE_CLAUSE_END"]}
  ],
  "translationUnits": [
    {
      "id": "S0001",
      "sourceUnitStart": "U000001",
      "sourceUnitEnd": "U000006",
      "sourceText": "Complete source sentence",
      "targetFullText": "完整自然翻譯",
      "requiredTerms": ["API"],
      "anchors": [
        {
          "sourceUnitStart": "U000004",
          "sourceUnitEnd": "U000004",
          "targetText": "API",
          "targetPieceId": "S0001-P02"
        }
      ],
      "pieces": [
        {
          "id": "S0001-P01",
          "targetText": "完整自然",
          "sourceSpan": {"startUnitId": "U000001", "endUnitId": "U000003"},
          "allowShortTiming": false
        }
      ]
    }
  ]
}
```

Use BCP 47 for languages. Treat `timedUnits` as language-neutral source timing; `kind` may be `word`, `token`, or `grapheme-group`. Do not infer whitespace-delimited words for every writing system.

Before `targetFrozen`, edit only target pieces and linguistic evidence. After freezing, preserve `targetFullText`, piece IDs, text, count, and order. Align only by populating `sourceSpan`, anchors, and boundary evidence.

Piece source spans must partition their parent translation unit exactly. Derive cue start from the first timed unit and cue end from the last timed unit. Never store model-invented cue timestamps.
