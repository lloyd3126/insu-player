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
      kind === "segmentation"
        ? '{"schemaVersion":3}\n'
        : '{"schemaVersion":4}\n',
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
    processor: { provider: "local", model: "medium" },
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
          dependencies: [{ artifactId: sourceId, relation: "timing-source" }],
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
          dependencies: [{ artifactId: sourceId, relation: "timing-source" }],
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
          dependencies: [{ artifactId: sourceId, relation: "timing-source" }],
        }),
        artifact(directory, "translation", newId, 2, [
          track(directory, newId, "en", "input_sentence", "source"),
          track(directory, newId, "de", "output_sentence", "Neu"),
        ], {
          sourceLanguage: "en",
          outputLanguage: "de",
          validationState: "invalid",
          hardDefectCount: 1,
          dependencies: [{ artifactId: sourceId, relation: "timing-source" }],
        }),
      ],
      explicitActiveTracks: {},
    })
    expect(catalog.activeTracks.find((track) => track.languageCode === "de")).toMatchObject({
      artifactKind: "translation",
      revision: 1,
    })
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
          dependencies: [{ artifactId: sourceId, relation: "timing-source" }],
        }),
      ],
      explicitActiveTracks: {},
    })
    expect(catalog.artifacts[1]?.processor).toEqual({
      provider: "agent",
      service: "codex",
      model: null,
    })
  })
})
