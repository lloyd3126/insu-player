import { useVirtualizer } from "@tanstack/react-virtual"
import { useEffect, useRef, useState } from "react"

interface VirtualRowsOptions {
  count: number
  estimateSize: () => number
  overscan?: number
  gap?: number
  getItemKey?: (index: number) => React.Key
  scrollRef?: React.RefObject<HTMLDivElement | null>
}

export function useVirtualRows({
  count,
  estimateSize,
  overscan = 6,
  gap = 0,
  getItemKey,
  scrollRef: providedScrollRef,
}: VirtualRowsOptions) {
  const internalScrollRef = useRef<HTMLDivElement>(null)
  const scrollRef = providedScrollRef ?? internalScrollRef
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan,
    gap,
    getItemKey,
  })

  return {
    scrollRef,
    virtualizer,
    virtualRows: virtualizer.getVirtualItems(),
    totalSize: virtualizer.getTotalSize(),
  }
}

export function useObservedWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const updateWidth = () => setWidth(element.getBoundingClientRect().width)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return width
}
