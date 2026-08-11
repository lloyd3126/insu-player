import { normalizeCandidates } from "./media-discovery.js"

const connectionElement = document.querySelector("#connection")
const connectSection = document.querySelector("#connect-section")
const connectButton = document.querySelector("#connect-insu")
const sourceSection = document.querySelector("#source-section")
const pageTitleElement = document.querySelector("#page-title")
const candidateList = document.querySelector("#candidate-list")
const rightsInput = document.querySelector("#rights")
const sessionInput = document.querySelector("#use-session")
const enqueueButton = document.querySelector("#enqueue")
const advancedScanButton = document.querySelector("#advanced-scan")
const feedback = document.querySelector("#feedback")
const consentDialog = document.querySelector("#cookie-consent")
const cookieCancelButton = document.querySelector("#cookie-cancel")
const cookieConfirmButton = document.querySelector("#cookie-confirm")
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

function sourceLabel(candidate) {
  if (candidate.kind === "network-media") {
    return candidate.protocol === "hls" ? "HLS 串流" : "網路影音檔"
  }
  if (candidate.kind === "embed") return "嵌入播放器"
  return "目前頁面"
}

function renderCandidates() {
  candidateList.replaceChildren()
  candidates.forEach((candidate, index) => {
    const label = document.createElement("label")
    label.className = "candidate"
    const radio = document.createElement("input")
    radio.type = "radio"
    radio.name = "candidate"
    radio.value = String(index)
    radio.checked = index === 0
    const copy = document.createElement("span")
    const title = document.createElement("strong")
    title.textContent = sourceLabel(candidate)
    const detail = document.createElement("small")
    detail.textContent = candidate.mediaUrl || candidate.frameUrl || candidate.pageUrl
    copy.append(title, detail)
    label.append(radio, copy)
    candidateList.append(label)
  })
  enqueueButton.disabled = !rightsInput.checked || candidates.length === 0
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
  return { frameUrl, results }
}

async function inspectPage() {
  const topFrame = await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    func: scanFrame,
  }).catch(() => [])
  const allFrames = await chrome.scripting.executeScript({
    target: { tabId: activeTab.id, allFrames: true },
    func: scanFrame,
  }).catch(() => [])
  const network = await send({
    type: "GET_NETWORK_CANDIDATES",
    tabId: activeTab.id,
  })
  const discovered = [
    { kind: "page", pageUrl: activeTab.url },
    ...[...topFrame, ...allFrames].flatMap((entry) => entry.result?.results || []),
    ...(network.candidates || []),
  ]
  candidates = await normalizeCandidates(discovered)
  renderCandidates()
}

function candidateUrls(candidate) {
  return [candidate.pageUrl, candidate.frameUrl, candidate.mediaUrl]
    .filter(Boolean)
    .map((value) => new URL(value))
}

function cookiePermissionOrigins(candidate) {
  return [...new Set(candidateUrls(candidate).map((url) => `${url.protocol}//${url.hostname}/*`))]
}

async function confirmCookieTransfer(candidate) {
  consentDialog.showModal()
  return new Promise((resolve) => {
    const finish = (confirmed) => {
      cookieCancelButton.removeEventListener("click", cancel)
      cookieConfirmButton.removeEventListener("click", confirm)
      consentDialog.removeEventListener("cancel", cancel)
      consentDialog.close(confirmed ? "confirm" : "cancel")
      resolve(confirmed)
    }
    const cancel = () => finish(false)
    const confirm = async () => {
      cookieConfirmButton.disabled = true
      try {
        const granted = await chrome.permissions.request({
          permissions: ["cookies"],
          origins: cookiePermissionOrigins(candidate),
        })
        finish(granted)
      } catch {
        setFeedback("未取得本次登入狀態使用權限", true)
        finish(false)
      } finally {
        cookieConfirmButton.disabled = false
      }
    }
    cookieCancelButton.addEventListener("click", cancel)
    cookieConfirmButton.addEventListener("click", confirm)
    consentDialog.addEventListener("cancel", cancel)
  })
}

function candidateHosts(candidate) {
  return [candidate.pageUrl, candidate.frameUrl, candidate.mediaUrl]
    .filter(Boolean)
    .map((value) => new URL(value).hostname)
}

function domainMatches(domain, host) {
  const value = domain.replace(/^\./, "").toLowerCase()
  return host === value || host.endsWith(`.${value}`)
}

async function collectCookies(candidate) {
  const stores = await chrome.cookies.getAllCookieStores()
  const store = stores.find((item) => item.tabIds.includes(activeTab.id))
  const cookies = (
    await Promise.all(
      candidateUrls(candidate).map((url) =>
        chrome.cookies.getAll({
          url: url.toString(),
          ...(store ? { storeId: store.id } : {}),
        }),
      ),
    )
  ).flat()
  const hosts = candidateHosts(candidate)
  const seen = new Set()
  return cookies
    .filter((cookie) => hosts.some((host) => domainMatches(cookie.domain, host)))
    .filter((cookie) => {
      const key = [cookie.name, cookie.domain, cookie.path, cookie.storeId].join("\n")
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      hostOnly: cookie.hostOnly,
      session: cookie.session,
      ...(cookie.expirationDate ? { expirationDate: cookie.expirationDate } : {}),
    }))
}

async function releaseOptionalPermissions(candidate) {
  await chrome.permissions.remove({
    permissions: ["cookies"],
    origins: candidate ? cookiePermissionOrigins(candidate) : [],
  }).catch(() => false)
  await chrome.permissions.remove({
    origins: ["http://*/*", "https://*/*"],
  }).catch(() => false)
  await send({ type: "CLEAR_NETWORK_SCAN", tabId: activeTab.id }).catch(() => null)
}

rightsInput.addEventListener("change", () => {
  enqueueButton.disabled = !rightsInput.checked || candidates.length === 0
})

advancedScanButton.addEventListener("click", async () => {
  try {
    const granted = await chrome.permissions.request({
      origins: ["http://*/*", "https://*/*"],
    })
    if (!granted) throw new Error("未取得進階偵測權限")
    await send({ type: "START_NETWORK_SCAN", tabId: activeTab.id })
    setFeedback("已開始偵測。頁面會重新整理，播放一次影音後再開啟擴充功能。")
    await chrome.tabs.reload(activeTab.id)
    window.close()
  } catch (error) {
    setFeedback(error.message, true)
  }
})

enqueueButton.addEventListener("click", async () => {
  const selected = candidateList.querySelector('input[name="candidate"]:checked')
  const candidate = candidates[Number(selected?.value || 0)]
  if (!candidate || !rightsInput.checked) return
  enqueueButton.disabled = true
  setFeedback("正在加入下載佇列")
  try {
    let cookies = []
    let authenticationConsentAt
    if (sessionInput.checked) {
      if (!(await confirmCookieTransfer(candidate))) {
        setFeedback("已取消傳送登入狀態")
        return
      }
      authenticationConsentAt = new Date().toISOString()
      cookies = await collectCookies(candidate)
      if (cookies.length === 0) {
        throw new Error("目前來源沒有可用的登入 Cookie")
      }
    }
    let sessionId
    if (candidate.kind !== "page" || cookies.length > 0) {
      const session = await send({
        type: "API_REQUEST",
        path: "/api/extension/media-sessions",
        init: {
          method: "POST",
          body: JSON.stringify({
            candidate,
            ...(cookies.length ? { cookies, authenticationConsentAt } : {}),
          }),
        },
      })
      sessionId = session.sessionId
    }
    await send({
      type: "API_REQUEST",
      path: "/api/extension/library/items",
      init: {
        method: "POST",
        body: JSON.stringify({
          rightsConfirmed: true,
          sources: [
            {
              kind: candidate.kind,
              pageUrl: candidate.pageUrl,
              ...(sessionId ? { sessionId } : {}),
              candidateFingerprint: candidate.candidateFingerprint,
            },
          ],
        }),
      },
    })
    setFeedback("已加入下載佇列，可以到影片中心查看進度。")
  } catch (error) {
    setFeedback(error.message, true)
  } finally {
    await releaseOptionalPermissions(candidate)
    enqueueButton.disabled = !rightsInput.checked || candidates.length === 0
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

function activeTabOrigin() {
  if (!activeTab?.url) return null
  try {
    return new URL(activeTab.url).origin
  } catch {
    return null
  }
}

connectButton.addEventListener("click", async () => {
  const serverOrigin = activeTabOrigin()
  if (!activeTab?.id || !serverOrigin) return
  connectButton.disabled = true
  setFeedback("正在連接目前的 INSU Player")
  try {
    const status = await send({
      type: "CONNECT_CURRENT_INSU",
      tabId: activeTab.id,
      serverOrigin,
    })
    connectionElement.textContent = `已連接本機服務 · ${new URL(status.serverOrigin).port}`
    connectionElement.dataset.online = "true"
    connectSection.hidden = true
    openLibraryButton.disabled = false
    setFeedback("連接完成。現在可以前往影音頁，再從工具列加入下載佇列。")
  } catch (error) {
    setFeedback(error.message, true)
  } finally {
    connectButton.disabled = false
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
      const serverOrigin = activeTabOrigin()
      if (activeTab?.id && serverOrigin) {
        try {
          await send({
            type: "CHECK_CURRENT_INSU",
            tabId: activeTab.id,
            serverOrigin,
          })
          connectSection.hidden = false
          return
        } catch {
          // The user may be on an ordinary media page.
        }
      }
      setFeedback("請先在 Chrome 開啟 INSU Player 首頁，再點一次擴充功能。")
      return
    }
    connectionElement.textContent = `已連接本機服務 · ${new URL(status.serverOrigin).port}`
    connectionElement.dataset.online = "true"
    openLibraryButton.disabled = false
    if (!activeTab?.id || !/^https?:/i.test(activeTab.url || "")) {
      setFeedback("目前分頁不是可加入的網頁", true)
      return
    }
    if (activeTabOrigin() === status.serverOrigin) {
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
