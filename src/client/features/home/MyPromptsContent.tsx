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
import {
  BUILT_IN_PROMPTS,
  CREATE_PROMPT_WITH_AGENT,
} from "@shared/prompts/insu-prompts"

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
              kicker={prompt.kicker}
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
