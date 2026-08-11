import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

import type {
  BrowserCookieInput,
  BrowserMediaCandidate,
  CreateBrowserMediaSessionRequest,
  CreateBrowserMediaSessionResponse,
} from "@shared/contracts/browser-extension"

const SESSION_TTL_MS = 10 * 60 * 1000
const MAX_COOKIE_COUNT = 300
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"])

interface MediaSession {
  id: string
  candidate: BrowserMediaCandidate
  cookies: BrowserCookieInput[]
  authenticationConsentAt: string | null
  expiresAt: number
}

export interface ClaimedMediaSession {
  sourceUrl: string
  pageUrl: string
  frameUrl: string | null
  sourceKind: BrowserMediaCandidate["kind"]
  cookieFile: string | null
  authentication: "none" | "browser-session"
  authenticationConsentAt: string | null
  dispose: () => void
}

function parseWebUrl(value: string, label: string, maxLength = 8_192) {
  if (!value || value.length > maxLength || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new MediaSessionOperationError(`${label}無效`, "invalid-source", 400)
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new MediaSessionOperationError(`${label}無效`, "invalid-source", 400)
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    LOOPBACK_HOSTS.has(parsed.hostname)
  ) {
    throw new MediaSessionOperationError(`${label}無效`, "invalid-source", 400)
  }
  parsed.hash = ""
  return parsed
}

function cookieMatchesHost(cookie: BrowserCookieInput, host: string) {
  const domain = cookie.domain.replace(/^\./, "").toLowerCase()
  const normalizedHost = host.toLowerCase()
  return normalizedHost === domain || normalizedHost.endsWith(`.${domain}`)
}

function validateCookie(cookie: BrowserCookieInput) {
  for (const value of [cookie.name, cookie.domain, cookie.path]) {
    if (!value || value.length > 8_192 || /[\t\r\n\u0000]/.test(value)) {
      throw new MediaSessionOperationError(
        "瀏覽器登入資料格式無效",
        "invalid-browser-session",
        400,
      )
    }
  }
  if (cookie.value.length > 8_192 || /[\t\r\n\u0000]/.test(cookie.value)) {
    throw new MediaSessionOperationError(
      "瀏覽器登入資料格式無效",
      "invalid-browser-session",
      400,
    )
  }
}

function cookieHeader(cookies: BrowserCookieInput[], host: string) {
  return cookies
    .filter((cookie) => cookieMatchesHost(cookie, host))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ")
}

function netscapeCookieJar(cookies: BrowserCookieInput[]) {
  const lines = ["# Netscape HTTP Cookie File"]
  for (const cookie of cookies) {
    const domain = `${cookie.httpOnly ? "#HttpOnly_" : ""}${cookie.domain}`
    const includeSubdomains = cookie.hostOnly ? "FALSE" : "TRUE"
    const expires = cookie.session
      ? 0
      : Math.max(0, Math.floor(cookie.expirationDate ?? 0))
    lines.push(
      [
        domain,
        includeSubdomains,
        cookie.path,
        cookie.secure ? "TRUE" : "FALSE",
        String(expires),
        cookie.name,
        cookie.value,
      ].join("\t"),
    )
  }
  return `${lines.join("\n")}\n`
}

export class MediaSessionOperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 404 | 409 | 500,
  ) {
    super(message)
  }
}

export class MediaSessionService {
  private readonly sessions = new Map<string, MediaSession>()
  private readonly cookieRoot: string

  constructor(private readonly workspace: string) {
    this.cookieRoot = path.join(
      workspace,
      ".agent-tools",
      "insu-player",
      "tmp",
      "cookie-sessions",
    )
    mkdirSync(this.cookieRoot, { recursive: true, mode: 0o700 })
    chmodSync(this.cookieRoot, 0o700)
    for (const entry of readdirSync(this.cookieRoot)) {
      const candidate = path.join(this.cookieRoot, entry)
      if (path.dirname(candidate) === this.cookieRoot) {
        rmSync(candidate, { force: true })
      }
    }
  }

  async create(
    request: CreateBrowserMediaSessionRequest,
  ): Promise<CreateBrowserMediaSessionResponse> {
    this.prune()
    const pageUrl = parseWebUrl(request.candidate.pageUrl, "頁面網址", 2_048)
    const frameUrl = request.candidate.frameUrl
      ? parseWebUrl(request.candidate.frameUrl, "嵌入頁面網址", 8_192)
      : null
    const mediaUrl = request.candidate.mediaUrl
      ? parseWebUrl(request.candidate.mediaUrl, "媒體網址", 16_384)
      : null
    if (request.candidate.kind === "embed" && !frameUrl) {
      throw new MediaSessionOperationError(
        "嵌入來源缺少頁面網址",
        "invalid-source",
        400,
      )
    }
    if (request.candidate.kind === "network-media" && !mediaUrl) {
      throw new MediaSessionOperationError(
        "網路媒體來源缺少實際網址",
        "invalid-source",
        400,
      )
    }
    if (!/^[0-9a-f]{64}$/.test(request.candidate.candidateFingerprint)) {
      throw new MediaSessionOperationError(
        "媒體候選識別碼無效",
        "invalid-source",
        400,
      )
    }
    const cookies = request.cookies ?? []
    if (cookies.length > MAX_COOKIE_COUNT) {
      throw new MediaSessionOperationError(
        "瀏覽器登入資料超過單次上限",
        "invalid-browser-session",
        400,
      )
    }
    const allowedHosts = new Set(
      [pageUrl, frameUrl, mediaUrl]
        .filter((url): url is URL => Boolean(url))
        .map((url) => url.hostname),
    )
    for (const cookie of cookies) {
      validateCookie(cookie)
      if (![...allowedHosts].some((host) => cookieMatchesHost(cookie, host))) {
        throw new MediaSessionOperationError(
          "瀏覽器登入資料超出目前影音來源範圍",
          "browser-session-scope-mismatch",
          400,
        )
      }
    }
    if (cookies.length > 0 && !request.authenticationConsentAt) {
      throw new MediaSessionOperationError(
        "傳送登入狀態前需要明確同意",
        "browser-session-consent-required",
        400,
      )
    }
    const candidate: BrowserMediaCandidate = {
      ...request.candidate,
      pageUrl: pageUrl.toString(),
      ...(frameUrl ? { frameUrl: frameUrl.toString() } : {}),
      ...(mediaUrl ? { mediaUrl: mediaUrl.toString() } : {}),
    }
    if (
      mediaUrl &&
      (candidate.protocol === "hls" || /\.m3u8(?:$|\?)/i.test(mediaUrl.toString()))
    ) {
      await this.validateHls(candidate, cookies)
    }
    const id = `media-session-${crypto.randomUUID()}`
    const expiresAt = Date.now() + SESSION_TTL_MS
    this.sessions.set(id, {
      id,
      candidate,
      cookies,
      authenticationConsentAt: request.authenticationConsentAt ?? null,
      expiresAt,
    })
    return {
      sessionId: id,
      expiresAt: new Date(expiresAt).toISOString(),
      candidateFingerprint: candidate.candidateFingerprint,
    }
  }

  claim(sessionId: string): ClaimedMediaSession {
    this.prune()
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new MediaSessionOperationError(
        "瀏覽器媒體工作階段已失效，請重新從擴充功能加入",
        "media-session-expired",
        409,
      )
    }
    this.sessions.delete(sessionId)
    const sourceUrl =
      session.candidate.mediaUrl ??
      session.candidate.frameUrl ??
      session.candidate.pageUrl
    let cookieFile: string | null = null
    if (session.cookies.length > 0) {
      cookieFile = path.join(this.cookieRoot, `${session.id}.txt`)
      writeFileSync(cookieFile, netscapeCookieJar(session.cookies), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      })
      chmodSync(cookieFile, 0o600)
    }
    return {
      sourceUrl,
      pageUrl: session.candidate.pageUrl,
      frameUrl: session.candidate.frameUrl ?? null,
      sourceKind: session.candidate.kind,
      cookieFile,
      authentication:
        session.cookies.length > 0 ? "browser-session" : "none",
      authenticationConsentAt: session.authenticationConsentAt,
      dispose: () => {
        if (cookieFile && existsSync(cookieFile)) rmSync(cookieFile, { force: true })
      },
    }
  }

  has(sessionId: string | null) {
    this.prune()
    return Boolean(sessionId && this.sessions.has(sessionId))
  }

  describe(sessionId: string) {
    this.prune()
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new MediaSessionOperationError(
        "瀏覽器媒體工作階段已失效，請重新從擴充功能加入",
        "media-session-expired",
        409,
      )
    }
    return {
      authentication:
        session.cookies.length > 0
          ? ("browser-session" as const)
          : ("none" as const),
      authenticationConsentAt: session.authenticationConsentAt,
      sourceKind: session.candidate.kind,
      pageUrl: session.candidate.pageUrl,
      candidateFingerprint: session.candidate.candidateFingerprint,
    }
  }

  private prune() {
    const current = Date.now()
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= current) this.sessions.delete(id)
    }
  }

  private async validateHls(
    candidate: BrowserMediaCandidate,
    cookies: BrowserCookieInput[],
  ) {
    const mediaUrl = new URL(candidate.mediaUrl!)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const headers = new Headers({ Referer: candidate.pageUrl })
      const cookie = cookieHeader(cookies, mediaUrl.hostname)
      if (cookie) headers.set("Cookie", cookie)
      const response = await fetch(mediaUrl, {
        headers,
        redirect: "follow",
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new MediaSessionOperationError(
          "無法驗證 HLS 媒體來源",
          "hls-preflight-failed",
          409,
        )
      }
      const text = (await response.text()).slice(0, 2_000_000)
      if (!text.startsWith("#EXTM3U")) {
        throw new MediaSessionOperationError(
          "選取的來源不是有效的 HLS 清單",
          "invalid-hls",
          400,
        )
      }
      if (
        /METHOD\s*=\s*SAMPLE-AES/i.test(text) ||
        /KEYFORMAT\s*=/i.test(text) ||
        /widevine|playready|streamingkeydelivery|license(?:\/|\.)/i.test(text)
      ) {
        throw new MediaSessionOperationError(
          "此影音使用受保護的串流，INSU Player 不會繞過 DRM",
          "drm-not-supported",
          409,
        )
      }
      const isMaster = /#EXT-X-STREAM-INF\s*:/i.test(text)
      if (!isMaster && !/#EXT-X-ENDLIST\s*$/im.test(text)) {
        throw new MediaSessionOperationError(
          "目前只支援已結束的 HLS 影音，不支援直播",
          "live-stream-not-supported",
          409,
        )
      }
    } catch (error) {
      if (error instanceof MediaSessionOperationError) throw error
      throw new MediaSessionOperationError(
        "無法驗證 HLS 媒體來源",
        "hls-preflight-failed",
        409,
      )
    } finally {
      clearTimeout(timeout)
    }
  }
}
