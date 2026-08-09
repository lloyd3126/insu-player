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

async function fetchJson<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, { cache: "no-store", ...init })
  if (!response.ok) {
    const message = await response.text().catch(() => "")
    throw new Error(message || `HTTP ${response.status}`)
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
  savePlayback: (videoId: string, playback: Pick<PlaybackState, "time" | "duration">) =>
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
}
