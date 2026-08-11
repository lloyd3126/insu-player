const PAIRING_MESSAGE = "INSU_PLAYER_PAIR"

function announceOrigin() {
  chrome.runtime.sendMessage({
    type: "INSU_SERVER_ORIGIN",
    serverOrigin: window.location.origin,
  })
}

window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    event.data?.type !== PAIRING_MESSAGE
  ) {
    return
  }
  chrome.runtime.sendMessage({
    type: "PAIR_WITH_INSU",
    payload: event.data.payload,
  })
})

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", announceOrigin, { once: true })
} else {
  announceOrigin()
}
