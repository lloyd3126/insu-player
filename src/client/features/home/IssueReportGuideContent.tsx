import { ArrowRightIcon, ArrowUpRightIcon } from "lucide-react"
import { useState } from "react"

import { PromptActionCard } from "@/components/shared/prompt-cards/PromptActionCard"
import {
  TutorialCard,
  TutorialStep,
  TutorialStepList,
} from "@/components/shared/prompt-cards/TutorialCard"
import { Button, buttonVariants } from "@/components/ui/button"
import { DIAGNOSE_PLAYER_ISSUE_PROMPT } from "@shared/prompts/insu-prompts"

const ISSUE_URL = "https://github.com/lloyd3126/insu-player/issues/new"

export function IssueDiagnoseContent({
  onContinue,
}: {
  onContinue: () => void
}) {
  const [promptCopied, setPromptCopied] = useState(false)

  return (
    <div className="guide-tab-content usage-layout">
      <PromptActionCard
        kicker="01 / DIAGNOSE"
        title="請 Agent 偵查問題"
        description="複製提示並貼給目前的 Agent。Agent 會先唯讀重現問題，再整理成可公開的回報。"
        prompt={DIAGNOSE_PLAYER_ISSUE_PROMPT}
        copyLabel="複製偵查提示"
        onCopied={() => setPromptCopied(true)}
        footer={promptCopied ? (
          <Button onClick={onContinue}>
            前往檢查回報
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        ) : undefined}
      />
    </div>
  )
}

export function IssueReviewContent({
  onContinue,
}: {
  onContinue: () => void
}) {
  return (
    <div className="guide-tab-content usage-layout">
      <TutorialCard
        kicker="02 / REVIEW"
        title="檢查 Agent 整理的回報"
        description="確認內容足以重現問題，而且不包含任何私密資料，再複製完整的 Markdown。"
        footer={(
          <Button onClick={onContinue}>
            前往建立 Issue
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        )}
      >
        <TutorialStepList>
          <TutorialStep
            number="01"
            title="等待唯讀偵查完成"
            description="Agent 不應修改資料、重新下載、重新轉錄或直接修復"
          />
          <TutorialStep
            number="02"
            title="確認問題描述完整"
            description="至少要有重現步驟、預期結果、實際結果與能證明問題的證據"
          />
          <TutorialStep
            number="03"
            title="移除私密資料"
            description="不得包含 API Key、Cookie、token、signed URL、使用者名稱或私人路徑"
          />
          <TutorialStep
            number="04"
            title="複製完整 Markdown"
            description="保留 Agent 整理的標題與段落，下一步直接貼到 GitHub"
          />
        </TutorialStepList>
      </TutorialCard>
    </div>
  )
}

export function IssueSubmitContent() {
  return (
    <div className="guide-tab-content usage-layout">
      <TutorialCard
        kicker="03 / GITHUB"
        title="到 GitHub 建立 Issue"
        description="開啟 INSU Player repository，貼上剛才確認過的 Markdown 回報。"
        footer={(
          <a
            className={buttonVariants()}
            href={ISSUE_URL}
            target="_blank"
            rel="noreferrer"
          >
            前往 GitHub 建立 Issue
            <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        )}
      >
        <TutorialStepList>
          <TutorialStep
            number="01"
            title="建立新的 Issue"
            description="GitHub 會在新分頁開啟 INSU Player 的 Issue 表單"
          />
          <TutorialStep
            number="02"
            title="填寫簡短標題"
            description="用一句話說明發生的位置與最明顯的症狀"
          />
          <TutorialStep
            number="03"
            title="貼上 Markdown 回報"
            description="再次確認預覽中沒有私密資料，再送出 Issue"
          />
        </TutorialStepList>
      </TutorialCard>
    </div>
  )
}
