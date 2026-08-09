import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { api } from "@/api/client"
import { ErrorState, LoadingState } from "@/components/shared/AsyncState"
import { PromptActionCard } from "@/components/shared/prompt-cards/PromptActionCard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { EnvironmentVariableStatus } from "@shared/contracts/resources"

const ENVIRONMENT_PROMPT = {
  kicker: "SETUP / ENVIRONMENT",
  title: "請 Agent 檢查環境變數",
  description:
    "複製提示，請 Agent 在不要讀取 Key 原值的前提下，檢查目前缺少的 API Key 並引導你在此處設定。",
  prompt:
    "請檢查目前 INSU Player workspace 所需的環境變數與設定狀態。不要要求我把 API Key 貼到對話，請引導我在 INSU Player「功能設定」的「環境變數」表格中設定。不要讀取或回報 Key 原值，也不要把 Key 寫入檔案、app.db、log、metadata 或回覆。只回報環境變數名稱、用途、設定狀態與建議的下一步。",
}

function environmentStatusLabel(variable: EnvironmentVariableStatus) {
  if (!variable.configured) return "尚未設定"
  return variable.source === "startup" ? "啟動時已設定" : "本次服務已設定"
}

export function EnvironmentContent() {
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Record<string, string>>({})
  const query = useQuery({
    queryKey: ["environment"],
    queryFn: api.environment,
  })
  const save = useMutation({
    mutationFn: ({ name, value }: { name: string; value: string }) =>
      api.setEnvironment(name, value),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(["environment"], data)
      queryClient.invalidateQueries({ queryKey: ["models"] })
      setValues((current) => ({ ...current, [variables.name]: "" }))
    },
  })
  const clear = useMutation({
    mutationFn: (name: string) => api.clearEnvironment(name),
    onSuccess: (data) => {
      queryClient.setQueryData(["environment"], data)
      queryClient.invalidateQueries({ queryKey: ["models"] })
    },
  })

  return (
    <div className="guide-tab-content settings-table-content environment-settings-content">
      <PromptActionCard {...ENVIRONMENT_PROMPT} />
      {query.isPending ? <LoadingState label="正在確認環境狀態" /> : null}
      {query.isError ? <ErrorState message={query.error.message} /> : null}
      {save.isError ? <ErrorState message={save.error.message} /> : null}
      {clear.isError ? <ErrorState message={clear.error.message} /> : null}
      {query.data ? (
        <section className="settings-table-section" aria-label="環境變數列表">
          <div className="settings-table-scroll-region environment-table-scroll-region">
            <Table className="settings-table environment-table">
              <TableHeader>
                <TableRow>
                  <TableHead>環境變數</TableHead>
                  <TableHead>目前狀態</TableHead>
                  <TableHead>新值</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.variables.map((variable) => {
                  const value = values[variable.name] ?? ""
                  const inputId = `environment-${variable.name.toLowerCase().replaceAll("_", "-")}`
                  const saving = save.isPending && save.variables?.name === variable.name
                  const clearing = clear.isPending && clear.variables === variable.name
                  const busy = saving || clearing
                  return (
                    <TableRow key={variable.name}>
                      <TableCell>
                        <code>{variable.name}</code>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {environmentStatusLabel(variable)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Field className="environment-value-field">
                          <FieldLabel className="sr-only" htmlFor={inputId}>
                            {variable.name} 新值
                          </FieldLabel>
                          <Input
                            id={inputId}
                            type="password"
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            value={value}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [variable.name]: event.target.value,
                              }))
                            }
                            placeholder="貼上新的值"
                          />
                        </Field>
                      </TableCell>
                      <TableCell>
                        <div className="environment-table-actions">
                          <Button
                            type="button"
                            size="sm"
                            disabled={busy || !value.trim()}
                            onClick={() =>
                              save.mutate({
                                name: variable.name,
                                value: value.trim(),
                              })
                            }
                          >
                            套用
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy || !variable.configured}
                            onClick={() => clear.mutate(variable.name)}
                          >
                            清除
                          </Button>
                        </div>
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
