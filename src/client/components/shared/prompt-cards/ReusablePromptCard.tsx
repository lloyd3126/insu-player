import { CopyButton } from "@/components/shared/CopyButton"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function ReusablePromptCard({
  index,
  title,
  description,
  prompt,
}: {
  index: string
  title: string
  description: string
  prompt: string
}) {
  return (
    <Card className="reusable-prompt-card">
      <CardHeader>
        <span className="section-index">{index}</span>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <CopyButton value={prompt} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <pre className="prompt-code">{prompt}</pre>
      </CardContent>
    </Card>
  )
}
