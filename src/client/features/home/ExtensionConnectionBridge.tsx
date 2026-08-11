import { useEffect } from "react"

import { api } from "@/api/client"
import {
  EXTENSION_CONNECTION_PROTOCOL_VERSION,
  EXTENSION_CONNECT_REQUEST_MESSAGE,
  EXTENSION_CONNECT_RESPONSE_MESSAGE,
  type ExtensionConnectRequestMessage,
  type ExtensionConnectResponseMessage,
} from "@shared/contracts/browser-extension"

const REQUEST_ID_PATTERN = /^connect-[0-9a-f-]{36}$/

function isConnectRequest(value: unknown): value is ExtensionConnectRequestMessage {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ExtensionConnectRequestMessage>
  return (
    candidate.type === EXTENSION_CONNECT_REQUEST_MESSAGE &&
    candidate.protocolVersion === EXTENSION_CONNECTION_PROTOCOL_VERSION &&
    typeof candidate.requestId === "string" &&
    REQUEST_ID_PATTERN.test(candidate.requestId)
  )
}

export function ExtensionConnectionBridge() {
  useEffect(() => {
    const handleConnectRequest = async (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        !isConnectRequest(event.data)
      ) {
        return
      }

      const response: ExtensionConnectResponseMessage = {
        type: EXTENSION_CONNECT_RESPONSE_MESSAGE,
        protocolVersion: EXTENSION_CONNECTION_PROTOCOL_VERSION,
        requestId: event.data.requestId,
      }
      try {
        response.payload = await api.startExtensionPairing()
      } catch {
        response.error = "目前無法建立連接，請確認本機服務仍在運作"
      }
      window.postMessage(response, window.location.origin)
    }

    window.addEventListener("message", handleConnectRequest)
    return () => window.removeEventListener("message", handleConnectRequest)
  }, [])

  return null
}
