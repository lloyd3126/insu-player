import { asc, eq } from "drizzle-orm"
import { z } from "zod"

import type { AppDatabase } from "@server/db/client"
import {
  subtitleStylePresets,
  subtitleStyleSettings,
} from "@server/db/schema"
import {
  DEFAULT_SUBTITLE_STYLES,
  SUBTITLE_SHADOWS,
  type SubtitleStylePreferences,
  type SubtitleStyleResponse,
} from "@shared/contracts/subtitle-style"

const SETTINGS_ID = "default"
const color = z.string().regex(/^#[0-9a-f]{6}$/i)
const textStyle = z
  .object({
    fontScale: z.number().finite().min(0.7).max(2),
    fontWeight: z.number().int().min(400).max(800),
    textColor: color,
    backgroundColor: color,
    backgroundOpacity: z.number().finite().min(0).max(1),
    lineHeight: z.number().finite().min(1).max(2),
    paddingX: z.number().finite().min(0).max(1.5),
    paddingY: z.number().finite().min(0).max(1),
    radius: z.number().finite().min(0).max(0.8),
    shadow: z.enum(SUBTITLE_SHADOWS),
    letterSpacing: z.number().finite().min(-0.05).max(0.1),
  })
  .strict()

export const subtitleStylePreferencesSchema = z
  .object({
    primary: textStyle,
    secondary: textStyle,
    bilingual: z.object({ gap: z.number().finite().min(0).max(2) }).strict(),
  })
  .strict()

export class SubtitleStyleOperationError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: 400 | 404 | 409 | 500,
  ) {
    super(message)
  }
}

function now() {
  return new Date().toISOString()
}

function parseStyles(value: unknown) {
  const parsed = subtitleStylePreferencesSchema.safeParse(value)
  if (!parsed.success) {
    throw new SubtitleStyleOperationError(
      "字幕樣式包含無效的數值",
      "invalid-subtitle-style",
      400,
    )
  }
  return parsed.data
}

export class SubtitleStyleService {
  constructor(private readonly db: AppDatabase) {
    this.ensureSettings()
  }

  private ensureSettings() {
    const timestamp = now()
    this.db
      .insert(subtitleStyleSettings)
      .values({
        id: SETTINGS_ID,
        activeStylesJson: DEFAULT_SUBTITLE_STYLES as unknown as Record<string, unknown>,
        activePresetId: null,
        updatedAt: timestamp,
      })
      .onConflictDoNothing()
      .run()
  }

  catalog(): SubtitleStyleResponse {
    this.ensureSettings()
    const settings = this.db
      .select()
      .from(subtitleStyleSettings)
      .where(eq(subtitleStyleSettings.id, SETTINGS_ID))
      .get()
    if (!settings) {
      throw new SubtitleStyleOperationError(
        "字幕樣式設定無法使用",
        "subtitle-style-unavailable",
        500,
      )
    }
    return {
      active: parseStyles(settings.activeStylesJson),
      activePresetId: settings.activePresetId,
      presets: this.db
        .select()
        .from(subtitleStylePresets)
        .orderBy(asc(subtitleStylePresets.name))
        .all()
        .map((preset) => ({
          id: preset.id,
          name: preset.name,
          styles: parseStyles(preset.stylesJson),
          createdAt: preset.createdAt,
          updatedAt: preset.updatedAt,
        })),
      updatedAt: settings.updatedAt,
    }
  }

  setActive(styles: SubtitleStylePreferences, presetId: string | null) {
    const normalized = parseStyles(styles)
    if (presetId) {
      const preset = this.db
        .select({ id: subtitleStylePresets.id })
        .from(subtitleStylePresets)
        .where(eq(subtitleStylePresets.id, presetId))
        .get()
      if (!preset) {
        throw new SubtitleStyleOperationError(
          "找不到字幕樣式",
          "subtitle-style-preset-not-found",
          404,
        )
      }
    }
    this.db
      .update(subtitleStyleSettings)
      .set({
        activeStylesJson: normalized as unknown as Record<string, unknown>,
        activePresetId: presetId,
        updatedAt: now(),
      })
      .where(eq(subtitleStyleSettings.id, SETTINGS_ID))
      .run()
    return this.catalog()
  }

  createPreset(name: string, styles: SubtitleStylePreferences) {
    const normalizedName = name.trim()
    if (!normalizedName || normalizedName.length > 80) {
      throw new SubtitleStyleOperationError(
        "樣式名稱需為 1 到 80 個字元",
        "invalid-subtitle-style-name",
        400,
      )
    }
    const timestamp = now()
    const id = `subtitle-style-${crypto.randomUUID()}`
    const normalized = parseStyles(styles)
    try {
      this.db.transaction((transaction) => {
        transaction
          .insert(subtitleStylePresets)
          .values({
            id,
            name: normalizedName,
            stylesJson: normalized as unknown as Record<string, unknown>,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .run()
        transaction
          .update(subtitleStyleSettings)
          .set({
            activeStylesJson: normalized as unknown as Record<string, unknown>,
            activePresetId: id,
            updatedAt: timestamp,
          })
          .where(eq(subtitleStyleSettings.id, SETTINGS_ID))
          .run()
      })
    } catch {
      throw new SubtitleStyleOperationError(
        "已經有同名的字幕樣式",
        "subtitle-style-name-conflict",
        409,
      )
    }
    return this.catalog()
  }

  updatePreset(id: string, name: string, styles: SubtitleStylePreferences) {
    const existing = this.db
      .select()
      .from(subtitleStylePresets)
      .where(eq(subtitleStylePresets.id, id))
      .get()
    if (!existing) {
      throw new SubtitleStyleOperationError(
        "找不到字幕樣式",
        "subtitle-style-preset-not-found",
        404,
      )
    }
    const normalizedName = name.trim()
    if (!normalizedName || normalizedName.length > 80) {
      throw new SubtitleStyleOperationError(
        "樣式名稱需為 1 到 80 個字元",
        "invalid-subtitle-style-name",
        400,
      )
    }
    const normalized = parseStyles(styles)
    try {
      this.db.transaction((transaction) => {
        transaction
          .update(subtitleStylePresets)
          .set({
            name: normalizedName,
            stylesJson: normalized as unknown as Record<string, unknown>,
            updatedAt: now(),
          })
          .where(eq(subtitleStylePresets.id, id))
          .run()
        transaction
          .update(subtitleStyleSettings)
          .set({
            activeStylesJson: normalized as unknown as Record<string, unknown>,
            activePresetId: id,
            updatedAt: now(),
          })
          .where(eq(subtitleStyleSettings.id, SETTINGS_ID))
          .run()
      })
    } catch {
      throw new SubtitleStyleOperationError(
        "已經有同名的字幕樣式",
        "subtitle-style-name-conflict",
        409,
      )
    }
    return this.catalog()
  }

  removePreset(id: string) {
    const removed = this.db
      .delete(subtitleStylePresets)
      .where(eq(subtitleStylePresets.id, id))
      .returning({ id: subtitleStylePresets.id })
      .get()
    if (!removed) {
      throw new SubtitleStyleOperationError(
        "找不到字幕樣式",
        "subtitle-style-preset-not-found",
        404,
      )
    }
    return this.catalog()
  }
}
