import type { DownloadQueueService } from "@server/services/download-queue-service"
import type { LocalMediaImportService } from "@server/services/local-media-import-service"
import type { LibraryItem, LibraryResponse } from "@shared/contracts/library"

function priority(item: LibraryItem) {
  if (item.kind === "media") return 4
  if (item.kind === "import") {
    if (["uploading", "probing", "transcoding", "finalizing"].includes(item.state)) {
      return 0
    }
    return item.state === "failed" ? 2 : 3
  }
  if (["checking", "downloading", "verifying"].includes(item.state)) return 0
  if (item.state === "queued") return 1
  if (["needs_confirmation", "failed"].includes(item.state)) return 2
  return 3
}

export class LibraryService {
  constructor(
    private readonly downloads: DownloadQueueService,
    private readonly imports: LocalMediaImportService,
  ) {}

  list(): LibraryResponse {
    const response = this.downloads.list()
    const pendingImports = this.imports
      .list()
      .filter((item) => item.state !== "ready")
    const items = [...response.items, ...pendingImports]
    items.sort((left, right) => priority(left) - priority(right))
    return { ...response, items }
  }
}
