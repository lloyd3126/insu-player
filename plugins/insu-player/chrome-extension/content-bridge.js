(() => {
  function announceOrigin() {
    chrome.runtime.sendMessage({
      type: "INSU_SERVER_ORIGIN",
      serverOrigin: window.location.origin,
    })
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", announceOrigin, { once: true })
  } else {
    announceOrigin()
  }
})()
