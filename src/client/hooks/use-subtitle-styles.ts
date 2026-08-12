import { useQuery } from "@tanstack/react-query"

import { api } from "@/api/client"

export function useSubtitleStyles() {
  return useQuery({
    queryKey: ["subtitle-styles"],
    queryFn: api.subtitleStyles,
    staleTime: 30_000,
  })
}
