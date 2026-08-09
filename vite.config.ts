import path from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"

const reactScanModuleId = "virtual:insu-react-scan"
const resolvedReactScanModuleId = `\0${reactScanModuleId}`

function reactScanLoader(enabled: boolean): Plugin {
  return {
    name: "insu-react-scan-loader",
    resolveId(id) {
      return id === reactScanModuleId ? resolvedReactScanModuleId : undefined
    },
    load(id) {
      if (id !== resolvedReactScanModuleId) {
        return undefined
      }

      return enabled
        ? `
            import { scan } from "react-scan"

            const events = []
            const profiler = {
              events,
              clear() {
                events.length = 0
              },
              summary() {
                const components = {}
                let renderCount = 0
                let totalTime = 0
                for (const event of events) {
                  renderCount += event.count
                  totalTime += event.time
                  const current = components[event.componentName] ?? {
                    renderCount: 0,
                    totalTime: 0,
                  }
                  current.renderCount += event.count
                  current.totalTime += event.time
                  components[event.componentName] = current
                }
                return { renderCount, totalTime, components }
              },
            }
            globalThis.__INSU_REACT_SCAN__ = profiler

            scan({
              enabled: true,
              showToolbar: true,
              onRender(_fiber, renders) {
                for (const render of renders) {
                  events.push({
                    componentName: render.componentName ?? "Unknown",
                    count: render.count,
                    time: render.time ?? 0,
                  })
                }
                if (events.length > 20_000) {
                  events.splice(0, 10_000)
                }
              },
            })
          `
        : "export {}"
    },
  }
}

export default defineConfig(({ command }) => {
  const reactScanEnabled =
    command === "serve" && process.env.INSU_REACT_SCAN === "1"

  return {
    plugins: [reactScanLoader(reactScanEnabled), react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src/client"),
        "@shared": path.resolve(import.meta.dirname, "./src/shared"),
        "@server": path.resolve(import.meta.dirname, "./src/server"),
        "@library-assets": path.resolve(
          import.meta.dirname,
          "./plugins/insu-player/skills/watch-video/assets/library",
        ),
      },
    },
    server: {
      host: "127.0.0.1",
      proxy: {
        "/api": "http://127.0.0.1:8000",
        "/watch": "http://127.0.0.1:8000",
        "/media": "http://127.0.0.1:8000",
        "/captions": "http://127.0.0.1:8000",
        "/thumbnails": "http://127.0.0.1:8000",
      },
    },
    build: {
      outDir: "plugins/insu-player/skills/watch-video/assets/library/app",
      emptyOutDir: true,
      sourcemap: false,
    },
  }
})
