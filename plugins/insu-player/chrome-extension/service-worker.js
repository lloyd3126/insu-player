import {
  candidateFingerprint,
  isSupportedMediaUrl,
} from "./media-discovery.js"
import {
  CONNECTION_PROTOCOL_VERSION,
  CONNECT_REQUEST_MESSAGE,
  isConnectionChallenge,
  isCurrentInsuHealth,
  normalizeConnection,
  normalizeLoopbackOrigin,
} from "./connection-protocol.js"

const STORAGE_KEY = "insuConnection"
const SCAN_KEY = "insuScannedTabs"
const CANDIDATE_KEY_PREFIX = "insuCandidates:"

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

async function inspectInsuOrigin(value) {
  const serverOrigin = normalizeLoopbackOrigin(value)
  if (!serverOrigin) throw new Error("目前分頁不是本機 INSU Player")
  const response = await fetch(`${serverOrigin}/api/health`, {
    cache: "no-store",
  })
  const health = response.ok ? await response.json() : null
  if (!isCurrentInsuHealth(health)) {
    throw new Error("目前分頁不是相同版本的 INSU Player")
  }
  return { serverOrigin, health }
}

async function requestConnectionFromTab(tabId, message) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message)
    if (response) return response
  } catch {
    // A homepage that was open before installation does not have the content bridge yet.
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content-bridge.js"],
  })
  return chrome.tabs.sendMessage(tabId, message)
}

async function scannedTabs() {
  return new Set((await chrome.storage.session.get(SCAN_KEY))[SCAN_KEY] || [])
}

async function setScanning(tabId, enabled) {
  const tabs = await scannedTabs()
  if (enabled) tabs.add(tabId)
  else tabs.delete(tabId)
  await chrome.storage.session.set({ [SCAN_KEY]: [...tabs] })
}

async function recordNetworkCandidate(details, contentType = "") {
  if (details.tabId < 0 || !isSupportedMediaUrl(details.url, contentType)) return
  const tabs = await scannedTabs()
  if (!tabs.has(details.tabId)) return
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
  void setScanning(tabId, false)
  void chrome.storage.session.remove(`${CANDIDATE_KEY_PREFIX}${tabId}`)
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case "CONNECT_CURRENT_INSU": {
        const tab = await chrome.tabs.get(message.tabId).catch(() => null)
        const { serverOrigin } = await inspectInsuOrigin(message.serverOrigin)
        if (!tab?.url || new URL(tab.url).origin !== serverOrigin) {
          throw new Error("目前分頁已變更，請回到 INSU Player 後再試一次")
        }
        const requestId = `connect-${crypto.randomUUID()}`
        const bridgeResult = await requestConnectionFromTab(message.tabId, {
          type: "REQUEST_INSU_CONNECTION",
          requestId,
          pageMessageType: CONNECT_REQUEST_MESSAGE,
          protocolVersion: CONNECTION_PROTOCOL_VERSION,
        })
        if (!bridgeResult?.ok) {
          throw new Error(bridgeResult?.error || "INSU Player 首頁沒有回應連接要求")
        }
        const payload = bridgeResult.payload
        if (!isConnectionChallenge(payload, serverOrigin)) {
          throw new Error("INSU Player 回傳了無效或過期的連接資料")
        }
        const result = await apiFetch(
          "/api/extension/pairing/claim",
          {
            method: "POST",
            body: JSON.stringify({
              protocolVersion: CONNECTION_PROTOCOL_VERSION,
              challengeId: payload.challengeId,
              token: payload.token,
            }),
          },
          { overrideOrigin: serverOrigin, authenticated: false },
        )
        await setConnection({
          protocolVersion: CONNECTION_PROTOCOL_VERSION,
          serverOrigin,
          token: payload.token,
          connectedAt: new Date().toISOString(),
        })
        const health = await apiFetch("/api/extension/health")
        if (!isCurrentInsuHealth(health)) {
          await chrome.storage.local.remove(STORAGE_KEY)
          throw new Error("連接驗證失敗，請重新載入擴充功能後再試一次")
        }
        return { ...result, ...health, serverOrigin }
      }
      case "CHECK_CURRENT_INSU": {
        const tab = await chrome.tabs.get(message.tabId).catch(() => null)
        const inspected = await inspectInsuOrigin(message.serverOrigin)
        if (!tab?.url || new URL(tab.url).origin !== inspected.serverOrigin) {
          throw new Error("目前分頁不是本機 INSU Player")
        }
        return { available: true, serverOrigin: inspected.serverOrigin }
      }
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
        const current = await connection()
        if (!current) return { paired: false }
        try {
          const health = await apiFetch("/api/extension/health")
          if (!isCurrentInsuHealth(health)) {
            await chrome.storage.local.remove(STORAGE_KEY)
            return { paired: false, error: "擴充功能版本與目前服務不一致" }
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
          return { paired: false, error: error.message }
        }
      }
      case "START_NETWORK_SCAN":
        await setScanning(message.tabId, true)
        await chrome.storage.session.remove(`${CANDIDATE_KEY_PREFIX}${message.tabId}`)
        return { scanning: true }
      case "GET_NETWORK_CANDIDATES": {
        const key = `${CANDIDATE_KEY_PREFIX}${message.tabId}`
        return { candidates: (await chrome.storage.session.get(key))[key] || [] }
      }
      case "CLEAR_NETWORK_SCAN":
        await setScanning(message.tabId, false)
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
