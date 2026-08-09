import { useQuery } from "@tanstack/react-query"

import { api } from "@/api/client"
import { ApiKeySelect } from "@/components/shared/ApiKeySelect"
import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { PromptActionCard } from "@/components/shared/prompt-cards/PromptActionCard"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatBytes } from "@shared/domain/format"

type ModelScope = "local" | "cloud"

const MODEL_PROMPTS: Record<
  ModelScope,
  { kicker: string; title: string; description: string; prompt: string }
> = {
  local: {
    kicker: "SETUP / LOCAL MODEL",
    title: "請 Agent 準備本機模型",
    description:
      "複製提示，請 Agent 檢查目前 workspace 並準備合適的本機模型。",
    prompt:
      "請檢查目前 INSU Player workspace 的本機模型與 runtime，依我的需求建議合適的本機模型。若缺少必要套件或模型，只能安裝在目前 workspace，不要使用 sudo、Homebrew、apt、全域 pip 或全域 npm。請保留既有影音、字幕與任務資料，完成後回報實際模型名稱、下載大小與可用狀態。",
  },
  cloud: {
    kicker: "SETUP / CLOUD MODEL",
    title: "請 Agent 檢查雲端模型",
    description:
      "複製提示，請 Agent 檢查 SDK 與 API Key 狀態並說明還缺哪些設定。",
    prompt:
      "請檢查目前 INSU Player workspace 的雲端模型、SDK 與 API Key 設定狀態，告訴我還缺哪些步驟。不要要求我把 API Key 貼到對話，需要時請引導我在 INSU Player「功能設定」的「環境變數」中設定。任何音訊 API 上傳前，都要先取得我本次明確同意並使用 --allow-api-upload。請勿把 API Key 寫入檔案、log、metadata 或回覆。",
  },
}

function ModelsContent({
  scope,
  onManageApiKey,
}: {
  scope: ModelScope
  onManageApiKey?: () => void
}) {
  const query = useQuery({
    queryKey: ["models"],
    queryFn: api.models,
  })
  const prompt = MODEL_PROMPTS[scope]
  return (
    <div className="guide-tab-content settings-table-content model-settings-content">
      <PromptActionCard {...prompt} />
      {query.isPending ? <LoadingState label="正在讀取 workspace" /> : null}
      {query.isError ? <ErrorState message={query.error.message} /> : null}
      {query.data && scope === "local" ? (
        <section className="settings-table-section model-inventory-section" aria-label="本機模型列表">
          <div className="settings-table-scroll-region model-table-scroll-region">
            <Table className="settings-table model-table">
              <TableHeader>
                <TableRow>
                  <TableHead>模型</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead>實際下載大小</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.local.models.length > 0 ? (
                  query.data.local.models.map((model) => (
                    <TableRow key={model.name}>
                      <TableCell>
                        {model.displayName ?? `OpenAI Whisper ${model.name}`}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {model.ready ? "已安裝" : "模型檔存在"}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatBytes(model.sizeBytes)}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3}>尚未下載任何本機模型</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
      {query.data && scope === "cloud" ? (
        <section className="settings-table-section model-inventory-section" aria-label="雲端模型列表">
          <div className="settings-table-scroll-region model-table-scroll-region">
            <Table className="settings-table model-table">
              <TableHeader>
                <TableRow>
                  <TableHead>模型</TableHead>
                  <TableHead>SDK</TableHead>
                  <TableHead>API Key</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.api.models.map((model) => {
                  const displayName = model.displayName ?? `OpenAI ${model.name}`
                  return (
                    <TableRow key={model.name}>
                      <TableCell>{displayName}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {model.installed ? "SDK 已安裝" : "尚未安裝"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ApiKeySelect
                          apiKeyName={model.apiKeyName}
                          configured={model.apiKeyConfigured}
                          modelName={displayName}
                          onManage={onManageApiKey ?? (() => undefined)}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  )
}

export function LocalModelsContent() {
  return <ModelsContent scope="local" />
}

export function CloudModelsContent({
  onManageApiKey,
}: {
  onManageApiKey: () => void
}) {
  return <ModelsContent scope="cloud" onManageApiKey={onManageApiKey} />
}
