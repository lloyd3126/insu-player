import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/api/client"

export function useJobDetail(videoId: string | null) {
  return useQuery({
    queryKey: ["job", videoId],
    queryFn: () => api.job(videoId as string),
    enabled: Boolean(videoId),
  })
}

export function useJobLog(videoId: string) {
  return useQuery({
    queryKey: ["job-log", videoId],
    queryFn: () => api.jobLog(videoId),
  })
}

export function useJobCaptions(videoId: string) {
  return useQuery({
    queryKey: ["job-captions", videoId],
    queryFn: () => api.captions(videoId),
    staleTime: 60_000,
  })
}

export function useSubtitleCatalog(videoId: string) {
  return useQuery({
    queryKey: ["job-subtitles", videoId],
    queryFn: () => api.subtitles(videoId),
    staleTime: 30_000,
  })
}

export function useActivateSubtitle(videoId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      languageCode,
      trackId,
    }: {
      languageCode: string
      trackId: string
    }) => api.activateSubtitle(videoId, languageCode, trackId),
    onSuccess: (catalog) => {
      queryClient.setQueryData(["job-subtitles", videoId], catalog)
      void queryClient.invalidateQueries({ queryKey: ["job", videoId] })
      void queryClient.invalidateQueries({ queryKey: ["jobs"] })
      void queryClient.invalidateQueries({ queryKey: ["player", videoId] })
    },
  })
}

export function useSubtitleArtifactCaptions(
  videoId: string,
  artifactId: string | null,
) {
  return useQuery({
    queryKey: ["job-subtitle-artifact", videoId, artifactId],
    queryFn: () =>
      api.subtitleArtifactCaptions(videoId, artifactId as string),
    enabled: Boolean(artifactId),
    staleTime: 60_000,
  })
}
