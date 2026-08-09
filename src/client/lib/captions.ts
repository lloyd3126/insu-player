export const NO_CAPTION = "none"

export function getPreferredCaption(
  codes: string[],
  fallback = NO_CAPTION,
) {
  if (codes.includes("zh-TW")) return "zh-TW"
  if (codes.includes("en")) return "en"
  return codes[0] ?? fallback
}
