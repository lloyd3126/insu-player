const MEDIA_EXTENSION = /\.(?:m3u8|mp4|m4v|webm)(?:$|[?#])/i

export function isOwnPlayerUrl(value) {
  try {
    const url = new URL(value)
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
  } catch {
    return false
  }
}

export function isWebUrl(value) {
  try {
    const url = new URL(value)
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

export function isSupportedMediaUrl(value, contentType = "") {
  if (!isWebUrl(value) || isOwnPlayerUrl(value)) return false
  return (
    MEDIA_EXTENSION.test(value) ||
    /application\/(?:vnd\.apple\.mpegurl|x-mpegurl)/i.test(contentType) ||
    /video\/(?:mp4|webm)/i.test(contentType)
  )
}

export function detectProtocol(value, contentType = "") {
  if (/\.m3u8(?:$|[?#])/i.test(value) || /mpegurl/i.test(contentType)) return "hls"
  return new URL(value).protocol === "https:" ? "https" : "http"
}

export async function candidateFingerprint(candidate) {
  const identity = [
    candidate.kind,
    candidate.pageUrl,
    candidate.frameUrl || "",
    candidate.mediaUrl || "",
  ].join("\n")
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identity),
  )
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
}

export async function normalizeCandidates(candidates) {
  const eligible = []
  for (const candidate of candidates) {
    if (!candidate || !isWebUrl(candidate.pageUrl) || isOwnPlayerUrl(candidate.pageUrl)) {
      continue
    }
    if (candidate.kind === "embed" && !isWebUrl(candidate.frameUrl)) continue
    if (
      candidate.kind === "network-media" &&
      !isSupportedMediaUrl(candidate.mediaUrl, candidate.contentType)
    ) {
      continue
    }
    eligible.push(candidate)
  }
  const fingerprinted = await Promise.all(
    eligible.map(async (candidate) => ({
      candidate,
      fingerprint: await candidateFingerprint(candidate),
    })),
  )
  const seen = new Set()
  const normalized = []
  for (const { candidate, fingerprint } of fingerprinted) {
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    normalized.push({
      ...candidate,
      candidateFingerprint: fingerprint,
      ...(candidate.mediaUrl
        ? { protocol: detectProtocol(candidate.mediaUrl, candidate.contentType) }
        : {}),
    })
  }
  return normalized
}
