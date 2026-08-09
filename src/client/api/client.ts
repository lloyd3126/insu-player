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
  RemovalExecutionResponse,
  RemovalPreviewResponse,
  RemovalTarget,
} from "@shared/contracts/removal"

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
