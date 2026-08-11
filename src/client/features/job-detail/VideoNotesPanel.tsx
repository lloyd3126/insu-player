import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PencilIcon, PlayIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"
import { useState } from "react"

import { api } from "@/api/client"
import { useOverlay } from "@/app/overlay-context"
import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { formatDuration } from "@shared/domain/format"
import type { JobDetail } from "@shared/contracts/job"
import type { SaveVideoNoteRequest, VideoNote } from "@shared/contracts/notes"

function NoteEditor({
  job,
  note,
  onDone,
}: {
  job: JobDetail
  note?: VideoNote
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(() => note?.title ?? "")
  const [body, setBody] = useState(() => note?.body ?? "")
  const [tags, setTags] = useState(() => note?.tags.join(", ") ?? "")
  const [includeTime, setIncludeTime] = useState(
    () => note?.startSeconds !== null || !note,
  )
  const save = useMutation({
    mutationFn: (request: SaveVideoNoteRequest) =>
      note
        ? api.updateNote(job.videoId, note.id, request)
        : api.createNote(job.videoId, request),
    onSuccess: (data) => {
      queryClient.setQueryData(["notes", job.videoId], data)
      onDone()
    },
  })
  return (
    <form
      className="note-editor"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate({
          title,
          body,
          startSeconds: includeTime
            ? (note?.startSeconds ?? job.playback.time ?? 0)
            : null,
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        })
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="note-title">標題</FieldLabel>
          <Input
            id="note-title"
            value={title}
            maxLength={200}
            placeholder="選填"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="note-body">筆記</FieldLabel>
          <Textarea
            id="note-body"
            value={body}
            rows={5}
            maxLength={20_000}
            required
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="note-tags">標籤</FieldLabel>
          <Input
            id="note-tags"
            value={tags}
            placeholder="以半形逗號分隔"
            onChange={(event) => setTags(event.target.value)}
          />
          <FieldDescription>
            {includeTime
              ? `會連結到 ${formatDuration(note?.startSeconds ?? job.playback.time ?? 0)}`
              : "不連結播放時間"}
          </FieldDescription>
        </Field>
      </FieldGroup>
      <div className="note-editor__actions">
        <Button
          type="button"
          variant="outline"
          onClick={() => setIncludeTime((value) => !value)}
        >
          {includeTime ? "移除時間" : "加入目前時間"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          <XIcon data-icon="inline-start" />
          取消
        </Button>
        <Button type="submit" disabled={!body.trim() || save.isPending}>
          儲存筆記
        </Button>
      </div>
      {save.isError ? <ErrorState message={save.error.message} /> : null}
    </form>
  )
}

export function VideoNotesPanel({ job }: { job: JobDetail }) {
  const overlay = useOverlay()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<VideoNote | "new" | null>(null)
  const notes = useQuery({
    queryKey: ["notes", job.videoId],
    queryFn: () => api.notes(job.videoId),
  })
  const remove = useMutation({
    mutationFn: (noteId: string) => api.removeNote(job.videoId, noteId),
    onSuccess: (data) => queryClient.setQueryData(["notes", job.videoId], data),
  })

  return (
    <div className="video-notes-panel">
      <div className="video-notes-toolbar">
        <div>
          <strong>我的影音筆記</strong>
          <small>可以記錄觀看時間、想法與標籤</small>
        </div>
        <Button onClick={() => setEditing("new")}>
          <PlusIcon data-icon="inline-start" />
          新增筆記
        </Button>
      </div>
      {editing ? (
        <NoteEditor
          key={editing === "new" ? "new" : editing.id}
          job={job}
          note={editing === "new" ? undefined : editing}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {notes.isPending ? <LoadingState label="正在讀取筆記" /> : null}
      {notes.isError ? <ErrorState message={notes.error.message} /> : null}
      {remove.isError ? <ErrorState message={remove.error.message} /> : null}
      {notes.data?.notes.length === 0 && !editing ? (
        <div className="summary-empty-state">尚未建立影音筆記</div>
      ) : null}
      <div className="video-note-list">
        {notes.data?.notes.map((note) => (
          <article className="video-note" key={note.id}>
            <div className="video-note__heading">
              <div>
                <strong>{note.title || "未命名筆記"}</strong>
                <small>{new Date(note.updatedAt).toLocaleString("zh-TW")}</small>
              </div>
              <div>
                {note.startSeconds !== null ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      overlay.actions.open({
                        type: "player",
                        videoId: job.videoId,
                        time: note.startSeconds ?? 0,
                      })
                    }
                  >
                    <PlayIcon data-icon="inline-start" />
                    {formatDuration(note.startSeconds)}
                  </Button>
                ) : null}
                <Button size="icon-sm" variant="ghost" aria-label="編輯筆記" onClick={() => setEditing(note)}>
                  <PencilIcon />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="刪除筆記" onClick={() => remove.mutate(note.id)}>
                  <Trash2Icon />
                </Button>
              </div>
            </div>
            <p>{note.body}</p>
            {note.tags.length ? (
              <div className="video-note__tags">
                {note.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  )
}
