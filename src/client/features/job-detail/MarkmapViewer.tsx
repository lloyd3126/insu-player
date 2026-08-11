import {
  DownloadIcon,
  ImageIcon,
  Maximize2Icon,
  MinusIcon,
  NetworkIcon,
  PlusIcon,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type MarkmapInstance = import("markmap-view").Markmap

function ToolbarButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button type="button" size="icon-sm" variant="outline" aria-label={label} {...props} />}
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function MarkmapViewer({ content, title }: { content: string; title: string }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const markmapRef = useRef<MarkmapInstance | null>(null)
  const sourceDataRef = useRef<ReturnType<import("markmap-lib").Transformer["transform"]>["root"] | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    setRenderError(null)
    void Promise.all([import("markmap-lib"), import("markmap-view")]).then(
      ([{ Transformer }, { Markmap }]) => {
        if (disposed || !svgRef.current) return
        markmapRef.current?.destroy()
        const result = new Transformer().transform(content)
        sourceDataRef.current = result.root
        markmapRef.current = Markmap.create(
          svgRef.current,
          {
            autoFit: true,
            duration: 180,
            maxWidth: 280,
            initialExpandLevel: -1,
            pan: true,
            zoom: true,
          },
          result.root,
        )
        setCollapsed(false)
      },
    ).catch((error: unknown) => {
      if (!disposed) {
        setRenderError(error instanceof Error ? error.message : "心智圖載入失敗")
      }
    })
    return () => {
      disposed = true
      markmapRef.current?.destroy()
      markmapRef.current = null
    }
  }, [content])

  const toggleTree = () => {
    const root = sourceDataRef.current
    const markmap = markmapRef.current
    if (!root || !markmap) return
    const nextCollapsed = !collapsed
    const clone = structuredClone(root)
    const visit = (node: typeof clone, depth = 0) => {
      node.payload = { ...node.payload, fold: nextCollapsed && depth === 1 ? 1 : 0 }
      node.children.forEach((child) => visit(child, depth + 1))
    }
    visit(clone)
    sourceDataRef.current = clone
    setCollapsed(nextCollapsed)
    void markmap.setData(clone).then(() => markmap.fit()).catch((error: unknown) => {
      setRenderError(error instanceof Error ? error.message : "心智圖更新失敗")
    })
  }

  const exportName = () =>
    title.replace(/[^A-Za-z0-9._-]+/g, "-") || "mindmap"

  const serializedSvg = () => {
    const svg = svgRef.current
    if (!svg) return null
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
    clone.setAttribute("width", String(Math.max(1200, svg.clientWidth * 2)))
    clone.setAttribute("height", String(Math.max(800, svg.clientHeight * 2)))
    return clone.outerHTML
  }

  const downloadBlob = (blob: Blob, extension: string) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${exportName()}.${extension}`
    link.click()
    URL.revokeObjectURL(url)
  }

  const exportSvg = () => {
    const source = serializedSvg()
    if (!source) return
    downloadBlob(
      new Blob([source], { type: "image/svg+xml;charset=utf-8" }),
      "svg",
    )
  }

  const exportPng = async () => {
    const source = serializedSvg()
    if (!source) return
    try {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error("心智圖無法轉換為 PNG"))
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`
      })
      const canvas = document.createElement("canvas")
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext("2d")
      if (!context) throw new Error("瀏覽器不支援 PNG 匯出")
      context.fillStyle = "#0d0e0f"
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0)
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) => result ? resolve(result) : reject(new Error("PNG 匯出失敗")),
          "image/png",
        ),
      )
      downloadBlob(blob, "png")
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : "PNG 匯出失敗")
    }
  }

  return (
    <section className="mindmap-viewer" aria-label="影音摘要心智圖">
      <div className="mindmap-toolbar" aria-label="心智圖工具列">
        <ToolbarButton label="放大" onClick={() => void markmapRef.current?.rescale(1.2)}>
          <PlusIcon />
        </ToolbarButton>
        <ToolbarButton label="縮小" onClick={() => void markmapRef.current?.rescale(0.8)}>
          <MinusIcon />
        </ToolbarButton>
        <ToolbarButton label="符合畫面" onClick={() => void markmapRef.current?.fit()}>
          <Maximize2Icon />
        </ToolbarButton>
        <ToolbarButton label={collapsed ? "展開節點" : "收合節點"} onClick={toggleTree}>
          <NetworkIcon />
        </ToolbarButton>
        <ToolbarButton label="匯出 SVG" onClick={exportSvg}>
          <DownloadIcon />
        </ToolbarButton>
        <ToolbarButton label="匯出 PNG" onClick={() => void exportPng()}>
          <ImageIcon />
        </ToolbarButton>
      </div>
      {renderError ? <p className="mindmap-error" role="alert">{renderError}</p> : null}
      <svg ref={svgRef} className="mindmap-canvas" role="img" aria-label={title} />
    </section>
  )
}
