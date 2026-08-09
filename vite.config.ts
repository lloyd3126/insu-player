import path from "node:path"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
})
