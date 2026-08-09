/// <reference types="vite/client" />

declare module "virtual:insu-react-scan"

interface Window {
  __INSU_REACT_SCAN__?: {
    events: Array<{
      componentName: string
      count: number
      time: number
    }>
    clear: () => void
    summary: () => {
      renderCount: number
      totalTime: number
      components: Record<
        string,
        { renderCount: number; totalTime: number }
      >
    }
  }
}
