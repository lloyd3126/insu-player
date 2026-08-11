import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleDotIcon, CircleIcon, Settings2Icon } from "lucide-react"
import { useState } from "react"

import { api } from "@/api/client"
import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { modelStatusLabel } from "@/features/resources/ModelDetailsDialog"
import type { TranscriptionModel } from "@shared/contracts/resources"

function ModelSelectionButton({ model }: { model: TranscriptionModel }) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const select = useMutation({
    mutationFn: () => api.selectTranscriptionModel(model.id),
    onSuccess: (data) => {
      queryClient.setQueryData(["models"], data)
      void queryClient.invalidateQueries({ queryKey: ["model", model.id] })
      setOpen(false)
    },
  })
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !select.isPending && setOpen(next)}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <AlertDialogTrigger
              render={
                <Button
                  aria-label={model.selected ? "目前選用" : `選用 ${model.displayName}`}
                  variant="ghost"
                  size="icon-sm"
                  disabled={model.selected || !model.ready}
                />
              }
            />
          }
        >
          {model.selected ? <CircleDotIcon /> : <CircleIcon />}
        </TooltipTrigger>
        <TooltipContent>
          {model.selected
            ? "目前選用"
            : model.ready
              ? "使用這個模型"
              : "請先完成模型設定"}
        </TooltipContent>
      </Tooltip>
      <AlertDialogContent overlayEmphasis="strong">
        <AlertDialogHeader>
          <AlertDialogTitle>使用 {model.displayName}</AlertDialogTitle>
          <AlertDialogDescription>
            只會影響之後開始的語音辨識工作。正在執行或已完成的工作不會改用這個模型。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {select.isError ? (
          <Alert variant="destructive">
            <AlertTitle>無法切換模型</AlertTitle>
            <AlertDescription>{select.error.message}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={select.isPending}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={select.isPending}
            onClick={() => select.mutate()}
          >
            {select.isPending ? <Spinner data-icon="inline-start" /> : null}
            確認使用
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
function ModelDetailsButton({
  model,
  onOpenDetails,
}: {
  model: TranscriptionModel
  onOpenDetails: (modelId: string) => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            aria-label={`查看 ${model.displayName} 詳情`}
            variant="outline"
            size="icon-sm"
            onClick={() => onOpenDetails(model.id)}
          />
        }
      >
        <Settings2Icon />
      </TooltipTrigger>
      <TooltipContent>詳情</TooltipContent>
    </Tooltip>
  )
}

export function ModelsContent({
  onOpenDetails,
}: {
  onOpenDetails: (modelId: string) => void
}) {
  const query = useQuery({
    queryKey: ["models"],
    queryFn: api.models,
    refetchInterval: (state) =>
      state.state.data?.models.some(
        (model) => model.status === "downloading" || model.status === "validating",
      )
        ? 750
        : false,
  })
  return (
    <div className="settings-table-content model-settings-content">
      {query.isPending ? <LoadingState label="正在讀取模型設定" /> : null}
      {query.isError ? <ErrorState message={query.error.message} /> : null}
      {query.data ? (
        <section className="settings-table-section" aria-label="語音辨識模型列表">
          <div className="settings-table-scroll-region model-table-scroll-region">
            <Table className="settings-table unified-model-table">
              <TableHeader>
                <TableRow>
                  <TableHead>選用</TableHead>
                  <TableHead>類型</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.models.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell><ModelSelectionButton model={model} /></TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {model.type === "local" ? "本機" : "雲端"}
                      </Badge>
                    </TableCell>
                    <TableCell className="unified-model-table__name">
                      {model.displayName}
                    </TableCell>
                    <TableCell>
                      <Badge variant={model.ready ? "secondary" : "outline"}>
                        {modelStatusLabel(model)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ModelDetailsButton
                        model={model}
                        onOpenDetails={onOpenDetails}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
