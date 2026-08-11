import { useQuery } from "@tanstack/react-query"
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  LoaderCircleIcon,
} from "lucide-react"
import { useId, useMemo, useState } from "react"

import { api } from "@/api/client"
import { PromptActionCard } from "@/components/shared/prompt-cards/PromptActionCard"
import {
  TutorialCard,
  TutorialStep,
  TutorialStepList,
} from "@/components/shared/prompt-cards/TutorialCard"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  INITIALIZE_PLAYER_PROMPT,
  buildAddVideoPrompt,
} from "@shared/prompts/insu-prompts"

function promptForUrl(value: string) {
  if (!value.trim()) return { prompt: "", error: "" }
  try {
    return { prompt: buildAddVideoPrompt(value), error: "" }
  } catch (error) {
    return {
      prompt: "",
      error: error instanceof Error ? error.message : "請貼上有效的影音網址",
    }
  }
}

export function InitializationContent({
  onContinue,
}: {
  onContinue: () => void
}) {
  const runtime = useQuery({
    queryKey: ["runtime"],
    queryFn: api.runtime,
    refetchInterval: (query) =>
      query.state.data?.initialized ? false : 5_000,
  })
  const checks = runtime.data?.capabilities ?? []
  const allReady = runtime.data?.initialized ?? false
  const checklist = (
    <div className="initialization-checklist" aria-label="目前準備狀態">
      {checks.map((check) => (
        <div className="initialization-check" key={check.label}>
          {runtime.isPending || check.state === "checking" ? (
            <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
          ) : check.state === "ready" ? (
            <CheckCircle2Icon aria-hidden="true" />
          ) : (
            <CircleAlertIcon aria-hidden="true" />
          )}
          <span>
            <strong>{check.label}</strong>
            <small>{check.detail}</small>
          </span>
          <Badge variant={check.state === "ready" ? "secondary" : "outline"}>
            {runtime.isPending || check.state === "checking"
              ? "檢查中"
              : check.state === "ready"
                ? "已準備"
                : "需要準備"}
          </Badge>
        </div>
      ))}
      {runtime.data?.activeSetup ? (
        <div className="initialization-check initialization-check--active">
          <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
          <span>
            <strong>正在準備</strong>
            <small>{runtime.data.activeSetup.message}</small>
          </span>
          <Badge variant="outline">
            {Math.round(runtime.data.activeSetup.progress)}%
          </Badge>
        </div>
      ) : null}
    </div>
  )

  if (allReady) {
    return (
      <div className="guide-tab-content usage-layout">
        <TutorialCard
          kicker="01 / READY"
          title="INSU Player 已準備完成"
          description="INSU Player 已具備加入影音需要的工具，不需要再次執行初始化。"
          footer={(
            <Button onClick={onContinue}>
              前往加入影音
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          )}
        >
          {checklist}
        </TutorialCard>
      </div>
    )
  }

  return (
    <div className="guide-tab-content usage-layout">
      <PromptActionCard
        kicker="01 / SETUP"
        title="準備 INSU Player"
        description="複製提示並貼給 Agent。準備完成後，這裡會顯示前往加入影音的按鈕。"
        prompt={INITIALIZE_PLAYER_PROMPT}
        copyLabel="複製初始化提示"
      >
        {checklist}
      </PromptActionCard>
    </div>
  )
}

export function AddSingleMediaContent({
  onContinue,
}: {
  onContinue: () => void
}) {
  const inputId = useId()
  const [videoUrl, setVideoUrl] = useState("")
  const [promptCopied, setPromptCopied] = useState(false)
  const result = useMemo(() => promptForUrl(videoUrl), [videoUrl])

  return (
    <div className="guide-tab-content usage-layout">
      <PromptActionCard
        kicker="02 / ADD"
        title="加入一支影音"
        description="貼上影音網址並複製提示，接下來只需要用一般語言回答想要哪種字幕。"
        prompt={result.prompt}
        copyLabel="複製加入提示"
        copyDisabled={!result.prompt}
        onCopied={() => setPromptCopied(true)}
        footer={promptCopied ? (
          <Button onClick={onContinue}>
            前往交給 Agent
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        ) : undefined}
      >
        <FieldGroup>
          <Field data-invalid={Boolean(result.error)}>
            <FieldLabel htmlFor={inputId}>影音網址</FieldLabel>
            <Input
              id={inputId}
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={videoUrl}
              aria-invalid={Boolean(result.error)}
              onChange={(event) => {
                setVideoUrl(event.target.value)
                setPromptCopied(false)
              }}
            />
            <FieldDescription>
              只會把這一個網址寫入提示，不會在網頁中直接開始下載。
            </FieldDescription>
            <FieldError>{result.error}</FieldError>
          </Field>
        </FieldGroup>
      </PromptActionCard>
    </div>
  )
}

export function AgentHandoffContent() {
  return (
    <div className="guide-tab-content usage-layout">
      <TutorialCard
        kicker="03 / AGENT"
        title="把提示交給 Agent"
        description="網址已經包含在完整提示中。接下來只要回到目前的 Agent 對話並貼上。"
      >
        <TutorialStepList>
          <TutorialStep
            number="01"
            title="回到目前的 Agent 對話"
            description="不需要另外開啟新的對話"
          />
          <TutorialStep
            number="02"
            title="貼上剛才複製的完整提示"
            description="網址與處理規則已經包含在提示中，不必另外重述"
          />
          <TutorialStep
            number="03"
            title="用一般語言回答字幕需求"
            description="只要說整理原本語言，或想翻譯成哪種語言"
          />
          <TutorialStep
            number="04"
            title="到影片中心查看進度"
            description="Agent 完成後，影音與字幕會出現在影片中心"
          />
        </TutorialStepList>
      </TutorialCard>
    </div>
  )
}
