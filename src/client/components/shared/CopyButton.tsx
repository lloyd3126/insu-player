import { CheckIcon, CopyIcon } from "lucide-react"
import { useRef, useState } from "react"

import { api } from "@/api/client"
import { Button } from "@/components/ui/button"

export function CopyButton({
  value,
  label = "複製提示",
  disabled = false,
  onCopied,
}: {
  value: string
  label?: string
  disabled?: boolean
  onCopied?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      void api.recordAgentIntent("prompt-copy", location.pathname).catch(() => undefined)
      setCopied(true)
      onCopied?.()
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 3_200)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Button
      variant={copied ? "secondary" : "outline"}
      disabled={disabled}
      onClick={copy}
    >
      {copied ? (
        <CheckIcon data-icon="inline-start" />
      ) : (
        <CopyIcon data-icon="inline-start" />
      )}
      {copied ? "已複製" : label}
    </Button>
  )
}
