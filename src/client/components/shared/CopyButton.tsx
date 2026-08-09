import { CheckIcon, CopyIcon } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"

export function CopyButton({
  value,
  label = "複製提示",
}: {
  value: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 3_200)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Button variant={copied ? "secondary" : "outline"} onClick={copy}>
      {copied ? (
        <CheckIcon data-icon="inline-start" />
      ) : (
        <CopyIcon data-icon="inline-start" />
      )}
      {copied ? "已複製" : label}
    </Button>
  )
}
