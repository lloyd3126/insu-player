import { useQuery } from "@tanstack/react-query"

import { api } from "@/api/client"

export function useLibraryQuery() {
  return useQuery({
    queryKey: ["library"],
    queryFn: api.library,
    refetchInterval: (query) => {
      const queue = query.state.data?.queue
      const active = Boolean(
        queue && (queue.activeCount > 0 || (!queue.paused && queue.queuedCount > 0)),
      )
      if (!active) return false
      return document.visibilityState === "visible" ? 1_000 : 10_000
    },
    refetchIntervalInBackground: false,
  })
}
