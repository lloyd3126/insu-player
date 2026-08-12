import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { openAppDatabase } from "@server/db/client"
import { SubtitleStyleService } from "@server/services/subtitle-style-service"
import { DEFAULT_SUBTITLE_STYLES } from "@shared/contracts/subtitle-style"

const schema = path.resolve(
  "plugins/insu-player/skills/watch-video/assets/server/current-schema.sql",
)
const workspaces: string[] = []

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true })
  }
})

function service() {
  const workspace = mkdtempSync(path.join(tmpdir(), "insu-player-styles-"))
  workspaces.push(workspace)
  const opened = openAppDatabase(path.join(workspace, "app.db"), schema)
  return { styles: new SubtitleStyleService(opened.db), sqlite: opened.sqlite }
}

describe("subtitle style persistence", () => {
  test("persists scalar preferences and named presets in SQLite", () => {
    const { styles, sqlite } = service()
    const custom = {
      ...DEFAULT_SUBTITLE_STYLES,
      primary: {
        ...DEFAULT_SUBTITLE_STYLES.primary,
        fontScale: 1.18,
        textColor: "#cdefff",
      },
      bilingual: { gap: 0.72 },
    }

    const created = styles.createPreset("閱讀模式", custom)
    const preset = created.presets[0]
    expect(preset).toMatchObject({ name: "閱讀模式", styles: custom })
    expect(created).toMatchObject({ active: custom, activePresetId: preset.id })
    const reopened = openAppDatabase(path.join(workspaces[0], "app.db"), schema)
    const reopenedStyles = new SubtitleStyleService(reopened.db)
    expect(reopenedStyles.catalog()).toMatchObject({
      active: custom,
      activePresetId: preset.id,
      presets: [{ id: preset.id, name: "閱讀模式", styles: custom }],
    })
    reopened.sqlite.close()
    sqlite.close()
  })

  test("rejects invalid scalar values instead of coercing them", () => {
    const { styles, sqlite } = service()
    expect(() =>
      styles.setActive(
        {
          ...DEFAULT_SUBTITLE_STYLES,
          primary: { ...DEFAULT_SUBTITLE_STYLES.primary, fontScale: 4 },
        },
        null,
      ),
    ).toThrow("字幕樣式包含無效的數值")
    sqlite.close()
  })
})
