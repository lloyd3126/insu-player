import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react"

import { api } from "@/api/client"
import { useOverlay } from "@/app/overlay-context"
import { loadJobDetailDialog } from "@/app/overlay-loaders"
import { AppDialog } from "@/components/shared/AppDialog"
import { CaptionLanguageSelect } from "@/components/shared/CaptionLanguageSelect"
import { MediaQualitySelect } from "@/components/shared/MediaQualitySelect"
import { Button } from "@/components/ui/button"
import { useJobsQuery } from "@/hooks/use-jobs-query"
import { useMediaCatalog } from "@/hooks/use-media-catalog"
import { getPreferredCaption } from "@/lib/captions"
import type { JobsResponse } from "@shared/contracts/job"

type PlayerMessage = {
  type?: string
  videoId?: string
  time?: number
  duration?: number
}

type PlaybackMutation = {
  videoId: string
  time?: number
  duration?: number | null
  captionLanguage?: string | null
}

export function PlayerDialog() {
  const overlay = useOverlay()
  const jobsQuery = useJobsQuery()
  const queryClient = useQueryClient()
  const iframe = useRef<HTMLIFrameElement>(null)
  const saveTimer = useRef<number | null>(null)
  const latestPlayback = useRef<PlaybackMutation | null>(null)
  const previousCatalogSignature = useRef<string | null>(null)
  const [ready, setReady] = useState(false)
  const [playerRevision, setPlayerRevision] = useState(0)
  const active = overlay.state?.type === "player" ? overlay.state : null
  const job = jobsQuery.data?.jobs.find((item) => item.videoId === active?.videoId)
  const mediaCatalog = useMediaCatalog(active?.videoId ?? null)
  const captionCodes = job?.captionCodes ?? []
  const activeRendition = mediaCatalog.data?.renditions.find(
    (rendition) => rendition.active,
  )
  const mediaSignature = activeRendition
    ? `${activeRendition.id}:${activeRendition.checksum}`
    : job?.activeMedia
      ? `${job.activeMedia.id}:${job.activeMedia.checksum}`
      : "media-loading"
  const catalogSignature = `${captionCodes
    .map((code) => `${code}:${job?.activeSubtitleVersions[code] ?? "loading"}`)
    .join("|")}::${mediaSignature}`
  const preferredCaption =
    active?.caption && captionCodes.includes(active.caption)
      ? active.caption
      : getPreferredCaption(captionCodes, "off", [
          job?.playback.captionLanguage,
          job?.subtitlePipeline?.outputLanguage,
          job?.subtitlePipeline?.sourceLanguage,
        ])
  const [caption, setCaption] = useState("off")
  const { mutate: persistPlayback } = useMutation({
    mutationFn: ({
      videoId,
      time,
      duration,
      captionLanguage,
    }: PlaybackMutation) =>
      api.savePlayback(videoId, { time, duration, captionLanguage }),
    scope: { id: "player-playback" },
    onSuccess: (saved, variables) => {
      queryClient.setQueryData<JobsResponse>(["jobs"], (current) => {
        if (!current) return current
        return {
          ...current,
          jobs: current.jobs.map((currentJob) =>
            currentJob.videoId === variables.videoId
              ? { ...currentJob, playback: saved }
              : currentJob,
          ),
        }
      })
    },
  })
  const activateMedia = useMutation({
    mutationFn: (renditionId: string) =>
      api.activateMedia(active!.videoId, renditionId),
    onSuccess: (data) => {
      if (!active) return
      queryClient.setQueryData(["job-media", active.videoId], data)
      void queryClient.invalidateQueries({ queryKey: ["job", active.videoId] })
      void queryClient.invalidateQueries({ queryKey: ["jobs"] })
    },
  })
  const flushPlayback = useCallback(
    (videoId: string) => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      const pending = latestPlayback.current
      if (!pending || pending.videoId !== videoId) return
      latestPlayback.current = null
      persistPlayback(pending)
    },
    [persistPlayback],
  )
  const handlePlayerReady = useEffectEvent(
    (message: PlayerMessage, videoId: string) => {
      setReady(true)
      const pendingTime = latestPlayback.current?.time
      const saved =
        active?.videoId === videoId
          ? (active.time ?? pendingTime ?? job?.playback.time ?? 0)
          : 0
      if (
        (active?.time !== undefined ? saved >= 0 : saved > 10) &&
        (!Number.isFinite(message.duration) ||
          saved < Number(message.duration) - 15)
      ) {
        iframe.current?.contentWindow?.postMessage(
          { type: "player:seek", time: saved },
          location.origin,
        )
      }
      iframe.current?.contentWindow?.postMessage(
        { type: "player:set-caption", language: caption },
        location.origin,
      )
    },
  )

  useEffect(() => {
    if (!active) return
    setCaption(preferredCaption)
    setReady(false)
  }, [active?.caption, active?.videoId, preferredCaption])

  useEffect(() => {
    const videoId = active?.videoId
    if (!videoId) {
      previousCatalogSignature.current = null
      return
    }
    const previous = previousCatalogSignature.current
    previousCatalogSignature.current = catalogSignature
    if (previous === null || previous === catalogSignature) return
    flushPlayback(videoId)
    setReady(false)
    setPlayerRevision((revision) => revision + 1)
  }, [active?.videoId, catalogSignature, flushPlayback])

  useEffect(() => {
    const videoId = active?.videoId
    if (!videoId) return
    latestPlayback.current = null
    const onMessage = (event: MessageEvent<PlayerMessage>) => {
      if (
        event.origin !== location.origin ||
        event.source !== iframe.current?.contentWindow
      ) {
        return
      }
      const message = event.data ?? {}
      if (message.videoId && message.videoId !== videoId) return
      if (message.type === "player:ready") {
        handlePlayerReady(message, videoId)
      }
      if (
        ["player:time", "player:paused", "player:ended"].includes(
          message.type ?? "",
        ) &&
        Number.isFinite(message.time)
      ) {
        latestPlayback.current = {
          videoId,
          time: message.type === "player:ended" ? 0 : Number(message.time),
          duration: Number.isFinite(message.duration)
            ? Number(message.duration)
            : null,
        }
        const immediate = message.type !== "player:time"
        if (immediate) {
          flushPlayback(videoId)
        } else {
          if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
          saveTimer.current = window.setTimeout(
            () => flushPlayback(videoId),
            5_000,
          )
        }
      }
      if (message.type === "player:error") setReady(true)
    }
    window.addEventListener("message", onMessage)
    return () => {
      window.removeEventListener("message", onMessage)
      flushPlayback(videoId)
    }
  }, [active?.videoId, flushPlayback])

  const selectCaption = (value: string | null) => {
    const normalized = value ?? "off"
    setCaption(normalized)
    if (active) {
      persistPlayback({
        videoId: active.videoId,
        captionLanguage: normalized === "off" ? null : normalized,
      })
      overlay.actions.open(
        {
          type: "player",
          videoId: active.videoId,
          caption: normalized === "off" ? undefined : normalized,
          time: active.time,
        },
        { replace: true },
      )
    }
    iframe.current?.contentWindow?.postMessage(
      { type: "player:set-caption", language: normalized },
      location.origin,
    )
  }

  const selectMedia = (renditionId: string) => {
    if (!active || renditionId === activeRendition?.id) return
    flushPlayback(active.videoId)
    activateMedia.mutate(renditionId)
  }

  return (
    <AppDialog
      open={Boolean(active)}
      onOpenChange={(open) => (open ? undefined : overlay.actions.close("player"))}
      kicker="INSU SCREENING"
      title={job?.title ?? "影音播放器"}
      description="同源 iframe 本機影音播放器"
      size="screen"
      className="player-app-dialog"
    >
      <div className="player-stage">
        {!ready ? <div className="player-stage__loading">正在準備本機放映室</div> : null}
        {active ? (
          <iframe
            key={`${active.videoId}:${playerRevision}`}
            ref={iframe}
            title="本機影音播放器"
            src={`/watch/${encodeURIComponent(active.videoId)}/?embed=1&catalog=${encodeURIComponent(catalogSignature)}`}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        ) : null}
      </div>
      <div className="player-footer">
        <span>播放進度會自動保存在目前影音庫</span>
        <div className="player-footer__actions">
          {mediaCatalog.data && activeRendition ? (
            <MediaQualitySelect
              renditions={mediaCatalog.data.renditions}
              value={activeRendition.id}
              onValueChange={selectMedia}
              disabled={activateMedia.isPending}
            />
          ) : null}
          <CaptionLanguageSelect
            codes={captionCodes}
            value={caption}
            onValueChange={selectCaption}
            label="播放器字幕"
            includeOff
          />
          <Button
            variant="outline"
            onPointerEnter={() => void loadJobDetailDialog()}
            onFocus={() => void loadJobDetailDialog()}
            onPointerDown={() => void loadJobDetailDialog()}
            onClick={async () => {
              if (!active) return
              await loadJobDetailDialog()
              overlay.actions.open({
                type: "detail",
                videoId: active.videoId,
                tab: "about",
              })
            }}
          >
            詳細資訊
          </Button>
        </div>
      </div>
    </AppDialog>
  )
}
