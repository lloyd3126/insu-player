import {
  candidateFingerprint,
  isSupportedMediaUrl,
} from "./media-discovery.js"

const STORAGE_KEY = "insuConnection"
const SCAN_KEY = "insuScannedTabs"
const CANDIDATE_KEY_PREFIX = "insuCandidates:"

async function connection() {
  return (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || null
}

async function setConnection(value) {
  await chrome.storage.local.set({ [STORAGE_KEY]: value })
}

async function apiFetch(path, init = {}, overrideOrigin) {
  const current = await connection()
  const serverOrigin = overrideOrigin || current?.serverOrigin
  if (!serverOrigin) throw new Error("尚未連接 INSU Player")
  const headers = new Headers(init.headers || {})
  if (current?.token) headers.set("X-INSU-Extension-Token", current.token)
  if (init.body) headers.set("Content-Type", "application/json")
  const response = await fetch(`${serverOrigin}${path}`, { ...init, headers })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || `INSU Player 回應 ${response.status}`)
  }
  return response.json()
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
      case "PAIR_WITH_INSU": {
        const payload = message.payload
        const result = await apiFetch(
          "/api/extension/pairing/claim",
          {
            method: "POST",
            body: JSON.stringify({
              challengeId: payload.challengeId,
              token: payload.token,
            }),
          },
          payload.serverOrigin,
        )
        await setConnection({
          serverOrigin: payload.serverOrigin,
          token: payload.token,
          pairedAt: new Date().toISOString(),
        })
        return result
      }
      case "INSU_SERVER_ORIGIN": {
        const current = await connection()
        if (!current?.token || !message.serverOrigin) return { updated: false }
        try {
          await apiFetch("/api/extension/health", {}, message.serverOrigin)
          await setConnection({ ...current, serverOrigin: message.serverOrigin })
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
          return { paired: true, ...current, ...health }
        } catch (error) {
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
