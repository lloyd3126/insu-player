import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BanIcon,
  CloudUploadIcon,
  DownloadIcon,
  HardDriveIcon,
  KeyRoundIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { createContext, use, useMemo, useState } from "react"

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
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { formatBytes } from "@shared/domain/format"
import type {
  CloudTranscriptionModel,
  LocalTranscriptionModel,
  TranscriptionModel,
  TranscriptionModelDetailResponse,
  TranscriptionProviderStatus,
} from "@shared/contracts/resources"
import { modelStatusLabel } from "@/features/resources/model-status"

interface DetailsState {
  model: TranscriptionModel
  provider: TranscriptionProviderStatus | null
  credentialValue: string
  actionError: Error | null
}

interface DetailsActions {
  setCredentialValue: (value: string) => void
  select: () => void
  download: () => void
  cancelDownload: () => void
  remove: () => void
  saveCredential: () => void
  clearCredential: () => void
}

interface DetailsMeta {
  selecting: boolean
  downloading: boolean
  cancelling: boolean
  removing: boolean
  savingCredential: boolean
  clearingCredential: boolean
}

interface DetailsContextValue {
  state: DetailsState
  actions: DetailsActions
  meta: DetailsMeta
}

const DetailsContext = createContext<DetailsContextValue | null>(null)

function useDetails() {
  const value = use(DetailsContext)
  if (!value) throw new Error("ModelDetailsDialog components require Provider")
  return value
}

function Provider({
  detail,
  children,
}: {
  detail: TranscriptionModelDetailResponse
  children: React.ReactNode
}) {
  const queryClient = useQueryClient()
  const [credentialValue, setCredentialValue] = useState("")
  const refresh = (data?: unknown) => {
    if (data) queryClient.setQueryData(["models"], data)
    void queryClient.invalidateQueries({ queryKey: ["models"] })
    void queryClient.invalidateQueries({
      queryKey: ["model", detail.model.id],
    })
  }
  const select = useMutation({
    mutationFn: () => api.selectTranscriptionModel(detail.model.id),
    onSuccess: refresh,
  })
  const download = useMutation({
    mutationFn: () => api.downloadModel(detail.model.id),
    onSuccess: () => refresh(),
  })
  const cancel = useMutation({
    mutationFn: () => api.cancelModelDownload(detail.model.id),
    onSuccess: () => refresh(),
  })
  const remove = useMutation({
    mutationFn: () => api.removeModel(detail.model.id),
    onSuccess: () => refresh(),
  })
  const saveCredential = useMutation({
    mutationFn: () => {
      if (detail.model.type !== "cloud") throw new Error("本機模型沒有 API Key")
      return api.setProviderCredential(
        detail.model.provider,
        credentialValue.trim(),
      )
    },
    onSuccess: (data) => {
      setCredentialValue("")
      refresh(data)
    },
  })
  const clearCredential = useMutation({
    mutationFn: () => {
      if (detail.model.type !== "cloud") throw new Error("本機模型沒有 API Key")
      return api.clearProviderCredential(detail.model.provider)
    },
    onSuccess: refresh,
  })
  const actionError =
    select.error ??
    download.error ??
    cancel.error ??
    remove.error ??
    saveCredential.error ??
    clearCredential.error ??
    null
  const value = useMemo<DetailsContextValue>(
    () => ({
      state: {
        model: detail.model,
        provider: detail.provider,
        credentialValue,
        actionError,
      },
      actions: {
        setCredentialValue,
        select: () => select.mutate(),
        download: () => download.mutate(),
        cancelDownload: () => cancel.mutate(),
        remove: () => remove.mutate(),
        saveCredential: () => saveCredential.mutate(),
        clearCredential: () => clearCredential.mutate(),
      },
      meta: {
        selecting: select.isPending,
        downloading: download.isPending,
        cancelling: cancel.isPending,
        removing: remove.isPending,
        savingCredential: saveCredential.isPending,
        clearingCredential: clearCredential.isPending,
      },
    }),
    [
      actionError,
      cancel,
      clearCredential,
      credentialValue,
      detail.model,
      detail.provider,
      download,
      remove,
      saveCredential,
      select,
    ],
  )
  return <DetailsContext value={value}>{children}</DetailsContext>
}

function Frame({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="model-details-dialog"
        overlayEmphasis="strong"
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}

function Header() {
  const { state } = useDetails()
  return (
    <DialogHeader>
      <div className="model-details-heading">
        {state.model.type === "local" ? <HardDriveIcon /> : <CloudUploadIcon />}
        <div>
          <DialogTitle>{state.model.displayName}</DialogTitle>
          <DialogDescription>
            {state.model.type === "local"
              ? "在這台電腦上執行語音辨識"
              : `${state.model.providerName} 雲端語音辨識`}
          </DialogDescription>
        </div>
      </div>
    </DialogHeader>
  )
}

function CommonFacts() {
  const { state } = useDetails()
  return (
    <dl className="model-detail-facts">
      <div>
        <dt>類型</dt>
        <dd>{state.model.type === "local" ? "本機" : "雲端"}</dd>
      </div>
      <div>
        <dt>服務</dt>
        <dd>{state.model.providerName}</dd>
      </div>
      <div>
        <dt>時間精度</dt>
        <dd>逐字時間</dd>
      </div>
      <div>
        <dt>目前狀態</dt>
        <dd>
          <Badge variant="outline">{modelStatusLabel(state.model)}</Badge>
        </dd>
      </div>
    </dl>
  )
}

function ActionError() {
  const { state } = useDetails()
  if (!state.actionError) return null
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>操作未完成</AlertTitle>
      <AlertDescription>{state.actionError.message}</AlertDescription>
    </Alert>
  )
}

function LocalModelDetails() {
  const { state, actions, meta } = useDetails()
  const model = state.model as LocalTranscriptionModel
  const busy =
    model.local.download.state === "downloading" ||
    model.local.download.state === "validating"
  return (
    <section className="model-detail-section" aria-labelledby="local-model-files">
      <div>
        <h3 id="local-model-files">本機檔案</h3>
        <p>
          {model.local.languageSupport === "multilingual" ? "支援多種語言" : "只支援英文"}
          {` · ${model.local.memoryLabel} 記憶體建議`}
        </p>
      </div>
      <dl className="model-detail-facts model-detail-facts--compact">
        <div>
          <dt>預估下載</dt>
          <dd>{formatBytes(model.local.approximateBytes)}</dd>
        </div>
        <div>
          <dt>實際大小</dt>
          <dd>{model.local.sizeBytes ? formatBytes(model.local.sizeBytes) : "尚未下載"}</dd>
        </div>
      </dl>
      {busy ? (
        <div className="model-detail-progress">
          <Progress value={model.local.download.progress} />
          <span>{model.local.download.message} {Math.round(model.local.download.progress)}%</span>
        </div>
      ) : null}
      <div className="model-detail-actions">
        {busy ? (
          <Button
            type="button"
            variant="outline"
            disabled={meta.cancelling}
            onClick={actions.cancelDownload}
          >
            {meta.cancelling ? <Spinner data-icon="inline-start" /> : <BanIcon data-icon="inline-start" />}
            取消下載
          </Button>
        ) : !model.local.installed || !model.local.valid ? (
          <Button
            type="button"
            variant="outline"
            disabled={meta.downloading}
            onClick={actions.download}
          >
            {meta.downloading ? <Spinner data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
            {model.local.installed ? "重新下載並驗證" : "下載模型"}
          </Button>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  type="button"
                  variant="destructive"
                  disabled={model.selected}
                />
              }
            >
              <Trash2Icon data-icon="inline-start" />
              移除模型
            </AlertDialogTrigger>
            <AlertDialogContent overlayEmphasis="strong">
              <AlertDialogHeader>
                <AlertDialogMedia><Trash2Icon /></AlertDialogMedia>
                <AlertDialogTitle>移除 {model.displayName}</AlertDialogTitle>
                <AlertDialogDescription>
                  只會移除可重新下載的模型檔案，不會刪除影音或字幕。請先改用另一個模型，才能移除目前選用的模型。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={meta.removing}>取消</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={meta.removing}
                  onClick={actions.remove}
                >
                  {meta.removing ? <Spinner data-icon="inline-start" /> : null}
                  確認移除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </section>
  )
}

function CloudModelDetails() {
  const { state, actions, meta } = useDetails()
  const model = state.model as CloudTranscriptionModel
  const provider = state.provider
  const inputId = `credential-${model.provider}`
  return (
    <section className="model-detail-section" aria-labelledby="cloud-model-access">
      <div>
        <h3 id="cloud-model-access">服務存取</h3>
        <p>{model.cloud.uploadDescription}。每次真正上傳前仍會另外詢問你的同意。</p>
      </div>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={inputId}>{model.cloud.credentialName}</FieldLabel>
          <Input
            id={inputId}
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={state.credentialValue}
            placeholder={provider?.configured ? "貼上新值以更新" : "貼上 API Key"}
            onChange={(event) => actions.setCredentialValue(event.target.value)}
          />
          <FieldDescription>
            只保留在目前本機服務的記憶體中。停止服務後會清除，也不會顯示原值。
          </FieldDescription>
        </Field>
      </FieldGroup>
      <div className="model-detail-actions">
        <Button
          type="button"
          disabled={meta.savingCredential || !state.credentialValue.trim()}
          onClick={actions.saveCredential}
        >
          {meta.savingCredential ? <Spinner data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
          {provider?.configured ? "更新 API Key" : "設定 API Key"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="outline"
                disabled={!provider?.configured}
              />
            }
          >
            清除 API Key
          </AlertDialogTrigger>
          <AlertDialogContent overlayEmphasis="strong">
            <AlertDialogHeader>
              <AlertDialogMedia><KeyRoundIcon /></AlertDialogMedia>
              <AlertDialogTitle>清除 {model.providerName} API Key</AlertDialogTitle>
              <AlertDialogDescription>
                這會讓所有 {model.providerName} 模型同時變成尚未設定，不會影響其他服務。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={meta.clearingCredential}>取消</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={meta.clearingCredential}
                onClick={actions.clearCredential}
              >
                {meta.clearingCredential ? <Spinner data-icon="inline-start" /> : null}
                確認清除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  )
}

function Footer() {
  const { state, actions, meta } = useDetails()
  return (
    <DialogFooter>
      <Button
        type="button"
        disabled={state.model.selected || !state.model.ready || meta.selecting}
        onClick={actions.select}
      >
        {meta.selecting ? <Spinner data-icon="inline-start" /> : null}
        {state.model.selected ? "目前選用" : "使用這個模型"}
      </Button>
    </DialogFooter>
  )
}

export function RoutedModelDetailsDialog({
  modelId,
  onOpenChange,
}: {
  modelId: string | undefined
  onOpenChange: (open: boolean) => void
}) {
  const query = useQuery({
    queryKey: ["model", modelId],
    queryFn: () => api.model(modelId!),
    enabled: Boolean(modelId),
    refetchInterval: (state) => {
      const model = state.state.data?.model
      return model?.status === "downloading" || model?.status === "validating"
        ? 750
        : false
    },
  })
  return (
    <ModelDetailsDialog.Frame open={Boolean(modelId)} onOpenChange={onOpenChange}>
      {query.isPending ? <LoadingState label="正在讀取模型詳情" /> : null}
      {query.isError ? <ErrorState message={query.error.message} /> : null}
      {query.data ? (
        <ModelDetailsDialog.Provider detail={query.data}>
          <ModelDetailsDialog.Header />
          <div className="model-details-dialog__body">
            <ModelDetailsDialog.CommonFacts />
            <ModelDetailsDialog.ActionError />
            {query.data.model.type === "local" ? (
              <ModelDetailsDialog.LocalModelDetails />
            ) : (
              <ModelDetailsDialog.CloudModelDetails />
            )}
          </div>
          <ModelDetailsDialog.Footer />
        </ModelDetailsDialog.Provider>
      ) : null}
    </ModelDetailsDialog.Frame>
  )
}

export const ModelDetailsDialog = {
  Provider,
  Frame,
  Header,
  CommonFacts,
  ActionError,
  LocalModelDetails,
  CloudModelDetails,
  Footer,
}
