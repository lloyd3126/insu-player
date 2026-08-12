import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Trash2Icon } from "lucide-react"

import { api } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ImportLibraryItem, LibraryResponse } from "@shared/contracts/library"

function progress(item: ImportLibraryItem) {
  return Number.isFinite(item.progress)
    ? Math.min(100, Math.max(0, Math.round(item.progress)))
    : 0
}

export function ImportProgressValue({ item }: { item: ImportLibraryItem }) {
  const value = progress(item)
  return (
    <div className="import-progress-value" aria-label={`匯入進度 ${value}%`}>
      <strong>{value}%</strong>
      <span>{item.message}</span>
      <Progress value={value} aria-label="匯入進度" />
    </div>
  )
}

export function ImportMediaCard({
  item,
  removable = false,
}: {
  item: ImportLibraryItem
  removable?: boolean
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => api.removeLocalMediaImport(item.id),
    onSuccess: (response) => queryClient.setQueryData<LibraryResponse>(["library"], response),
  })
  return (
    <Card className="video-grid-card video-grid-card--download video-grid-card--import" size="sm">
      <div className="video-grid-card__thumbnail video-grid-card__thumbnail--download">
        <ImportProgressValue item={item} />
      </div>
      <CardHeader>
        <CardTitle role="heading" aria-level={3} title={item.title}>{item.title}</CardTitle>
      </CardHeader>
      {removable && ["failed", "cancelled", "awaiting_upload"].includes(item.state) ? (
        <CardFooter>
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`刪除匯入工作 ${item.title}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                />
              )}
            >
              {remove.isPending ? <Spinner /> : <Trash2Icon />}
            </TooltipTrigger>
            <TooltipContent>刪除</TooltipContent>
          </Tooltip>
          {remove.isError ? <small role="alert">{remove.error.message}</small> : null}
        </CardFooter>
      ) : null}
    </Card>
  )
}
