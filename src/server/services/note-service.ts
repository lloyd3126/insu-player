import { and, desc, eq, inArray } from "drizzle-orm"

import type { AppDatabase } from "@server/db/client"
import { noteAnchors, notes, tagAssignments, tags } from "@server/db/schema"
import type {
  SaveVideoNoteRequest,
  VideoNote,
  VideoNotesResponse,
} from "@shared/contracts/notes"

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/

export class NoteOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export class NoteService {
  constructor(private readonly db: AppDatabase) {}

  list(videoId: string): VideoNotesResponse {
    const rows = this.db
      .select()
      .from(notes)
      .leftJoin(noteAnchors, eq(noteAnchors.noteId, notes.id))
      .where(eq(notes.videoId, videoId))
      .orderBy(desc(notes.updatedAt))
      .all()
    const ids = rows.map((row) => row.notes.id)
    const assigned = ids.length
      ? this.db
          .select({ resourceId: tagAssignments.resourceId, name: tags.name })
          .from(tagAssignments)
          .innerJoin(tags, eq(tags.id, tagAssignments.tagId))
          .where(
            and(
              eq(tagAssignments.resourceType, "note"),
              inArray(tagAssignments.resourceId, ids),
            ),
          )
          .all()
      : []
    const names = new Map<string, string[]>()
    for (const row of assigned) {
      names.set(row.resourceId, [...(names.get(row.resourceId) ?? []), row.name])
    }
    return {
      videoId,
      notes: rows.map((row) => ({
        ...row.notes,
        startSeconds: row.note_anchors?.startSeconds ?? null,
        endSeconds: row.note_anchors?.endSeconds ?? null,
        subtitleTrackId: row.note_anchors?.subtitleTrackId ?? null,
        subtitleCueId: row.note_anchors?.subtitleCueId ?? null,
        tags: names.get(row.notes.id) ?? [],
      })),
    }
  }

  create(videoId: string, request: SaveVideoNoteRequest) {
    return this.save(videoId, crypto.randomUUID(), request, true)
  }

  update(videoId: string, noteId: string, request: SaveVideoNoteRequest) {
    return this.save(videoId, noteId, request, false)
  }

  remove(videoId: string, noteId: string) {
    if (!ID_PATTERN.test(noteId)) throw new NoteOperationError("invalid-note", "筆記識別碼無效")
    const existing = this.db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.videoId, videoId), eq(notes.id, noteId)))
      .get()
    if (!existing) throw new NoteOperationError("not-found", "找不到筆記")
    this.db
      .delete(notes)
      .where(and(eq(notes.videoId, videoId), eq(notes.id, noteId)))
      .run()
    return this.list(videoId)
  }

  private save(
    videoId: string,
    noteId: string,
    request: SaveVideoNoteRequest,
    creating: boolean,
  ) {
    const title = request.title.trim()
    const body = request.body.trim()
    if (!body || body.length > 20_000 || title.length > 200) {
      throw new NoteOperationError("invalid-note", "筆記內容無效或過長")
    }
    const start = request.startSeconds ?? null
    const end = request.endSeconds ?? null
    if (
      (start !== null && (!Number.isFinite(start) || start < 0)) ||
      (end !== null && (!Number.isFinite(end) || end < 0 || start === null || end < start))
    ) {
      throw new NoteOperationError("invalid-anchor", "筆記時間位置無效")
    }
    const normalizedTags = [...new Set((request.tags ?? []).map((tag) => tag.trim()).filter(Boolean))]
    if (normalizedTags.length > 20 || normalizedTags.some((tag) => tag.length > 40)) {
      throw new NoteOperationError("invalid-tags", "筆記標籤無效")
    }
    const now = new Date().toISOString()
    this.db.transaction((transaction) => {
      if (!creating) {
        const existing = transaction
          .select({ id: notes.id })
          .from(notes)
          .where(and(eq(notes.videoId, videoId), eq(notes.id, noteId)))
          .get()
        if (!existing) throw new NoteOperationError("not-found", "找不到筆記")
      }
      transaction
        .insert(notes)
        .values({ id: noteId, videoId, title, body, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: notes.id,
          set: { title, body, updatedAt: now },
        })
        .run()
      transaction.delete(noteAnchors).where(eq(noteAnchors.noteId, noteId)).run()
      if (start !== null) {
        transaction
          .insert(noteAnchors)
          .values({
            noteId,
            startSeconds: Math.round(start * 1000) / 1000,
            endSeconds: end === null ? null : Math.round(end * 1000) / 1000,
            subtitleTrackId: request.subtitleTrackId ?? null,
            subtitleCueId: request.subtitleCueId ?? null,
          })
          .run()
      }
      transaction
        .delete(tagAssignments)
        .where(
          and(
            eq(tagAssignments.resourceType, "note"),
            eq(tagAssignments.resourceId, noteId),
          ),
        )
        .run()
      for (const name of normalizedTags) {
        const id = `tag-${Bun.hash(name.toLocaleLowerCase("zh-TW")).toString(16)}`
        transaction
          .insert(tags)
          .values({ id, name, createdAt: now })
          .onConflictDoNothing()
          .run()
        transaction
          .insert(tagAssignments)
          .values({ tagId: id, resourceType: "note", resourceId: noteId, createdAt: now })
          .run()
      }
    })
    return this.list(videoId)
  }
}
