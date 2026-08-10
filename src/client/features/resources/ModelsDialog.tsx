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
import { MODEL_PROMPTS } from "@shared/prompts/insu-prompts"

type ModelScope = "local" | "cloud"

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
