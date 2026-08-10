import { useQuery } from "@tanstack/react-query"
import { SearchIcon } from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { api } from "@/api/client"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/AsyncState"
import { PromptActionCard } from "@/components/shared/prompt-cards/PromptActionCard"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  useObservedWidth,
  useVirtualRows,
} from "@/hooks/use-virtual-rows"
import { CHECK_SOURCE_SUPPORT_PROMPT } from "@shared/prompts/insu-prompts"
const estimateSourceRow = () => 39

export function SupportedSitesContent() {
  const [search, setSearch] = useState("")
  const query = useQuery({
    queryKey: ["supported-sites"],
    queryFn: api.supportedSites,
  })
  const matches = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("en")
    return (query.data?.extractors ?? []).filter(
      (extractor) =>
        !normalized || extractor.toLocaleLowerCase("en").includes(normalized),
    )
  }, [query.data?.extractors, search])
  const sourceListRef = useRef<HTMLDivElement>(null)
  const listWidth = useObservedWidth(sourceListRef)
  const columnCount = listWidth >= 800 ? 4 : listWidth >= 480 ? 2 : 1
  const rowCount = Math.ceil(matches.length / columnCount)
  const sourceRows = useVirtualRows({
    count: rowCount,
    estimateSize: estimateSourceRow,
    overscan: 6,
    gap: 1,
    getItemKey: (index) => matches[index * columnCount] ?? index,
    scrollRef: sourceListRef,
  })
  return (
    <div className="guide-tab-content supported-sites-content">
      <PromptActionCard
        kicker="CHECK A SOURCE"
        title="詢問 Agent 是否支援"
        description="複製提示並附上平台或影音網址，Agent 會先檢查、必要時更新 yt-dlp，再研究支援方式。"
        prompt={CHECK_SOURCE_SUPPORT_PROMPT}
      />
      <label className="search-control sources-search">
        <span className="sr-only">搜尋支援網站</span>
        <SearchIcon aria-hidden="true" />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜尋 YouTube、Vimeo、Twitch"
        />
      </label>
      {query.isPending ? <LoadingState label="正在讀取目前 yt-dlp 版本" /> : null}
      {query.isError ? <ErrorState message={query.error.message} /> : null}
      {query.data && !query.data.available ? (
        <EmptyState
          title="尚未安裝 yt-dlp"
          description="完成目前 workspace 的環境設定後，這裡會顯示完整清單。"
        />
      ) : null}
      {query.data?.available ? (
        <>
          <div className="sources-summary">
            <Badge variant="outline">YT-DLP {query.data.version}</Badge>
            <span>
              顯示 {matches.length} / {query.data.count} 個網站解析器
            </span>
          </div>
          {matches.length > 0 ? (
            <div
              ref={sourceRows.scrollRef}
              className="source-list"
              data-total-items={matches.length}
              data-columns={columnCount}
            >
              <ul
                className="source-list__canvas"
                aria-label="支援網站解析器"
                style={{ height: `${sourceRows.totalSize}px` }}
              >
                {sourceRows.virtualRows.flatMap((virtualRow) => {
                  const rowStart = virtualRow.index * columnCount
                  const rowItems = matches.slice(
                    rowStart,
                    rowStart + columnCount,
                  )
                  return rowItems.map((extractor, columnIndex) => (
                    <li
                      key={extractor}
                      className="source-list__item"
                      aria-posinset={rowStart + columnIndex + 1}
                      aria-setsize={matches.length}
                      title={extractor}
                      style={{
                        insetInlineStart: `${(columnIndex / columnCount) * 100}%`,
                        width: `calc(${100 / columnCount}% - ${columnIndex < columnCount - 1 ? 1 : 0}px)`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {extractor}
                    </li>
                  ))
                })}
              </ul>
            </div>
          ) : (
            <EmptyState
              title="找不到這個平台"
              description="把網址交給 Agent，請 INSU Player 研究看看。"
            />
          )}
        </>
      ) : null}
    </div>
  )
}
