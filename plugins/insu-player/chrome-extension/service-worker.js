import {
  candidateFingerprint,
  isSupportedMediaUrl,
} from "./media-discovery.js"
import {
  CONNECTION_PROTOCOL_VERSION,
  isCurrentInsuHealth,
  normalizeBootstrap,
  normalizeConnection,
  normalizeLoopbackOrigin,
} from "./connection-protocol.js"

const STORAGE_KEY = "insuConnection"
const CANDIDATE_KEY_PREFIX = "insuCandidates:"
const BOOTSTRAP_URL = chrome.runtime.getURL("pairing-bootstrap.json")
let bootstrapConnectionAttempt = null

async function connection() {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]
  const current = normalizeConnection(stored)
  if (stored && !current) await chrome.storage.local.remove(STORAGE_KEY)
  return current
}

async function setConnection(value) {
  const current = normalizeConnection(value)
  if (!current) throw new Error("拒絕儲存無效的 INSU Player 連接")
  await chrome.storage.local.set({ [STORAGE_KEY]: current })
}

class ApiError extends Error {
  constructor(message, status, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function apiFetch(
  path,
  init = {},
  { overrideOrigin, authenticated = true } = {},
) {
  const current = await connection()
  const serverOrigin = overrideOrigin || current?.serverOrigin
  if (!serverOrigin) throw new Error("尚未連接 INSU Player")
  const headers = new Headers(init.headers || {})
  headers.set("X-INSU-Extension-Protocol", String(CONNECTION_PROTOCOL_VERSION))
  headers.set(
    "X-INSU-Extension-Origin",
    new URL(chrome.runtime.getURL("/")).origin,
  )
  if (authenticated && current?.token) {
    headers.set("X-INSU-Extension-Token", current.token)
  }
  if (init.body) headers.set("Content-Type", "application/json")
  const response = await fetch(`${serverOrigin}${path}`, { ...init, headers })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new ApiError(
      payload.error || `INSU Player 回應 ${response.status}`,
      response.status,
      payload.code,
    )
  }
  return response.json()
}

async function bootstrapPayload() {
  const response = await fetch(BOOTSTRAP_URL, { cache: "no-store" })
  if (!response.ok) throw new Error("這份擴充功能缺少 INSU Player 連接設定")
  const payload = await response.json()
  const serverOrigin = normalizeLoopbackOrigin(payload?.serverOrigin)
  const bootstrap = normalizeBootstrap(payload)
  if (!bootstrap) {
    const expired =
      typeof payload?.expiresAt === "string" &&
      Number.isFinite(Date.parse(payload.expiresAt)) &&
      Date.parse(payload.expiresAt) <= Date.now()
    const error = new Error(
      expired
        ? "這份擴充功能 ZIP 已超過連接期限，請從目前 INSU Player 重新下載"
        : "這份擴充功能不屬於目前版本，請重新下載",
    )
    error.code = expired ? "bootstrap-expired" : "bootstrap-invalid"
    error.serverOrigin = serverOrigin
    throw error
  }
  return bootstrap
}

async function claimPackagedBootstrap() {
  if (bootstrapConnectionAttempt) return bootstrapConnectionAttempt
  bootstrapConnectionAttempt = (async () => {
    const bootstrap = await bootstrapPayload()
    const result = await apiFetch(
      "/api/extension/pairing/claim",
      {
        method: "POST",
        body: JSON.stringify({
          protocolVersion: CONNECTION_PROTOCOL_VERSION,
          invitationId: bootstrap.invitationId,
          ticket: bootstrap.ticket,
        }),
      },
      { overrideOrigin: bootstrap.serverOrigin, authenticated: false },
    )
    if (
      typeof result.connectionToken !== "string" ||
      result.connectionToken.length < 32
    ) {
      throw new Error("INSU Player 沒有回傳有效的連線憑證")
    }
    await setConnection({
      protocolVersion: CONNECTION_PROTOCOL_VERSION,
      serverOrigin: bootstrap.serverOrigin,
      token: result.connectionToken,
      connectedAt: new Date().toISOString(),
    })
    const health = await apiFetch("/api/extension/health")
    if (!isCurrentInsuHealth(health)) {
      await chrome.storage.local.remove(STORAGE_KEY)
      throw new Error("連接驗證失敗，請重新下載擴充功能")
    }
    return {
      paired: true,
      ...result,
      ...health,
      serverOrigin: bootstrap.serverOrigin,
    }
  })()
  try {
    return await bootstrapConnectionAttempt
  } finally {
    bootstrapConnectionAttempt = null
  }
}

async function ensureConnection() {
  const current = await connection()
  if (!current) return claimPackagedBootstrap()
  try {
    const health = await apiFetch("/api/extension/health")
    if (!isCurrentInsuHealth(health)) {
      await chrome.storage.local.remove(STORAGE_KEY)
      throw new Error("擴充功能版本與目前服務不一致，請重新下載")
    }
    return { paired: true, ...current, ...health }
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 ||
        error.code === "incompatible-extension-protocol")
    ) {
      await chrome.storage.local.remove(STORAGE_KEY)
    }
    throw error
  }
}

async function installPageUrl() {
  try {
    const response = await fetch(BOOTSTRAP_URL, { cache: "no-store" })
    if (!response.ok) return null
    const payload = await response.json()
    const serverOrigin = normalizeLoopbackOrigin(payload?.serverOrigin)
    return serverOrigin ? `${serverOrigin}/extension/download` : null
  } catch {
    return null
  }
}

async function recordNetworkCandidate(details, contentType = "") {
  if (details.tabId < 0 || !isSupportedMediaUrl(details.url, contentType)) return
  const tab = await chrome.tabs.get(details.tabId).catch(() => null)
  if (!tab?.url) return
  const candidate = {
    kind: "network-media",
    pageUrl: tab.url,
    frameUrl: details.documentUrl || details.initiator || tab.url,
    mediaUrl: details.url,
    contentType,
  }
  candidate.candidateFingerprint = await candidateFingerprint(candidate)
  const key = `${CANDIDATE_KEY_PREFIX}${details.tabId}`
  const current = (await chrome.storage.session.get(key))[key] || []
  if (current.some((item) => item.candidateFingerprint === candidate.candidateFingerprint)) {
    return
  }
  await chrome.storage.session.set({ [key]: [...current, candidate].slice(-80) })
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    void recordNetworkCandidate(details)
  },
  { urls: ["http://*/*", "https://*/*"], types: ["media", "xmlhttprequest", "other"] },
)

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const contentType =
      details.responseHeaders?.find(
        (header) => header.name.toLowerCase() === "content-type",
      )?.value || ""
    void recordNetworkCandidate(details, contentType)
  },
  { urls: ["http://*/*", "https://*/*"], types: ["media", "xmlhttprequest", "other"] },
  ["responseHeaders"],
)

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(`${CANDIDATE_KEY_PREFIX}${tabId}`)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    void chrome.storage.session.remove(`${CANDIDATE_KEY_PREFIX}${tabId}`)
  }
})

chrome.runtime.onInstalled.addListener(() => {
  void ensureConnection().catch(() => null)
})

chrome.runtime.onStartup.addListener(() => {
  void ensureConnection().catch(() => null)
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case "RETRY_CONNECTION":
        return ensureConnection()
      case "INSU_SERVER_ORIGIN": {
        const current = await connection()
        const serverOrigin = normalizeLoopbackOrigin(message.serverOrigin)
        if (!current?.token || !serverOrigin) return { updated: false }
        try {
          const health = await apiFetch(
            "/api/extension/health",
            {},
            { overrideOrigin: serverOrigin },
          )
          if (!isCurrentInsuHealth(health)) return { updated: false }
          await setConnection({ ...current, serverOrigin })
          return { updated: true }
        } catch {
          return { updated: false }
        }
      }
      case "GET_CONNECTION": {
        try {
          return await ensureConnection()
        } catch (error) {
          return {
            paired: false,
            error: error.message,
            errorCode: error.code || null,
            serverOrigin: error.serverOrigin || null,
          }
        }
      }
      case "GET_NETWORK_CANDIDATES": {
        const key = `${CANDIDATE_KEY_PREFIX}${message.tabId}`
        return { candidates: (await chrome.storage.session.get(key))[key] || [] }
      }
      case "CLEAR_NETWORK_CANDIDATES":
        await chrome.storage.session.remove(`${CANDIDATE_KEY_PREFIX}${message.tabId}`)
        return { cleared: true }
      case "API_REQUEST":
        return apiFetch(message.path, message.init)
      case "OPEN_LIBRARY": {
        const current = await connection()
        if (!current?.serverOrigin) throw new Error("尚未連接 INSU Player")
        await chrome.tabs.create({ url: `${current.serverOrigin}/extension/library` })
        return { opened: true }
      }
      case "OPEN_INSTALL": {
        const url = await installPageUrl()
        if (!url) throw new Error("找不到這份擴充功能對應的 INSU Player")
        await chrome.tabs.create({ url })
        return { opened: true }
      }
      default:
        return null
    }
  }
  run().then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: error.message }),
  )
  return true
})
