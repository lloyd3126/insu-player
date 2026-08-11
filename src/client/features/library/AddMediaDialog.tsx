import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  DownloadIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useMemo, useState } from "react"

import { api } from "@/api/client"
import { useOverlay } from "@/app/overlay-context"
import { AppDialog } from "@/components/shared/AppDialog"
import { TutorialCard } from "@/components/shared/prompt-cards/TutorialCard"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"

function parseUrls(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function AddMediaDialog() {
  const overlay = useOverlay()
  const active = overlay.state?.type === "add-media" ? overlay.state : null
  const queryClient = useQueryClient()
  const [input, setInput] = useState("")
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const urls = useMemo(() => parseUrls(input), [input])
  const createItems = useMutation({
    mutationFn: () =>
      api.createLibraryItems(
        urls.map((pageUrl) => ({ kind: "page" as const, pageUrl })),
        true,
      ),
    onSuccess: () => {
      setInput("")
      setRightsConfirmed(false)
      void queryClient.invalidateQueries({ queryKey: ["library"] })
      void queryClient.invalidateQueries({ queryKey: ["jobs"] })
      overlay.actions.open(
        { type: "library", view: "grid" },
        { replace: true, returnTo: active?.returnTo ?? "/" },
      )
    },
  })

  return (
    <AppDialog
      open={Boolean(active)}
      onOpenChange={(open) => (open ? undefined : overlay.actions.close("add-media"))}
      kicker="ADD MEDIA"
      title="加入影音"
      description="一次加入多個單支影音網址，下載狀態會直接出現在影片中心"
      size="screen"
      height="screen"
    >
      <div className="guide-tab-content add-media-content">
        <TutorialCard
          kicker="ADD / MEDIA"
          title="加入要下載的影音"
          description="每行貼上一個單支影音網址，確認你有權處理後直接加入影片中心。"
          footer={(
            <Button
              type="submit"
              form="add-media-source-form"
              disabled={
                createItems.isPending ||
                !rightsConfirmed ||
                urls.length === 0 ||
                urls.length > 50
              }
            >
              {createItems.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <DownloadIcon data-icon="inline-start" />
              )}
              {createItems.isPending
                ? "正在加入影片中心"
                : urls.length
                  ? `加入 ${urls.length} 個影音`
                  : "加入影音"}
              {!createItems.isPending ? (
                <ArrowRightIcon data-icon="inline-end" />
              ) : null}
            </Button>
          )}
        >
          <form
            id="add-media-source-form"
            className="add-media-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (urls.length && rightsConfirmed) createItems.mutate()
            }}
          >
            <FieldGroup>
              <Field data-invalid={urls.length > 50 || undefined}>
                <FieldLabel htmlFor="media-urls">單支影音網址</FieldLabel>
                <FieldDescription>
                  每行貼上一個網址，最多 50 個。播放清單不會被展開。
                </FieldDescription>
                <Textarea
                  id="media-urls"
                  value={input}
                  rows={8}
                  placeholder="https://www.youtube.com/watch?v=..."
                  aria-invalid={urls.length > 50 || undefined}
                  onChange={(event) => setInput(event.target.value)}
                />
                {urls.length > 50 ? (
                  <FieldError>一次最多加入 50 個網址</FieldError>
                ) : null}
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="media-rights"
                  checked={rightsConfirmed}
                  onCheckedChange={(checked) =>
                    setRightsConfirmed(checked === true)
                  }
                />
                <FieldContent>
                  <FieldLabel htmlFor="media-rights">
                    我確認這些是我自己的內容，或我已取得下載、轉錄與觀看的權利
                  </FieldLabel>
                  <FieldDescription>
                    系統不會繞過 DRM、付費牆、會員或私人存取限制。
                  </FieldDescription>
                </FieldContent>
              </Field>
            </FieldGroup>
            {createItems.isError ? (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>無法加入影音</AlertTitle>
                <AlertDescription>{createItems.error.message}</AlertDescription>
              </Alert>
            ) : null}
          </form>
        </TutorialCard>
      </div>
    </AppDialog>
  )
}
