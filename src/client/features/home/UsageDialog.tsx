import { useId, useMemo, useState } from "react"

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
import { buildAddVideoPrompt } from "@shared/prompts/insu-prompts"

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

export function UsageContent() {
  const inputId = useId()
  const [videoUrl, setVideoUrl] = useState("")
  const result = useMemo(() => promptForUrl(videoUrl), [videoUrl])

  return (
    <div className="guide-tab-content usage-layout">
      <PromptActionCard
        kicker="ADD / MEDIA"
        title="加入一支影音"
        description="貼上影音網址並複製提示，接下來只需要用一般語言回答想要哪種字幕。"
        prompt={result.prompt}
        copyLabel="複製加入提示"
        copyDisabled={!result.prompt}
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
              onChange={(event) => setVideoUrl(event.target.value)}
            />
            <FieldDescription>
              只會把這一個網址寫入提示，不會在網頁中直接開始下載。
            </FieldDescription>
            <FieldError>{result.error}</FieldError>
          </Field>
        </FieldGroup>
      </PromptActionCard>
      <TutorialCard kicker="01 / START" title="貼回目前的 Agent 對話">
        <TutorialStepList>
          <TutorialStep
            number="01"
            title="貼上影音網址"
            description="使用你有權下載、轉錄與觀看的單支影音"
          />
          <TutorialStep
            number="02"
            title="複製加入提示"
            description="頁面會把網址安全地放入完整提示"
          />
          <TutorialStep
            number="03"
            title="回到 Agent 對話"
            description="貼上剛才複製的完整提示"
          />
          <TutorialStep
            number="04"
            title="回答想要的字幕"
            description="只要說保留原語，或想翻譯成哪種語言"
          />
        </TutorialStepList>
      </TutorialCard>
    </div>
  )
}
