# 版本紀錄

## v0.2.0 — 2026-08-09

- 將 plugin ID、marketplace、Release 檔名、workspace 與 runtime 路徑統一為 `insu-player`
- 將既有 `.local` workspace 與 workflow-local runtime 原位搬移，保留影片、字幕、狀態與播放進度
- 為 Codex plugin 卡片加入紫嘯鶇 icon、紫色品牌色與中文說明
- 將 portable 與完整工作流程範例統一指向 `.local/insu-player`
- 將本機 Whisper 的預設下載與轉錄模型改為 `medium`

## v0.1.0 — 2026-08-09

INSU Player 的第一個公開版本。

- 將產品品牌更新為 INSU Player，以臺灣紫嘯鶇作為識別與紫色主視覺
- 提供全高首頁，以及開始使用、進階使用、支援網站、介面設定、環境變數、模型列表與影片列表
- 依 workflow-local yt-dlp 的 extractor 清單顯示實際支援網站
- 提供可複製的進階情境與由 Agent 維護的「我的提示」
- 模型列表顯示本機模型實際大小、API SDK 安裝狀態與 API Key 是否已設定
- 允許從首頁把白名單 API Key 套用到本次本機服務，不寫入 `.env`、job、log 或 metadata
- 支援主色、Google Fonts 與本機字體即時切換
- 統一 modal 尺寸、捲動樣式、播放器與播放進度保存行為
