import { useQuery } from "@tanstack/react-query"

import { api } from "@/api/client"

const ACTIVE_STATES = new Set([
  "discovering",
  "probing",
  "downloading",
  "merging",
  "validating",
])

export function useMediaCatalog(videoId: string | null) {
  return useQuery({
    queryKey: ["job-media", videoId],
    queryFn: () => api.media(videoId!),
    enabled: Boolean(videoId),
    refetchInterval: (query) =>
      query.state.data?.operation &&
      ACTIVE_STATES.has(query.state.data.operation.state)
        ? 1_000
        : false,
  })
}
