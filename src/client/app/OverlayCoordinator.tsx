import { lazy, Suspense } from "react"

import { useOverlay } from "@/app/overlay-context"

const UsageGuideDialog = lazy(() =>
  import("@/features/home/UsageGuideDialog").then((module) => ({
    default: module.UsageGuideDialog,
  })),
)
const JobDetailDialog = lazy(() =>
  import("@/features/job-detail/JobDetailDialog").then((module) => ({
    default: module.JobDetailDialog,
  })),
)
const LibraryDialog = lazy(() =>
  import("@/features/library/LibraryDialog").then((module) => ({
    default: module.LibraryDialog,
  })),
)
const PlayerDialog = lazy(() =>
  import("@/features/player/PlayerDialog").then((module) => ({
    default: module.PlayerDialog,
  })),
)
const UsagePolicyDialog = lazy(() =>
  import("@/features/policy/UsagePolicyDialog").then((module) => ({
    default: module.UsagePolicyDialog,
  })),
)
const FeatureSettingsDialog = lazy(() =>
  import("@/features/settings/FeatureSettingsDialog").then((module) => ({
    default: module.FeatureSettingsDialog,
  })),
)

export function OverlayCoordinator() {
  const { state } = useOverlay()
  const activeDialog = (() => {
    switch (state?.type) {
      case "usage-guide":
        return <UsageGuideDialog />
      case "feature-settings":
        return <FeatureSettingsDialog />
      case "library":
        return <LibraryDialog />
      case "player":
        return <PlayerDialog />
      case "detail":
        return <JobDetailDialog />
      case "policy":
        return <UsagePolicyDialog />
      default:
        return null
    }
  })()

  return (
    <Suspense fallback={null}>{activeDialog}</Suspense>
  )
}
