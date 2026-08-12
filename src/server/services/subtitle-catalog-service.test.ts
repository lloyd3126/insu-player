import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { resolveSubtitleCatalog } from "@server/services/subtitle-catalog-service"
import type {
  SubtitleArtifactKind,
  SubtitleArtifactTrack,
} from "@shared/contracts/subtitle-catalog"

const workspaces: string[] = []

function currentManifest(kind: Exclude<SubtitleArtifactKind, "source">) {
  if (kind === "segmentation") {
    return `${JSON.stringify({
      schemaVersion: 4,
      contentMode: "translate",
      sourceLanguage: "en",
      outputLanguage: "fr",
      sourceTranscript: "transcript.json",
      contentManifest: "content.json",
      sourceContentArtifactId: "source-r1",
      sourceContentKind: "model-transcript",
      timingProcessor: { provider: "local", service: "openai-whisper", model: "medium" },
      contentProcessor: { provider: "agent", service: "codex", updatedAt: "2026-08-09T00:00:00Z" },
      sentenceReview: { provider: "agent", service: "codex", reviewedAt: "2026-08-09T00:00:00Z" },
      segmentationProcessor: { provider: "agent", service: "codex", updatedAt: "2026-08-09T00:00:00Z" },
      alignmentMethod: "agent-semantic",
      alignmentReview: { provider: "agent", service: "codex", reviewedAt: "2026-08-09T00:00:00Z" },
      alignmentFingerprint: "0".repeat(64),
      targetRevision: 1,
      targetFrozen: true,
      targetFingerprint: "0".repeat(64),
      targetFrozenAt: "2026-08-09T00:00:00Z",
      widthProfile: {},
      timingProfile: {},
      outputProfile: {},
      timedUnits: [],
      boundaryHints: [],
      contentUnits: [],
    })}\n`
  }
  return `${JSON.stringify({
    schemaVersion: 5,
    mode: kind === "translation" ? "translate" : "proofread",
    sourceFormat: "model-timed-units",
    sourceLanguage: "en",
    outputLanguage: kind === "proofread" ? "en" : "fr",
    sourceTranscript: "transcript.json",
    timingSourceArtifactId: "source-r1",
    sourceContentArtifactId: "source-r1",
    sourceContentKind: "model-transcript",
    sourceContentManifest: null,
    sourceContentChecksum: null,
    referenceArtifactIds: [],
    timingProcessor: { provider: "local", service: "openai-whisper", model: "medium" },
    contentProcessor: { provider: "agent", service: "codex", updatedAt: "2026-08-09T00:00:00Z" },
    sentenceReview: { provider: "agent", service: "codex", reviewedAt: "2026-08-09T00:00:00Z" },
    outputProfile: {},
    rules: {},
    segments: [],
  })}\n`
}

function workspace() {
  const directory = mkdtempSync(path.join(tmpdir(), "insu-subtitle-catalog-"))
  workspaces.push(directory)
  return directory
}

function track(
  directory: string,
  artifactId: string,
  languageCode: string,
  role: SubtitleArtifactTrack["role"],
  text: string,
) {
  const relativePath = `subtitle-work/artifacts/${artifactId}/${role}.vtt`
  mkdirSync(path.dirname(path.join(directory, relativePath)), { recursive: true })
  writeFileSync(
    path.join(directory, relativePath),
    `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${text}\n`,
  )
  return {
    id: `${artifactId}-${role}`,
    languageCode,
    role,
    state: "ready",
    path: relativePath,
    checksum: createHash("sha256")
      .update(readFileSync(path.join(directory, relativePath)))
      .digest("hex"),
    updatedAt: "2026-08-09T00:00:01Z",
  }
}

function artifact(
  directory: string,
  kind: SubtitleArtifactKind,
  id: string,
  revision: number,
  tracks: Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {},
) {
  const manifestPath =
    kind === "source" ? null : `subtitle-work/artifacts/${id}/manifest.json`
  if (manifestPath) {
    writeFileSync(
      path.join(directory, manifestPath),
      currentManifest(kind as Exclude<SubtitleArtifactKind, "source">),
    )
  }
  const artifactHasher = createHash("sha256")
  for (const artifactTrack of tracks) {
    artifactHasher.update(String(artifactTrack.languageCode), "utf8")
    artifactHasher.update(String(artifactTrack.checksum), "ascii")
  }
  if (manifestPath) {
    artifactHasher.update(
      createHash("sha256")
        .update(readFileSync(path.join(directory, manifestPath)))
        .digest(),
    )
  }
  const source = kind === "source"
  return {
    id,
    kind,
    revision,
    lifecycleState: "ready",
    validationState: "valid",
    freshnessState: "current",
    sourceLanguage: tracks[0]?.languageCode,
    outputLanguage: source ? null : tracks[1]?.languageCode,
    sourceType: source ? "model-transcript" : null,
    processor: source
      ? { provider: "local", service: "openai-whisper", model: "medium" }
      : { provider: "agent", service: "codex" },
    timingUnitKind: source ? "word" : null,
    targetFrozen: kind === "segmentation",
    manifestPath,
    checksum: artifactHasher.digest("hex"),
    warningCount: 0,
    hardDefectCount: 0,
    dependencies: [],
    tracks,
    createdAt: "2026-08-09T00:00:00Z",
    completedAt: "2026-08-09T00:00:01Z",
    ...overrides,
  }
}

function rewriteArtifactManifest(
  directory: string,
  rawArtifact: Record<string, unknown>,
  mutate: (manifest: Record<string, unknown>) => void,
) {
  const manifestPath = String(rawArtifact.manifestPath)
  const absolutePath = path.join(directory, manifestPath)
  const manifest = JSON.parse(readFileSync(absolutePath, "utf8")) as Record<
    string,
    unknown
  >
  mutate(manifest)
  writeFileSync(absolutePath, `${JSON.stringify(manifest)}\n`)
  const artifactHasher = createHash("sha256")
  for (const rawTrack of rawArtifact.tracks as Array<Record<string, unknown>>) {
    artifactHasher.update(String(rawTrack.languageCode), "utf8")
    artifactHasher.update(String(rawTrack.checksum), "ascii")
  }
  artifactHasher.update(
    createHash("sha256").update(readFileSync(absolutePath)).digest(),
  )
  rawArtifact.checksum = artifactHasher.digest("hex")
}

afterEach(() => {
  for (const directory of workspaces.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("subtitle catalog resolver", () => {
  test("selects validated segmentation output for arbitrary languages", () => {
    const directory = workspace()
    const sourceId = "source-r1"
    const translationId = "translation-r1"
    const segmentationId = "segmentation-r1"
    const catalog = resolveSubtitleCatalog({
      videoId: "demo",
      jobDirectory: directory,
      rawArtifacts: [
        artifact(directory, "source", sourceId, 1, [
          track(directory, sourceId, "ar", "source_raw", "مرحبا بالعالم"),
        ], {
          timingUnitKind: "grapheme-group",
        }),
        artifact(directory, "translation", translationId, 1, [
          track(directory, translationId, "ar", "input_sentence", "مرحبا بالعالم"),
          track(directory, translationId, "fr", "output_sentence", "Bonjour le monde"),
        ], {
          sourceLanguage: "ar",
          outputLanguage: "fr",
          dependencies: [
            { artifactId: sourceId, relation: "timing-source" },
            { artifactId: sourceId, relation: "content-source" },
          ],
        }),
        artifact(directory, "segmentation", segmentationId, 1, [
          track(directory, segmentationId, "ar", "input_segmented", "مرحبا بالعالم"),
          track(directory, segmentationId, "fr", "output_segmented", "Bonjour le monde"),
        ], {
          sourceLanguage: "ar",
          outputLanguage: "fr",
          dependencies: [
            { artifactId: sourceId, relation: "timing-source" },
            { artifactId: translationId, relation: "content-parent" },
          ],
        }),
      ],
      explicitActiveTracks: {},
    })

    expect(catalog.availableLanguageCodes).toEqual(["ar", "fr"])
    expect(catalog.activeTracks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ languageCode: "fr", artifactKind: "segmentation" }),
        expect.objectContaining({ languageCode: "ar", artifactKind: "source" }),
      ]),
    )
    expect(
      catalog.playbackLanguages.flatMap((language) =>
        language.options.map((option) => option.label),
      ),
    ).toEqual(
      expect.arrayContaining(["ar · 模型轉錄 · r1", "fr · 切分字幕 · r1"]),
    )
  })

  test("keeps a same-language proofread input and output as separate tracks", () => {
    const directory = workspace()
    const sourceId = "source-en-r1"
    const proofreadId = "proofread-en-r1"
    const catalog = resolveSubtitleCatalog({
      videoId: "demo",
      jobDirectory: directory,
      rawArtifacts: [
        artifact(directory, "source", sourceId, 1, [
          track(directory, sourceId, "en", "source_raw", "raw words"),
        ]),
        artifact(directory, "proofread", proofreadId, 1, [
          track(directory, proofreadId, "en", "input_sentence", "raw words"),
          track(directory, proofreadId, "en", "output_sentence", "Corrected words"),
        ], {
          outputLanguage: "en",
          dependencies: [
            { artifactId: sourceId, relation: "timing-source" },
            { artifactId: sourceId, relation: "content-source" },
          ],
        }),
      ],
      explicitActiveTracks: {},
    })

    expect(catalog.artifacts[1]?.tracks).toHaveLength(2)
    expect(catalog.activeTracks[0]).toMatchObject({
      id: `${proofreadId}-output_sentence`,
      artifactKind: "proofread",
    })
  })

  test("accepts proofreading as translation content while retaining model timing", () => {
    const directory = workspace()
    const sourceId = "source-en-r1"
    const proofreadId = "proofread-en-r1"
    const translationId = "translation-de-r1"
    const catalog = resolveSubtitleCatalog({
      videoId: "demo",
      jobDirectory: directory,
      rawArtifacts: [
        artifact(directory, "source", sourceId, 1, [
          track(directory, sourceId, "en", "source_raw", "raw words"),
        ]),
        artifact(directory, "proofread", proofreadId, 1, [
          track(directory, proofreadId, "en", "input_sentence", "raw words"),
          track(directory, proofreadId, "en", "output_sentence", "Corrected words"),
        ], {
          outputLanguage: "en",
          dependencies: [
            { artifactId: sourceId, relation: "timing-source" },
            { artifactId: sourceId, relation: "content-source" },
          ],
        }),
        artifact(directory, "translation", translationId, 1, [
          track(directory, translationId, "en", "input_sentence", "Corrected words"),
          track(directory, translationId, "de", "output_sentence", "Korrigierte Wörter"),
        ], {
          sourceLanguage: "en",
          outputLanguage: "de",
          dependencies: [
            { artifactId: sourceId, relation: "timing-source" },
            { artifactId: proofreadId, relation: "content-source" },
          ],
        }),
      ],
      explicitActiveTracks: {},
    })

    expect(
      catalog.activeTracks.find((track) => track.languageCode === "de"),
    ).toMatchObject({ artifactKind: "translation", revision: 1 })
  })

  test("prefers manual CC to model raw captions but lets explicit choice win", () => {
    const directory = workspace()
    const modelId = "model-source"
    const manualId = "manual-source"
    const modelTrack = track(directory, modelId, "en", "source_raw", "model")
    const manualTrack = track(directory, manualId, "en", "source_raw", "manual")
    const artifacts = [
      artifact(directory, "source", modelId, 1, [modelTrack]),
      artifact(directory, "source", manualId, 1, [manualTrack], {
        sourceType: "manual-cc",
        processor: { provider: "yt-dlp" },
        timingUnitKind: "cue",
      }),
    ]
    const automatic = resolveSubtitleCatalog({
      videoId: "demo",
      jobDirectory: directory,
      rawArtifacts: artifacts,
      explicitActiveTracks: {},
    })
    expect(automatic.activeTracks[0]).toMatchObject({
      id: manualTrack.id,
      reason: "resolver",
    })

    const explicit = resolveSubtitleCatalog({
      videoId: "demo",
      jobDirectory: directory,
      rawArtifacts: artifacts,
      explicitActiveTracks: { en: modelTrack.id },
    })
    expect(explicit.activeTracks[0]).toMatchObject({
      id: modelTrack.id,
      reason: "explicit",
    })
  })

  test("does not let unfinished or invalid newer output replace a valid version", () => {
    const directory = workspace()
    const sourceId = "source-r1"
    const oldId = "translation-r1"
    const newId = "translation-r2"
    const catalog = resolveSubtitleCatalog({
      videoId: "demo",
      jobDirectory: directory,
      rawArtifacts: [
        artifact(directory, "source", sourceId, 1, [
          track(directory, sourceId, "en", "source_raw", "source"),
        ]),
        artifact(directory, "translation", oldId, 1, [
          track(directory, oldId, "en", "input_sentence", "source"),
          track(directory, oldId, "de", "output_sentence", "Alt"),
        ], {
          sourceLanguage: "en",
          outputLanguage: "de",
          dependencies: [
            { artifactId: sourceId, relation: "timing-source" },
            { artifactId: sourceId, relation: "content-source" },
          ],
        }),
        artifact(directory, "translation", newId, 2, [
          track(directory, newId, "en", "input_sentence", "source"),
          track(directory, newId, "de", "output_sentence", "Neu"),
        ], {
          sourceLanguage: "en",
          outputLanguage: "de",
          validationState: "invalid",
          hardDefectCount: 1,
          dependencies: [
            { artifactId: sourceId, relation: "timing-source" },
            { artifactId: sourceId, relation: "content-source" },
          ],
        }),
      ],
      explicitActiveTracks: {},
    })
    expect(catalog.activeTracks.find((track) => track.languageCode === "de")).toMatchObject({
      artifactKind: "translation",
      revision: 1,
    })
  })

  test("isolates an invalid superseded manifest without blocking the current revision", () => {
    const directory = workspace()
    const sourceId = "source-r1"
    const translationId = "translation-r1"
    const oldId = "segmentation-r1"
    const currentId = "segmentation-r2"
    const source = artifact(directory, "source", sourceId, 1, [
      track(directory, sourceId, "en", "source_raw", "source"),
    ])
    const translation = artifact(directory, "translation", translationId, 1, [
      track(directory, translationId, "en", "input_sentence", "source"),
      track(directory, translationId, "fr", "output_sentence", "cible"),
    ], {
      sourceLanguage: "en",
      outputLanguage: "fr",
      dependencies: [
        { artifactId: sourceId, relation: "timing-source" },
        { artifactId: sourceId, relation: "content-source" },
      ],
    })
    const segmentationDependencies = [
      { artifactId: sourceId, relation: "timing-source" },
      { artifactId: translationId, relation: "content-parent" },
    ]
    const oldRevision = artifact(directory, "segmentation", oldId, 1, [
      track(directory, oldId, "en", "input_segmented", "source"),
      track(directory, oldId, "fr", "output_segmented", "ancien"),
    ], {
      sourceLanguage: "en",
      outputLanguage: "fr",
      freshnessState: "superseded",
      dependencies: segmentationDependencies,
    })
    rewriteArtifactManifest(directory, oldRevision, (manifest) => {
      manifest.unknownField = true
    })
    const currentRevision = artifact(directory, "segmentation", currentId, 2, [
      track(directory, currentId, "en", "input_segmented", "source"),
      track(directory, currentId, "fr", "output_segmented", "actuel"),
    ], {
      sourceLanguage: "en",
      outputLanguage: "fr",
      dependencies: segmentationDependencies,
    })

    const catalog = resolveSubtitleCatalog({
      videoId: "demo",
      jobDirectory: directory,
      rawArtifacts: [source, translation, oldRevision, currentRevision],
      explicitActiveTracks: {},
    })

    expect(catalog.artifacts.find(({ id }) => id === oldId)).toMatchObject({
      validationState: "invalid",
      freshnessState: "superseded",
      schemaError: expect.stringContaining("fields do not match"),
    })
    expect(catalog.activeTracks.find(({ languageCode }) => languageCode === "fr"))
      .toMatchObject({ artifactId: currentId, revision: 2 })
  })

  test("rejects a current segmentation manifest missing a required field", () => {
    const directory = workspace()
    const artifactId = "segmentation-r1"
    const current = artifact(directory, "segmentation", artifactId, 1, [
      track(directory, artifactId, "en", "input_segmented", "source"),
      track(directory, artifactId, "fr", "output_segmented", "cible"),
    ])
    rewriteArtifactManifest(directory, current, (manifest) => {
      delete manifest.targetFrozenAt
    })

    expect(() =>
      resolveSubtitleCatalog({
        videoId: "demo",
        jobDirectory: directory,
        rawArtifacts: [current],
        explicitActiveTracks: {},
      }),
    ).toThrow("fields do not match the current schema")
  })

  test("rejects checksum mismatches instead of adapting the track", () => {
    const directory = workspace()
    const artifactId = "source-r1"
    const sourceTrack = track(directory, artifactId, "es", "source_raw", "Texto")
    expect(() =>
      resolveSubtitleCatalog({
        videoId: "demo",
        jobDirectory: directory,
        rawArtifacts: [
          artifact(directory, "source", artifactId, 1, [
            { ...sourceTrack, checksum: "0".repeat(64) },
          ]),
        ],
        explicitActiveTracks: {},
      }),
    ).toThrow("checksum mismatch")
  })

  test("accepts Agent content and segmentation processors with an explicit service", () => {
    const directory = workspace()
    const sourceId = "source-r1"
    const proofreadId = "proofread-r1"
    const catalog = resolveSubtitleCatalog({
      videoId: "demo",
      jobDirectory: directory,
      rawArtifacts: [
        artifact(directory, "source", sourceId, 1, [
          track(directory, sourceId, "en", "source_raw", "source"),
        ]),
        artifact(directory, "proofread", proofreadId, 1, [
          track(directory, proofreadId, "en", "input_sentence", "source"),
          track(directory, proofreadId, "en", "output_sentence", "Source"),
        ], {
          outputLanguage: "en",
          processor: { provider: "agent", service: "codex" },
          dependencies: [
            { artifactId: sourceId, relation: "timing-source" },
            { artifactId: sourceId, relation: "content-source" },
          ],
        }),
      ],
      explicitActiveTracks: {},
    })
    expect(catalog.artifacts[1]?.processor).toEqual({
      provider: "agent",
      service: "codex",
    })
  })

  test("rejects non-Agent processors for derived subtitle revisions", () => {
    const directory = workspace()
    const sourceId = "source-en-r1"
    const translationId = "translation-en-fr-r1"
    expect(() =>
      resolveSubtitleCatalog({
        videoId: "demo",
        jobDirectory: directory,
        rawArtifacts: [
          artifact(directory, "source", sourceId, 1, [
            track(directory, sourceId, "en", "source_raw", "source"),
          ]),
          artifact(directory, "translation", translationId, 1, [
            track(directory, translationId, "en", "input_sentence", "source"),
            track(directory, translationId, "fr", "output_sentence", "cible"),
          ], {
            processor: {
              provider: "openai",
              service: "audio/transcriptions",
              model: "whisper-1",
            },
            sourceLanguage: "en",
            outputLanguage: "fr",
            dependencies: [
              { artifactId: sourceId, relation: "timing-source" },
              { artifactId: sourceId, relation: "content-source" },
            ],
          }),
        ],
        explicitActiveTracks: {},
      }),
    ).toThrow("subtitle revisions must use agent / codex")
  })

  test("rejects tracks without the current updatedAt field", () => {
    const directory = workspace()
    const sourceId = "source-r1"
    const oldTrack = track(
      directory,
      sourceId,
      "en",
      "source_raw",
      "Hello",
    ) as Record<string, unknown>
    delete oldTrack.updatedAt
    expect(() =>
      resolveSubtitleCatalog({
        videoId: "demo",
        jobDirectory: directory,
        rawArtifacts: [artifact(directory, "source", sourceId, 1, [oldTrack])],
        explicitActiveTracks: {},
      }),
    ).toThrow("current schema")
  })

  test("rejects an older content manifest schema", () => {
    const directory = workspace()
    const sourceId = "source-r1"
    const translationId = "translation-r1"
    const source = artifact(directory, "source", sourceId, 1, [
      track(directory, sourceId, "en", "source_raw", "Hello"),
    ])
    const translation = artifact(directory, "translation", translationId, 1, [
      track(directory, translationId, "en", "input_sentence", "Hello"),
      track(directory, translationId, "fr", "output_sentence", "Bonjour"),
    ], {
      sourceLanguage: "en",
      outputLanguage: "fr",
      processor: { provider: "agent", service: "codex" },
      dependencies: [
        { artifactId: sourceId, relation: "timing-source" },
        { artifactId: sourceId, relation: "content-source" },
      ],
    })
    writeFileSync(
      path.join(
        directory,
        "subtitle-work",
        "artifacts",
        translationId,
        "manifest.json",
      ),
      '{"schemaVersion":4}\n',
    )
    expect(() =>
      resolveSubtitleCatalog({
        videoId: "demo",
        jobDirectory: directory,
        rawArtifacts: [source, translation],
        explicitActiveTracks: {},
      }),
    ).toThrow("must use schemaVersion 5")
  })
})
