import { defineConfig } from "react-doctor/api"

export default defineConfig({
  blocking: "none",
  noScore: true,
  share: false,
  supplyChain: {
    enabled: false,
  },
  ignore: {
    files: [
      ".local/**",
      "plugins/insu-player/skills/watch-video/assets/library/app/**",
      "plugins/insu-player/skills/watch-video/assets/server/insu-player-server.js",
      "playwright-report/**",
      "test-results/**",
    ],
    overrides: [
      {
        // INSU Player is a single-user localhost service. These roots come
        // from the trusted workspace/runtime configuration; user-facing IDs
        // are separately validated and contained before filesystem access.
        files: [
          "src/server/bun.ts",
          "src/server/repositories/job-repository.ts",
          "src/server/services/resource-service.ts",
        ],
        rules: ["react-doctor/tenant-static-proxy-risk"],
      },
    ],
  },
})
