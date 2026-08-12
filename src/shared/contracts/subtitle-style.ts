export const SUBTITLE_SHADOWS = ["none", "soft", "strong"] as const

export interface SubtitleTextStyle {
  fontScale: number
  fontWeight: number
  textColor: string
  backgroundColor: string
  backgroundOpacity: number
  lineHeight: number
  paddingX: number
  paddingY: number
  radius: number
  shadow: (typeof SUBTITLE_SHADOWS)[number]
  letterSpacing: number
}

export interface SubtitleStylePreferences {
  primary: SubtitleTextStyle
  secondary: SubtitleTextStyle
  bilingual: { gap: number }
}

export interface SubtitleStylePreset {
  id: string
  name: string
  styles: SubtitleStylePreferences
  createdAt: string
  updatedAt: string
}

export interface SubtitleStyleResponse {
  active: SubtitleStylePreferences
  activePresetId: string | null
  presets: SubtitleStylePreset[]
  updatedAt: string
}

export const DEFAULT_SUBTITLE_STYLES: SubtitleStylePreferences = {
  primary: {
    fontScale: 1,
    fontWeight: 650,
    textColor: "#ffffff",
    backgroundColor: "#030b0c",
    backgroundOpacity: 0.72,
    lineHeight: 1.3,
    paddingX: 0.7,
    paddingY: 0.38,
    radius: 0.18,
    shadow: "soft",
    letterSpacing: 0,
  },
  secondary: {
    fontScale: 1,
    fontWeight: 650,
    textColor: "#ffe08a",
    backgroundColor: "#030b0c",
    backgroundOpacity: 0.72,
    lineHeight: 1.3,
    paddingX: 0.7,
    paddingY: 0.38,
    radius: 0.18,
    shadow: "soft",
    letterSpacing: 0,
  },
  bilingual: { gap: 0.5 },
}
