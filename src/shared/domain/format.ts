const DATE_FORMAT = new Intl.DateTimeFormat("zh-TW", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

export function formatBytes(bytes: number | null | undefined) {
  if (!Number.isFinite(bytes) || (bytes ?? 0) <= 0) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const value = bytes as number
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  )
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`
}

export function formatDate(value: string | null | undefined) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.valueOf()) ? DATE_FORMAT.format(date) : "—"
}

export function formatDuration(value: number | null | undefined) {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return null
  const totalSeconds = Math.floor(value as number)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function formatCaptionTime(value: number) {
  const minutes = Math.floor(value / 60)
  const seconds = value - minutes * 60
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`
}
