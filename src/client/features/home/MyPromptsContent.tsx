import { useQuery } from "@tanstack/react-query"

import { api } from "@/api/client"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/AsyncState"
import {
  CompactPromptActionCard,
  PromptActionCard,
} from "@/components/shared/prompt-cards/PromptActionCard"
import { ReusablePromptCard } from "@/components/shared/prompt-cards/ReusablePromptCard"

const CREATE_PROMPT_WITH_AGENT =
  "請和我一起建立一則可重用的 INSU Player 提示。先詢問我的使用情境與想達成的結果，再和我一起整理名稱、適用情境與可直接複製的提示內容，確認後請把它加入「我的提示」。"

const BUILT_IN_PROMPTS = [
  {
    id: "01 / WATCH",
    title: "準備影音與翻譯字幕",
    description: "先確認是否需要翻譯與目標語言，再依選擇使用來源字幕或模型轉錄。",
    prompt:
      "請把這支影音加入 INSU Player。取得字幕前先問我是否需要翻譯及目標語言。若需要，再問我要使用本機或 OpenAI 模型，且不要取得平台字幕：\nVIDEO_URL",
  },
  {
    id: "02 / LEARN",
    title: "保留雙語字幕",
    description: "用影音學習語言，希望播放器中可以切換原文與指定目標語言。",
    prompt:
      "請把這支影音加入 INSU Player。先問我是否需要翻譯及目標語言。若需要，再問我要使用本機或 OpenAI 模型，從音訊建立可切換的原文與目標語字幕：\nVIDEO_URL",
  },
  {
    id: "03 / QUEUE",
    title: "整理多支單一影音",
    description: "一次交付多個單支影音網址，各自保留狀態，不展開播放清單。",
    prompt:
      "請把以下每一支影音分別加入 INSU Player，不要展開播放清單。取得字幕前先確認這批影音是否需要翻譯及目標語言。若需要，再問我要使用本機或 OpenAI 模型：\nVIDEO_URL_1\nVIDEO_URL_2",
  },
  {
    id: "04 / RECOVER",
    title: "接續中斷的工作",
    description: "下載、轉錄或翻譯停住時，保留成果並從正確階段繼續。",
    prompt:
      "請檢查 INSU Player 中這支影音的狀態與最近紀錄，保留已完成的影音與字幕，並從中斷的階段繼續：\nVIDEO_TITLE_OR_ID",
  },
]

export function MyPromptsContent() {
  const prompts = useQuery({
    queryKey: ["prompts"],
    queryFn: api.prompts,
  })

  return (
    <section className="guide-tab-content advanced-section my-prompts-content">
      <PromptActionCard
        kicker="YOUR PLAYBOOK"
        title="我的提示"
        description="和 Agent 一起建立可重用的提示，完成後會出現在下方清單。"
        prompt={CREATE_PROMPT_WITH_AGENT}
      />
      <div className="my-prompts-scroll-region">
        <div className="prompt-action-card-list">
          {BUILT_IN_PROMPTS.map((prompt) => (
            <CompactPromptActionCard
              key={prompt.id}
              kicker={prompt.id}
              title={prompt.title}
              description={prompt.description}
              prompt={prompt.prompt}
            />
          ))}
        </div>
        {prompts.isPending ? <LoadingState label="正在讀取我的提示" /> : null}
        {prompts.isError ? <ErrorState message={prompts.error.message} /> : null}
        {prompts.data?.available && prompts.data.prompts.length === 0 ? (
          <EmptyState
            title="還沒有自訂提示"
            description="和 Agent 一起建立第一則可重用提示。"
          />
        ) : null}
        {prompts.data?.available ? (
          <div className="reusable-prompt-card-list">
            {prompts.data.prompts.map((prompt, index) => (
              <ReusablePromptCard
                key={prompt.id}
                index={`${String(index + 1).padStart(2, "0")} / ${prompt.id}`}
                title={prompt.title}
                description={prompt.scenario}
                prompt={prompt.prompt}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
