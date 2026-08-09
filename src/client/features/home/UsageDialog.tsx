import { PromptActionCard } from "@/components/shared/prompt-cards/PromptActionCard"
import {
  TutorialCard,
  TutorialExample,
  TutorialStep,
  TutorialStepList,
} from "@/components/shared/prompt-cards/TutorialCard"

const YOUTUBE_PROMPT =
  "請把這支 YouTube 影音加入 INSU Player：\nhttps://www.youtube.com/watch?v=VIDEO_ID"

export function UsageContent() {
  return (
    <div className="guide-tab-content usage-layout">
      <PromptActionCard
        kicker="YOUTUBE / EXAMPLE"
        title="把網址貼到對話"
        description="複製並把 YouTube 網址貼回提示並告訴 Agent，Agent 準備完成後，影音就會出現在 INSU Player。"
        prompt={YOUTUBE_PROMPT}
      />
      <TutorialCard kicker="01 / SUPPORTED" title="PASTE INTO AGENT">
        <TutorialStepList>
          <TutorialStep
            number="01"
            title="複製影音網址"
            description="從 YouTube 選擇一支影音作為開始"
          />
          <TutorialStep
            number="02"
            title="回到 Agent 對話"
            description="貼上網址並用自然語言告訴 Agent"
          />
        </TutorialStepList>
        <TutorialExample>{YOUTUBE_PROMPT}</TutorialExample>
      </TutorialCard>
    </div>
  )
}
