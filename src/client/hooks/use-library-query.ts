import { useQuery } from "@tanstack/react-query"

import { api } from "@/api/client"

export function useLibraryQuery({
  refreshDownloadQueue = false,
}: {
  refreshDownloadQueue?: boolean
} = {}) {
  return useQuery({
    queryKey: ["library"],
    queryFn: api.library,
    refetchInterval: (query) => {
      const queue = query.state.data?.queue
      const active = Boolean(
        (queue && (queue.activeCount > 0 || (!queue.paused && queue.queuedCount > 0))) ||
          query.state.data?.items.some(
            (item) =>
              item.kind === "import" &&
              ["awaiting_upload", "uploading", "probing", "transcoding", "finalizing"].includes(item.state),
          ),
      )
      if (active) {
        return document.visibilityState === "visible" ? 1_000 : 10_000
      }
      return refreshDownloadQueue && document.visibilityState === "visible"
        ? 1_000
        : false
    },
    refetchIntervalInBackground: false,
  })
}
