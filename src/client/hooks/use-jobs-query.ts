import { useQuery } from "@tanstack/react-query"

import { api } from "@/api/client"

export function useJobsQuery() {
  return useQuery({
    queryKey: ["jobs"],
    queryFn: api.jobs,
    refetchInterval: () => (document.visibilityState === "visible" ? 2_500 : 10_000),
    refetchIntervalInBackground: false,
  })
}
