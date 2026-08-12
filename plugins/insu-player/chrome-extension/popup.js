import { normalizeCandidates } from "./media-discovery.js"

const connectionElement = document.querySelector("#connection")
const connectSection = document.querySelector("#connect-section")
const retryConnectionButton = document.querySelector("#retry-connection")
const openInstallButton = document.querySelector("#open-install")
const sourceSection = document.querySelector("#source-section")
const pageTitleElement = document.querySelector("#page-title")
const enqueueButton = document.querySelector("#enqueue")
const feedback = document.querySelector("#feedback")
const openLibraryButton = document.querySelector("#open-library")

let activeTab = null
let candidates = []

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "擴充功能操作失敗"))
        return
      }
      resolve(response.result)
    })
  })
}

function setFeedback(message, error = false) {
  feedback.textContent = message
  feedback.dataset.error = error ? "true" : "false"
}

function scanFrame() {
  const pageUrl = window.top === window ? window.location.href : document.referrer || window.location.href
  const frameUrl = window.location.href
  const results = []
  for (const element of document.querySelectorAll("video, audio")) {
    const urls = [element.currentSrc, element.src]
    for (const source of element.querySelectorAll("source[src]")) urls.push(source.src)
    for (const mediaUrl of urls) {
      if (mediaUrl && /^https?:/i.test(mediaUrl)) {
        results.push({ kind: "network-media", pageUrl, frameUrl, mediaUrl })
      }
    }
  }
  for (const element of document.querySelectorAll("iframe[src], embed[src], object[data]")) {
    const value = element.src || element.data
    if (value && /^https?:/i.test(value)) {
      results.push({ kind: "embed", pageUrl, frameUrl: value })
    }
  }
  for (const entry of performance.getEntriesByType("resource")) {
    const mediaUrl = entry.name
    if (mediaUrl && /^https?:/i.test(mediaUrl)) {
      results.push({ kind: "network-media", pageUrl, frameUrl, mediaUrl })
    }
  }
  return { frameUrl, results }
}

async function inspectPage() {
  const [allFrames, network] = await Promise.all([
    chrome.scripting.executeScript({
      target: { tabId: activeTab.id, allFrames: true },
      func: scanFrame,
    }).catch(() => []),
    send({
      type: "GET_NETWORK_CANDIDATES",
      tabId: activeTab.id,
    }),
  ])
  const discovered = [
    { kind: "page", pageUrl: activeTab.url },
    ...allFrames.flatMap((entry) => entry.result?.results || []),
    ...(network.candidates || []),
  ]
  candidates = await normalizeCandidates(discovered)
  enqueueButton.disabled = candidates.length === 0
}

function candidateUrls(candidate) {
  const urls = []
  for (const value of [candidate.pageUrl, candidate.frameUrl, candidate.mediaUrl]) {
    if (value) urls.push(new URL(value))
  }
  return urls
}

function cookiePermissionOrigins(candidateGroup) {
  const origins = new Set()
  for (const candidate of candidateGroup) {
    for (const url of candidateUrls(candidate)) {
      origins.add(`${url.protocol}//${url.hostname}/*`)
    }
  }
  return [...origins]
}

function candidateHosts(candidateGroup) {
  const hosts = []
  for (const candidate of candidateGroup) {
    for (const url of candidateUrls(candidate)) hosts.push(url.hostname)
  }
  return hosts
}

function domainMatches(domain, host) {
  const value = domain.replace(/^\./, "").toLowerCase()
  return host === value || host.endsWith(`.${value}`)
}

async function collectCookies(candidateGroup) {
  const stores = await chrome.cookies.getAllCookieStores()
  const store = stores.find((item) => item.tabIds.includes(activeTab.id))
  const requests = []
  for (const candidate of candidateGroup) {
    for (const url of candidateUrls(candidate)) {
      requests.push(
        chrome.cookies.getAll({
          url: url.toString(),
          ...(store ? { storeId: store.id } : {}),
        }),
      )
    }
  }
  const cookies = (await Promise.all(requests)).flat()
  const hosts = candidateHosts(candidateGroup)
  const seen = new Set()
  const normalized = []
  for (const cookie of cookies) {
    if (!hosts.some((host) => domainMatches(cookie.domain, host))) continue
    const key = [cookie.name, cookie.domain, cookie.path, cookie.storeId].join("\n")
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      hostOnly: cookie.hostOnly,
      session: cookie.session,
      ...(cookie.expirationDate ? { expirationDate: cookie.expirationDate } : {}),
    })
  }
  return normalized
}

enqueueButton.addEventListener("click", async () => {
  if (!candidates.length) return
  enqueueButton.disabled = true
  setFeedback("正在加入下載佇列")
  try {
    const granted = await chrome.permissions.request({
      permissions: ["cookies"],
      origins: cookiePermissionOrigins(candidates),
    })
    if (!granted) {
      throw new Error("需要目前來源的 Cookie 權限才能加入下載佇列")
    }
    const authenticationConsentAt = new Date().toISOString()
    const cookies = await collectCookies(candidates)
    const session = await send({
      type: "API_REQUEST",
      path: "/api/extension/media-sessions",
      init: {
        method: "POST",
        body: JSON.stringify({
          candidates,
          cookies,
          authenticationConsentAt,
        }),
      },
    })
    await send({
      type: "API_REQUEST",
      path: "/api/extension/library/items",
      init: {
        method: "POST",
        body: JSON.stringify({
          rightsConfirmed: true,
          sources: [
            {
              kind: "page",
              pageUrl: candidates[0].pageUrl,
              sessionId: session.sessionId,
              candidateFingerprint: session.candidateFingerprint,
            },
          ],
        }),
      },
    })
    setFeedback("已加入下載佇列，可以到影片中心查看進度。")
    await send({ type: "CLEAR_NETWORK_CANDIDATES", tabId: activeTab.id }).catch(() => null)
  } catch (error) {
    setFeedback(error.message, true)
  } finally {
    enqueueButton.disabled = candidates.length === 0
  }
})

document.querySelector("#open-library").addEventListener("click", async () => {
  try {
    await send({ type: "OPEN_LIBRARY" })
    window.close()
  } catch (error) {
    setFeedback(error.message, true)
  }
})

retryConnectionButton.addEventListener("click", async () => {
  retryConnectionButton.disabled = true
  setFeedback("正在連接這份擴充功能對應的 INSU Player")
  try {
    await send({ type: "RETRY_CONNECTION" })
    await initialize()
  } catch (error) {
    setFeedback(error.message, true)
  } finally {
    retryConnectionButton.disabled = false
  }
})

openInstallButton.addEventListener("click", async () => {
  try {
    await send({ type: "OPEN_INSTALL" })
    window.close()
  } catch (error) {
    setFeedback(error.message, true)
  }
})

async function initialize() {
  try {
    ;[activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const status = await send({ type: "GET_CONNECTION" })
    if (!status.paired) {
      connectionElement.textContent = "尚未連接本機 INSU Player"
      connectionElement.dataset.online = "false"
      openLibraryButton.disabled = true
      connectSection.hidden = false
      sourceSection.hidden = true
      setFeedback(
        status.error || "無法自動連接，請確認產生這份 ZIP 的 INSU Player 已啟動。",
        true,
      )
      return
    }
    connectionElement.textContent = `已連接本機服務 · ${new URL(status.serverOrigin).port}`
    connectionElement.dataset.online = "true"
    openLibraryButton.disabled = false
    connectSection.hidden = true
    if (!activeTab?.id || !/^https?:/i.test(activeTab.url || "")) {
      setFeedback("目前分頁不是可加入的網頁", true)
      return
    }
    if (new URL(activeTab.url).origin === status.serverOrigin) {
      setFeedback("已連接。前往要加入的影音頁，再開啟擴充功能。")
      return
    }
    pageTitleElement.textContent = activeTab.title || activeTab.url
    sourceSection.hidden = false
    await inspectPage()
  } catch (error) {
    connectionElement.textContent = "無法連接本機 INSU Player"
    connectionElement.dataset.online = "false"
    setFeedback(error.message, true)
  }
}

void initialize()
