import { useCallback, useEffect, useRef, useState } from "react"

import { useOverlay, type OverlayDestination } from "@/app/overlay-context"
import { useSubtitleStyles } from "@/hooks/use-subtitle-styles"
import { getPreferredCaption } from "@/lib/captions"
import { DEFAULT_SUBTITLE_STYLES } from "@shared/contracts/subtitle-style"

type PlayerDestination = Extract<OverlayDestination, { type: "player" }>

export function usePlayerCaptions({
  active,
  captionCodes,
  savedCaptionLanguage,
  outputLanguage,
  sourceLanguage,
  iframe,
  onPersistPrimary,
}: {
  active: PlayerDestination | null
  captionCodes: string[]
  savedCaptionLanguage?: string | null
  outputLanguage?: string | null
  sourceLanguage?: string | null
  iframe: React.RefObject<HTMLIFrameElement | null>
  onPersistPrimary: (language: string | null) => void
}) {
  const overlay = useOverlay()
  const subtitleStyleQuery = useSubtitleStyles()
  const subtitleStyles = subtitleStyleQuery.data?.active ?? DEFAULT_SUBTITLE_STYLES
  const ready = useRef(false)
  const preferredPrimary =
    active?.caption && captionCodes.includes(active.caption)
      ? active.caption
      : getPreferredCaption(captionCodes, "off", [
          savedCaptionLanguage,
          outputLanguage,
          sourceLanguage,
        ])
  const preferredSecondary =
    active?.secondaryCaption &&
    active.secondaryCaption !== preferredPrimary &&
    captionCodes.includes(active.secondaryCaption)
      ? active.secondaryCaption
      : "off"
  const [primaryCaption, setPrimaryCaption] = useState("off")
  const [secondaryCaption, setSecondaryCaption] = useState("off")
  const currentCaptions = useRef({
    primaryCaption,
    secondaryCaption,
    subtitleStyles,
  })

  useEffect(() => {
    currentCaptions.current = {
      primaryCaption,
      secondaryCaption,
      subtitleStyles,
    }
  }, [primaryCaption, secondaryCaption, subtitleStyles])

  const postCurrentCaptions = useCallback(() => {
    const current = currentCaptions.current
    iframe.current?.contentWindow?.postMessage(
      {
        type: "player:set-captions",
        primaryLanguage: current.primaryCaption,
        secondaryLanguage: current.secondaryCaption,
        styles: current.subtitleStyles,
      },
      location.origin,
    )
  }, [iframe])

  useEffect(() => {
    setPrimaryCaption(preferredPrimary)
    setSecondaryCaption(preferredSecondary)
  }, [
    active?.caption,
    active?.secondaryCaption,
    active?.videoId,
    preferredPrimary,
    preferredSecondary,
  ])

  useEffect(() => {
    ready.current = false
  }, [active?.videoId])

  useEffect(() => {
    if (ready.current) postCurrentCaptions()
  }, [postCurrentCaptions, primaryCaption, secondaryCaption, subtitleStyles])

  const handlePlayerReady = useCallback(() => {
    ready.current = true
    postCurrentCaptions()
  }, [postCurrentCaptions])
  const resetPlayer = useCallback(() => {
    ready.current = false
  }, [])

  const selectCaption = (
    position: "primary" | "secondary",
    value: string | null,
  ) => {
    const normalized = value ?? "off"
    let nextPrimary = position === "primary" ? normalized : primaryCaption
    let nextSecondary = position === "secondary" ? normalized : secondaryCaption
    if (normalized !== "off" && nextPrimary === nextSecondary) {
      if (position === "primary") nextSecondary = "off"
      else nextPrimary = "off"
    }
    setPrimaryCaption(nextPrimary)
    setSecondaryCaption(nextSecondary)
    onPersistPrimary(nextPrimary === "off" ? null : nextPrimary)
    if (active) {
      overlay.actions.open(
        {
          type: "player",
          videoId: active.videoId,
          caption: nextPrimary === "off" ? undefined : nextPrimary,
          secondaryCaption:
            nextSecondary === "off" ? undefined : nextSecondary,
          time: active.time,
        },
        { replace: true },
      )
    }
    iframe.current?.contentWindow?.postMessage(
      {
        type: "player:set-captions",
        primaryLanguage: nextPrimary,
        secondaryLanguage: nextSecondary,
        styles: subtitleStyles,
      },
      location.origin,
    )
  }

  return {
    handlePlayerReady,
    primaryCaption,
    resetPlayer,
    secondaryCaption,
    selectCaption,
  }
}
