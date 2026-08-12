import type { CSSProperties } from "react"

import type { SubtitleTextStyle } from "@shared/contracts/subtitle-style"

const SHADOWS = {
  none: "none",
  soft: "0 1px 3px #000",
  strong: "0 2px 5px #000, 0 0 2px #000",
} as const

function rgba(hex: string, opacity: number) {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return `rgb(${red} ${green} ${blue} / ${Math.round(opacity * 100)}%)`
}

export function subtitleStyleToCss(style: SubtitleTextStyle): CSSProperties {
  return {
    fontSize: `${style.fontScale * 1.35}rem`,
    fontWeight: style.fontWeight,
    color: style.textColor,
    background: rgba(style.backgroundColor, style.backgroundOpacity),
    lineHeight: style.lineHeight,
    padding: `${style.paddingY}em ${style.paddingX}em`,
    borderRadius: `${style.radius}em`,
    textShadow: SHADOWS[style.shadow],
    letterSpacing: `${style.letterSpacing}em`,
  }
}
