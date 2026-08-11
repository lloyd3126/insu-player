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
  CreateDownloadBatchRequest,
  CreateDownloadBatchResponse,
  DownloadBatch,
  DownloadBatchListResponse,
  DownloadSourceInput,
} from "@shared/contracts/download-batch"
import type {
  ExtensionPairingStatus,
  StartExtensionPairingResponse,
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
  downloadBatches: () =>
    fetchJson<DownloadBatchListResponse>("/api/download-batches"),
  createDownloadBatch: (sources: DownloadSourceInput[], rightsConfirmed: true) =>
    fetchJson<CreateDownloadBatchResponse>("/api/download-batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources, rightsConfirmed } satisfies CreateDownloadBatchRequest),
    }),
  extensionPairing: () =>
    fetchJson<ExtensionPairingStatus>("/api/extension/pairing"),
  startExtensionPairing: () =>
    fetchJson<StartExtensionPairingResponse>("/api/extension/pairing/start", {
      method: "POST",
    }),
  revokeExtensionPairing: () =>
    fetchJson<{ paired: false }>("/api/extension/pairing", {
      method: "DELETE",
    }),
  retryDownloadBatchItem: (
    batchId: string,
    itemId: string,
    lowQualityApproved = false,
  ) =>
    fetchJson<DownloadBatch>(
      `/api/download-batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/retry`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lowQualityApproved }),
      },
    ),
  cancelDownloadBatchItem: (batchId: string, itemId: string) =>
    fetchJson<DownloadBatch>(
      `/api/download-batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}`,
      { method: "DELETE" },
    ),
  pauseDownloadBatch: (batchId: string) =>
    fetchJson<DownloadBatch>(
      `/api/download-batches/${encodeURIComponent(batchId)}/pause`,
      { method: "POST" },
    ),
  resumeDownloadBatch: (batchId: string) =>
    fetchJson<DownloadBatch>(
      `/api/download-batches/${encodeURIComponent(batchId)}/resume`,
      { method: "POST" },
    ),
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
