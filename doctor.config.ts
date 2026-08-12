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
      {
        // These services receive one trusted workspace root from local server
        // bootstrap. Browser inputs are validated IDs, never filesystem roots.
        files: [
          "src/server/services/local-model-service.ts",
          "src/server/services/media-session-service.ts",
          "src/server/services/provider-credential-service.ts",
          "src/server/services/removal-service.ts",
          "src/server/services/runtime-service.ts",
        ],
        rules: ["react-doctor/tenant-static-proxy-risk"],
      },
      {
        // returnTo is validated same-origin modal navigation state. It never
        // executes a mutation or authorizes a privileged operation.
        files: ["src/client/app/overlay-routes.ts"],
        rules: ["react-doctor/url-prefilled-privileged-action"],
      },
      {
        // This namespace object is the intentional compound-component API.
        files: ["src/client/features/resources/ModelDetailsDialog.tsx"],
        rules: ["react-doctor/only-export-components"],
      },
    ],
  },
})
