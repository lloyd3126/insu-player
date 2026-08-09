import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./plugins/insu-player/skills/watch-video/assets/server/drizzle",
  dbCredentials: {
    url: "./.local/insu-player/app.db",
  },
})
