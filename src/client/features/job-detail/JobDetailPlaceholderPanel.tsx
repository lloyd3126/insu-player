import { EmptyState } from "@/components/shared/AsyncState"
import { Separator } from "@/components/ui/separator"

export function JobDetailPlaceholderPanel({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <>
      <EmptyState title={title} description={description} />
      <Separator />
    </>
  )
}
