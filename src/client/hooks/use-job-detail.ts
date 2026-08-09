import { useQuery } from "@tanstack/react-query"

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
  })
}
