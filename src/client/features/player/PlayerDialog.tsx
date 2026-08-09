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
import { Button } from "@/components/ui/button"
import { useJobsQuery } from "@/hooks/use-jobs-query"
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
  time: number
  duration: number | null
}

export function PlayerDialog() {
  const overlay = useOverlay()
  const jobsQuery = useJobsQuery()
  const queryClient = useQueryClient()
  const iframe = useRef<HTMLIFrameElement>(null)
  const saveTimer = useRef<number | null>(null)
  const latestPlayback = useRef<PlaybackMutation | null>(null)
  const [ready, setReady] = useState(false)
  const active = overlay.state?.type === "player" ? overlay.state : null
  const job = jobsQuery.data?.jobs.find((item) => item.videoId === active?.videoId)
  const captionCodes = job?.captionCodes ?? []
  const preferredCaption =
    active?.caption && captionCodes.includes(active.caption)
      ? active.caption
      : getPreferredCaption(captionCodes, "off")
  const [caption, setCaption] = useState("off")
  const { mutate: persistPlayback } = useMutation({
    mutationFn: ({ videoId, time, duration }: PlaybackMutation) =>
      api.savePlayback(videoId, { time, duration }),
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
      const saved = active?.videoId === videoId ? (job?.playback.time ?? 0) : 0
      if (
        saved > 10 &&
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
      overlay.actions.open(
        {
          type: "player",
          videoId: active.videoId,
          caption: normalized === "off" ? undefined : normalized,
        },
        { replace: true },
      )
    }
    iframe.current?.contentWindow?.postMessage(
      { type: "player:set-caption", language: normalized },
      location.origin,
    )
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
            ref={iframe}
            title="本機影音播放器"
            src={`/watch/${encodeURIComponent(active.videoId)}/?embed=1`}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        ) : null}
      </div>
      <div className="player-footer">
        <span>播放進度保存在影音 job 資料夾</span>
        <div className="player-footer__actions">
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
