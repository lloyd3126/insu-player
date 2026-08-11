(() => {
  const CONNECT_REQUEST_MESSAGE = "INSU_EXTENSION_CONNECT_REQUEST"
  const CONNECT_RESPONSE_MESSAGE = "INSU_EXTENSION_CONNECT_RESPONSE"
  const CONNECTION_PROTOCOL_VERSION = 2
  const RESPONSE_TIMEOUT_MS = 10_000

  function announceOrigin() {
    chrome.runtime.sendMessage({
      type: "INSU_SERVER_ORIGIN",
      serverOrigin: window.location.origin,
    })
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (
      message?.type !== "REQUEST_INSU_CONNECTION" ||
      message.pageMessageType !== CONNECT_REQUEST_MESSAGE ||
      message.protocolVersion !== CONNECTION_PROTOCOL_VERSION ||
      !/^connect-[0-9a-f-]{36}$/.test(message.requestId || "")
    ) {
      return false
    }

    const handleResponse = (event) => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.type !== CONNECT_RESPONSE_MESSAGE ||
        event.data?.protocolVersion !== CONNECTION_PROTOCOL_VERSION ||
        event.data?.requestId !== message.requestId
      ) {
        return
      }
      cleanup()
      sendResponse(
        event.data.error
          ? { ok: false, error: event.data.error }
          : { ok: true, payload: event.data.payload },
      )
    }
    const timeoutId = window.setTimeout(() => {
      cleanup()
      sendResponse({ ok: false, error: "INSU Player 首頁連接逾時" })
    }, RESPONSE_TIMEOUT_MS)
    const cleanup = () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener("message", handleResponse)
    }
    window.addEventListener("message", handleResponse)
    window.postMessage(
      {
        type: CONNECT_REQUEST_MESSAGE,
        protocolVersion: CONNECTION_PROTOCOL_VERSION,
        requestId: message.requestId,
      },
      window.location.origin,
    )
    return true
  })

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", announceOrigin, { once: true })
  } else {
    announceOrigin()
  }
})()
