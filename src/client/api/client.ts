import type { CaptionComparisonResponse } from "@shared/contracts/caption"
import type {
  JobDetail,
  JobLogResponse,
  JobsResponse,
  PlaybackState,
} from "@shared/contracts/job"
import type {
  AgentIntentResponse,
  PromptLibraryResponse,
  SupportedSitesResponse,
  RuntimeStatusResponse,
  CloudTranscriptionProvider,
  TranscriptionModelCatalogResponse,
  TranscriptionModelDetailResponse,
} from "@shared/contracts/resources"
import type {
  CreateLocalMediaImportRequest,
  CreateLocalMediaImportResponse,
  CreateLibraryItemsRequest,
  CreateLibraryItemsResponse,
  DownloadSourceInput,
  LibraryResponse,
} from "@shared/contracts/library"
import type {
  SubtitleStylePreferences,
  SubtitleStyleResponse,
} from "@shared/contracts/subtitle-style"
import type {
  ExtensionPairingStatus,
} from "@shared/contracts/browser-extension"
import type {
  SummaryArtifactKind,
  SummaryArtifactResponse,
  SummaryCatalogResponse,
  SummaryImportRequest,
} from "@shared/contracts/summary"
import type {
  SubtitleArtifactComparisonResponse,
  SubtitleCatalogResponse,
} from "@shared/contracts/subtitle-catalog"
import type {
  RemovalExecutionResponse,
  RemovalPreviewResponse,
  RemovalTarget,
} from "@shared/contracts/removal"
import type {
  MediaCatalogResponse,
  MediaDownloadResponse,
} from "@shared/contracts/media"
import type {
  SaveVideoNoteRequest,
  VideoNotesResponse,
} from "@shared/contracts/notes"

async function fetchJson<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, { cache: "no-store", ...init })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    let payload: { error?: unknown } | null = null
    try {
      payload = JSON.parse(body) as { error?: unknown }
    } catch {
      // Fall through to the response body when it is not JSON.
    }
    if (typeof payload?.error === "string") throw new Error(payload.error)
    throw new Error(body || `HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

async function fetchDownload(input: string, init?: RequestInit) {
  const response = await fetch(input, { cache: "no-store", ...init })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(body || `HTTP ${response.status}`)
  }
  const disposition = response.headers.get("content-disposition") ?? ""
  const filename = disposition.match(/filename="([^"]+)"/)?.[1]
  if (!filename) throw new Error("伺服器沒有提供下載檔名")
  return {
    blob: await response.blob(),
    filename,
    checksum: response.headers.get("x-insu-package-sha256"),
  }
}

export const api = {
  health: () =>
    fetchJson<{
      ok: boolean
      runtime: string
      framework: string
      database: string
      port: number
    }>("/api/health"),
  jobs: () => fetchJson<JobsResponse>("/api/jobs"),
  job: (videoId: string) =>
    fetchJson<JobDetail>(`/api/jobs/${encodeURIComponent(videoId)}`),
  jobLog: (videoId: string) =>
    fetchJson<JobLogResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/log?lines=180`,
    ),
  captions: (videoId: string) =>
    fetchJson<CaptionComparisonResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/captions`,
    ),
  subtitles: (videoId: string) =>
    fetchJson<SubtitleCatalogResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/subtitles`,
    ),
  activateSubtitle: (
    videoId: string,
    languageCode: string,
    trackId: string,
  ) =>
    fetchJson<SubtitleCatalogResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/subtitles/active`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ languageCode, trackId }),
      },
    ),
  media: (videoId: string) =>
    fetchJson<MediaCatalogResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/media`,
    ),
  refreshMedia: (videoId: string) =>
    fetchJson<MediaCatalogResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/media/refresh`,
      { method: "POST" },
    ),
  downloadMedia: (videoId: string, height: number) =>
    fetchJson<MediaDownloadResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/media/renditions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ height }),
      },
    ),
  activateMedia: (videoId: string, renditionId: string) =>
    fetchJson<MediaCatalogResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/media/active`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ renditionId }),
      },
    ),
  subtitleArtifactCaptions: (videoId: string, artifactId: string) =>
    fetchJson<SubtitleArtifactComparisonResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/subtitles/artifacts/${encodeURIComponent(artifactId)}/captions`,
    ),
  savePlayback: (
    videoId: string,
    playback: Partial<
      Pick<PlaybackState, "time" | "duration" | "captionLanguage">
    >,
  ) =>
    fetchJson<PlaybackState>(
      `/api/jobs/${encodeURIComponent(videoId)}/playback`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(playback),
      },
    ),
  models: () => fetchJson<TranscriptionModelCatalogResponse>("/api/models"),
  model: (modelId: string) =>
    fetchJson<TranscriptionModelDetailResponse>(
      `/api/models/${encodeURIComponent(modelId)}`,
    ),
  runtime: () => fetchJson<RuntimeStatusResponse>("/api/runtime"),
  recordAgentIntent: (kind: string, source: string, videoId?: string) =>
    fetchJson<AgentIntentResponse>("/api/agent-intents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, source, ...(videoId ? { videoId } : {}) }),
    }),
  library: () => fetchJson<LibraryResponse>("/api/library"),
  createLocalMediaImport: (payload: CreateLocalMediaImportRequest) =>
    fetchJson<CreateLocalMediaImportResponse>("/api/library/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  uploadLocalMediaImport: (
    uploadUrl: string,
    file: File,
    onProgress: (progress: number) => void,
  ) =>
    new Promise<{ accepted: true; importId: string; videoId: string }>(
      (resolve, reject) => {
        const request = new XMLHttpRequest()
        request.open("PUT", uploadUrl)
        request.setRequestHeader("Content-Type", file.type || "application/octet-stream")
        request.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) onProgress((event.loaded / event.total) * 100)
        })
        request.addEventListener("load", () => {
          if (request.status >= 200 && request.status < 300) {
            resolve(JSON.parse(request.responseText))
            return
          }
          try {
            const payload = JSON.parse(request.responseText) as { error?: unknown }
            reject(new Error(typeof payload.error === "string" ? payload.error : `HTTP ${request.status}`))
          } catch {
            reject(new Error(request.responseText || `HTTP ${request.status}`))
          }
        })
        request.addEventListener("error", () => reject(new Error("本機影音上傳中斷")))
        request.send(file)
      },
    ),
  removeLocalMediaImport: (importId: string) =>
    fetchJson<LibraryResponse>(
      `/api/library/imports/${encodeURIComponent(importId)}`,
      { method: "DELETE" },
    ),
  subtitleStyles: () =>
    fetchJson<SubtitleStyleResponse>("/api/subtitle-styles"),
  setActiveSubtitleStyles: (
    styles: SubtitleStylePreferences,
    presetId: string | null,
  ) =>
    fetchJson<SubtitleStyleResponse>("/api/subtitle-styles/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ styles, presetId }),
    }),
  createSubtitleStylePreset: (name: string, styles: SubtitleStylePreferences) =>
    fetchJson<SubtitleStyleResponse>("/api/subtitle-styles/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, styles }),
    }),
  updateSubtitleStylePreset: (
    presetId: string,
    name: string,
    styles: SubtitleStylePreferences,
  ) =>
    fetchJson<SubtitleStyleResponse>(
      `/api/subtitle-styles/presets/${encodeURIComponent(presetId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, styles }),
      },
    ),
  removeSubtitleStylePreset: (presetId: string) =>
    fetchJson<SubtitleStyleResponse>(
      `/api/subtitle-styles/presets/${encodeURIComponent(presetId)}`,
      { method: "DELETE" },
    ),
  createLibraryItems: (sources: DownloadSourceInput[], rightsConfirmed: true) =>
    fetchJson<CreateLibraryItemsResponse>("/api/library/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources, rightsConfirmed } satisfies CreateLibraryItemsRequest),
    }),
  extensionPairing: () =>
    fetchJson<ExtensionPairingStatus>("/api/extension/pairing"),
  downloadExtensionPackage: () =>
    fetchDownload("/api/extension/package", { method: "POST" }),
  revokeExtensionPairing: () =>
    fetchJson<{ paired: false }>("/api/extension/pairing", {
      method: "DELETE",
    }),
  retryLibraryDownload: (itemId: string, lowQualityApproved = false) =>
    fetchJson<LibraryResponse>(
      `/api/library/items/${encodeURIComponent(itemId)}/retry`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lowQualityApproved }),
      },
    ),
  approveLowQualityDownload: (itemId: string) =>
    fetchJson<LibraryResponse>(
      `/api/library/items/${encodeURIComponent(itemId)}/approve-low-quality`,
      { method: "POST" },
    ),
  cancelLibraryDownload: (itemId: string) =>
    fetchJson<LibraryResponse>(
      `/api/library/items/${encodeURIComponent(itemId)}/download`,
      { method: "DELETE" },
    ),
  removeLibraryDownload: (itemId: string) =>
    fetchJson<LibraryResponse>(
      `/api/library/items/${encodeURIComponent(itemId)}`,
      { method: "DELETE" },
    ),
  pauseDownloadQueue: () =>
    fetchJson<LibraryResponse>("/api/download-queue/pause", { method: "POST" }),
  resumeDownloadQueue: () =>
    fetchJson<LibraryResponse>("/api/download-queue/resume", { method: "POST" }),
  downloadModel: (modelId: string) =>
    fetchJson<TranscriptionModelDetailResponse>(
      `/api/models/${encodeURIComponent(modelId)}/download`,
      { method: "POST" },
    ),
  cancelModelDownload: (modelId: string) =>
    fetchJson<{ cancelled: true }>(
      `/api/models/${encodeURIComponent(modelId)}/download`,
      { method: "DELETE" },
    ),
  removeModel: (modelId: string) =>
    fetchJson<{ removed: true }>(
      `/api/models/${encodeURIComponent(modelId)}`,
      { method: "DELETE" },
    ),
  selectTranscriptionModel: (modelId: string) =>
    fetchJson<TranscriptionModelCatalogResponse>("/api/models/selection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId }),
    }),
  setProviderCredential: (
    providerId: CloudTranscriptionProvider,
    value: string,
  ) =>
    fetchJson<TranscriptionModelCatalogResponse>(
      `/api/providers/${encodeURIComponent(providerId)}/credential`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      },
    ),
  clearProviderCredential: (providerId: CloudTranscriptionProvider) =>
    fetchJson<TranscriptionModelCatalogResponse>(
      `/api/providers/${encodeURIComponent(providerId)}/credential`,
      { method: "DELETE" },
    ),
  summaries: (videoId: string) =>
    fetchJson<SummaryCatalogResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/summaries`,
    ),
  summaryArtifact: (videoId: string, artifactId: string) =>
    fetchJson<SummaryArtifactResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/summaries/${encodeURIComponent(artifactId)}`,
    ),
  importSummary: (videoId: string, request: SummaryImportRequest) =>
    fetchJson<SummaryCatalogResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/summaries/import`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    ),
  activateSummary: (
    videoId: string,
    kind: SummaryArtifactKind,
    artifactId: string,
  ) =>
    fetchJson<SummaryCatalogResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/summaries/active`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, artifactId }),
      },
    ),
  prompts: () => fetchJson<PromptLibraryResponse>("/api/prompts"),
  supportedSites: () =>
    fetchJson<SupportedSitesResponse>("/api/supported-sites"),
  notes: (videoId: string) =>
    fetchJson<VideoNotesResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/notes`,
    ),
  createNote: (videoId: string, request: SaveVideoNoteRequest) =>
    fetchJson<VideoNotesResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/notes`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    ),
  updateNote: (
    videoId: string,
    noteId: string,
    request: SaveVideoNoteRequest,
  ) =>
    fetchJson<VideoNotesResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/notes/${encodeURIComponent(noteId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    ),
  removeNote: (videoId: string, noteId: string) =>
    fetchJson<VideoNotesResponse>(
      `/api/jobs/${encodeURIComponent(videoId)}/notes/${encodeURIComponent(noteId)}`,
      { method: "DELETE" },
    ),
  previewRemoval: (target: RemovalTarget) =>
    fetchJson<RemovalPreviewResponse>("/api/removals/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    }),
  executeRemoval: (target: RemovalTarget, planDigest: string) =>
    fetchJson<RemovalExecutionResponse>("/api/removals/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, planDigest }),
    }),
}
