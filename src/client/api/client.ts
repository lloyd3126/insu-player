import type { CaptionComparisonResponse } from "@shared/contracts/caption"
import type {
  JobDetail,
  JobLogResponse,
  JobsResponse,
  PlaybackState,
} from "@shared/contracts/job"
import type {
  EnvironmentStatusResponse,
  ModelInventoryResponse,
  PromptLibraryResponse,
  SupportedSitesResponse,
} from "@shared/contracts/resources"
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
  models: () => fetchJson<ModelInventoryResponse>("/api/models"),
  prompts: () => fetchJson<PromptLibraryResponse>("/api/prompts"),
  supportedSites: () =>
    fetchJson<SupportedSitesResponse>("/api/supported-sites"),
  environment: () =>
    fetchJson<EnvironmentStatusResponse>("/api/environment"),
  setEnvironment: (name: string, value: string) =>
    fetchJson<EnvironmentStatusResponse>("/api/environment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, value }),
    }),
  clearEnvironment: (name: string) =>
    fetchJson<EnvironmentStatusResponse>(
      `/api/environment/${encodeURIComponent(name)}`,
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
