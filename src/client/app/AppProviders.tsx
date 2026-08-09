import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

import { OverlayProvider } from "@/app/overlay-context"
import { TooltipProvider } from "@/components/ui/tooltip"

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 1_000,
            refetchOnWindowFocus: true,
          },
        },
      }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <OverlayProvider>{children}</OverlayProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
}
