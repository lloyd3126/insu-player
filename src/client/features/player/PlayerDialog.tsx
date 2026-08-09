import { useMutation } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { api } from "@/api/client"
import { useOverlay } from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import {
  CaptionLanguageSelect,
  getPreferredCaption,
} from "@/components/shared/CaptionLanguageSelect"
import { Button } from "@/components/ui/button"
import { useJobsQuery } from "@/hooks/use-jobs-query"

type PlayerMessage = {
  type?: string
  videoId?: string
  time?: number
  duration?: number
}

export function PlayerDialog() {
  const overlay = useOverlay()
  const jobsQuery = useJobsQuery()
  const iframe = useRef<HTMLIFrameElement>(null)
  const saveTimer = useRef<number | null>(null)
  const latestPlayback = useRef<{ time: number; duration: number | null } | null>(
    null,
  )
  const [ready, setReady] = useState(false)
  const active = overlay.state?.type === "player" ? overlay.state : null
  const job = jobsQuery.data?.jobs.find((item) => item.videoId === active?.videoId)
  const captionCodes = job?.captionCodes ?? []
  const preferredCaption =
    active?.caption && captionCodes.includes(active.caption)
      ? active.caption
      : getPreferredCaption(captionCodes, "off")
  const [caption, setCaption] = useState("off")
  const mutation = useMutation({
    mutationFn: (payload: { time: number; duration: number | null }) =>
      api.savePlayback(active?.videoId ?? "", payload),
  })

  useEffect(() => {
    if (!active) return
    setCaption(preferredCaption)
    setReady(false)
  }, [active?.caption, active?.videoId, preferredCaption])

  useEffect(() => {
    if (!active) return
    const onMessage = (event: MessageEvent<PlayerMessage>) => {
      if (
        event.origin !== location.origin ||
        event.source !== iframe.current?.contentWindow
      ) {
        return
      }
      const message = event.data ?? {}
      if (message.videoId && message.videoId !== active.videoId) return
      if (message.type === "player:ready") {
        setReady(true)
        const saved = job?.playback.time ?? 0
        if (
          saved > 10 &&
          (!Number.isFinite(message.duration) || saved < Number(message.duration) - 15)
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
      }
      if (
        ["player:time", "player:paused", "player:ended"].includes(
          message.type ?? "",
        ) &&
        Number.isFinite(message.time)
      ) {
        latestPlayback.current = {
          time: message.type === "player:ended" ? 0 : Number(message.time),
          duration: Number.isFinite(message.duration)
            ? Number(message.duration)
            : null,
        }
        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
        const immediate = message.type !== "player:time"
        saveTimer.current = window.setTimeout(
          () => {
            if (latestPlayback.current) mutation.mutate(latestPlayback.current)
          },
          immediate ? 0 : 5_000,
        )
      }
      if (message.type === "player:error") setReady(true)
    }
    window.addEventListener("message", onMessage)
    return () => {
      window.removeEventListener("message", onMessage)
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      if (latestPlayback.current) mutation.mutate(latestPlayback.current)
    }
  }, [active?.videoId, caption, job?.playback.time])

  const selectCaption = (value: string | null) => {
    const normalized = value ?? "off"
    setCaption(normalized)
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
            onClick={() =>
              active && overlay.actions.open({ type: "detail", videoId: active.videoId })
            }
          >
            查看處理紀錄
          </Button>
        </div>
      </div>
    </AppDialog>
  )
}
