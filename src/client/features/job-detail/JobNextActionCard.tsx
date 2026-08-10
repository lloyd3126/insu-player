import { PromptActionCard } from "@/components/shared/prompt-cards/PromptActionCard"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { jobPromptContext } from "@/features/job-detail/job-prompt-context"
import type { JobSummary } from "@shared/contracts/job"
import { nextActionForJob } from "@shared/domain/job-next-action"
import {
  buildRecoveryPrompt,
  buildSubtitleManagementPrompt,
} from "@shared/prompts/insu-prompts"

export function JobNextActionCard({ job }: { job: JobSummary }) {
  const action = nextActionForJob(job)

  if (!action.prompt) {
    return (
      <Alert className="job-next-action" aria-live="polite">
        <AlertTitle>{action.title}</AlertTitle>
        <AlertDescription>{action.description}</AlertDescription>
      </Alert>
    )
  }

  const context = jobPromptContext(job)
  const prompt =
    action.prompt === "recovery"
      ? buildRecoveryPrompt(context)
      : buildSubtitleManagementPrompt(context)

  return (
    <PromptActionCard
      kicker={action.kicker}
      title={action.title}
      description={action.description}
      prompt={prompt}
    />
  )
}
