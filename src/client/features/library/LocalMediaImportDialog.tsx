import { useQueryClient } from "@tanstack/react-query"
import { UploadIcon } from "lucide-react"
import { useReducer, useRef } from "react"

import { api } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { LibraryResponse } from "@shared/contracts/library"
import { formatBytes } from "@shared/domain/format"

const ACCEPT = ".mp4,.m4v,.mov,.mkv,.webm,video/mp4,video/quicktime,video/webm,video/x-matroska"

function titleFromFile(file: File) {
  return file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim()
}

interface ImportDialogState {
  open: boolean
  file: File | null
  title: string
  rightsConfirmed: boolean
  pending: boolean
  error: string | null
}

type ImportDialogAction =
  | { type: "select"; file: File }
  | { type: "title"; value: string }
  | { type: "rights"; value: boolean }
  | { type: "open"; value: boolean }
  | { type: "start" }
  | { type: "submitted" }
  | { type: "failed"; message: string }

const initialState: ImportDialogState = {
  open: false,
  file: null,
  title: "",
  rightsConfirmed: false,
  pending: false,
  error: null,
}

function reducer(
  state: ImportDialogState,
  action: ImportDialogAction,
): ImportDialogState {
  switch (action.type) {
    case "select":
      return {
        ...state,
        open: true,
        file: action.file,
        title: titleFromFile(action.file),
        rightsConfirmed: false,
        error: null,
      }
    case "title":
      return { ...state, title: action.value }
    case "rights":
      return { ...state, rightsConfirmed: action.value }
    case "open":
      return state.pending ? state : { ...state, open: action.value }
    case "start":
      return { ...state, pending: true, error: null }
    case "submitted":
      return { ...initialState }
    case "failed":
      return { ...state, pending: false, error: action.message }
  }
}

export function LocalMediaImportDialog() {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [state, dispatch] = useReducer(reducer, initialState)
  const { open, file, title, rightsConfirmed, pending, error } = state

  const selectFile = (selected: File | null) => {
    if (!selected) return
    dispatch({ type: "select", file: selected })
  }

  const start = async () => {
    if (!file || !rightsConfirmed || !title.trim()) return
    dispatch({ type: "start" })
    try {
      const created = await api.createLocalMediaImport({
        originalName: file.name,
        title: title.trim(),
        sizeBytes: file.size,
        contentType: file.type || "application/octet-stream",
        rightsConfirmed: true,
      })
      await queryClient.invalidateQueries({ queryKey: ["library"] })
      const selectedFile = file
      dispatch({ type: "submitted" })
      void api
        .uploadLocalMediaImport(created.uploadUrl, selectedFile, (uploadProgress) => {
          queryClient.setQueryData<LibraryResponse>(["library"], (current) => {
            if (!current) return current
            return {
              ...current,
              items: current.items.map((item) =>
                item.kind === "import" && item.id === created.importId
                  ? {
                      ...item,
                      state: "uploading",
                      stage: "uploading",
                      progress: Math.min(70, uploadProgress * 0.7),
                      message: `正在匯入本機影音 ${Math.round(uploadProgress)}%`,
                    }
                  : item,
              ),
            }
          })
        })
        .catch(() => undefined)
        .finally(() => {
          void queryClient.invalidateQueries({ queryKey: ["library"] })
          void queryClient.invalidateQueries({ queryKey: ["jobs"] })
        })
    } catch (caught) {
      dispatch({
        type: "failed",
        message: caught instanceof Error ? caught.message : String(caught),
      })
    }
  }

  return (
    <>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept={ACCEPT}
        aria-label="選擇本機影音"
        onChange={(event) => {
          selectFile(event.target.files?.[0] ?? null)
          event.currentTarget.value = ""
        }}
      />
      <Tooltip>
        <TooltipTrigger
          render={(
            <Button type="button" variant="outline" size="icon" aria-label="匯入本機影音" onClick={() => input.current?.click()} />
          )}
        >
          <UploadIcon />
        </TooltipTrigger>
        <TooltipContent>匯入</TooltipContent>
      </Tooltip>
      <Dialog open={open} onOpenChange={(value) => dispatch({ type: "open", value })}>
        <DialogContent overlayEmphasis="strong">
          <DialogHeader>
            <DialogTitle>匯入本機影音</DialogTitle>
            <DialogDescription>
              檔案會複製到目前 workspace，必要時轉成瀏覽器可播放的 MP4。
            </DialogDescription>
          </DialogHeader>
          {file ? (
            <div className="local-import-fields">
              <Field>
                <FieldLabel htmlFor="local-import-title">影音標題</FieldLabel>
                <Input id="local-import-title" value={title} maxLength={200} onChange={(event) => dispatch({ type: "title", value: event.target.value })} />
                <FieldDescription>{file.name} · {formatBytes(file.size)}</FieldDescription>
              </Field>
              <Field orientation="horizontal">
                <Checkbox id="local-import-rights" checked={rightsConfirmed} onCheckedChange={(checked) => dispatch({ type: "rights", value: checked === true })} />
                <FieldLabel htmlFor="local-import-rights">我有權匯入、轉錄與觀看這個影音</FieldLabel>
              </Field>
            </div>
          ) : null}
          {error ? <small role="alert">{error}</small> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => dispatch({ type: "open", value: false })} disabled={pending}>取消</Button>
            <Button type="button" onClick={() => void start()} disabled={pending || !file || !rightsConfirmed || !title.trim()}>
              {pending ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
              開始匯入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
