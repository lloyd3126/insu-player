# 版本紀錄

## 未發布

- 新增不需封裝或上架商店的 Chrome Extension，可與目前 workspace 的實際 localhost 配對，將目前頁面、嵌入影音、直接媒體與已結束 HLS 加入既有下載佇列
- 新增 Chrome 專用影音卡片頁，只提供搜尋、播放與字幕選擇，不顯示 Agent 提示或轉錄設定
- 登入 Cookie 改為每次明確同意後的短期本機工作階段，只建立權限 `0600` 的暫存 jar，下載完成即刪除且不寫入 SQLite、log 或 metadata
- 下載來源與媒體紀錄改為 clean-break schema，頁面網址可持久化，iframe 與網路媒體實際網址只留在短期記憶體，直播、DRM HLS、播放清單與無法還原來源的 blob 直接拒絕
- 下載批次統一以 SQLite operation 與 event 作為狀態事實來源，支援並行下載、暫停、繼續、取消、失敗重試與低畫質確認
- 移除 React 改版前的舊版首頁 HTML、CSS、JavaScript 與 Hono legacy asset fallback，首頁與診斷伺服器統一供應同一份 React build
- 將單筆影音詳情拆為「關於」、「字幕」、「切分」與「處理紀錄」四個分頁，狀態歷程位於關於並只讓清單區域獨立捲動，全寬 Workflow log 位於處理紀錄，字幕與 log 改為按需載入
- 將轉錄設定中的「模型列表」拆為獨立的「本機模型」與「雲端模型」分頁，共用同一份模型資料查詢
- 在本機與雲端模型分頁上方加入共用提示卡，移除重複的模型標題與摘要，只讓下方模型表格捲動
- 將雲端模型表格的 API Key 欄改為下拉選單，顯示相容的環境變數名稱，未設定時可直接前往環境變數分頁
- 讓本機模型與雲端模型共用相同的固定資料列高度
- 將環境變數分頁改為共用提示卡與固定欄寬表格，移除重複的 SESSION ONLY 說明與 SDK 狀態，只讓表格區域捲動
- 讓環境變數表格依 Modal 寬度收縮，只保留垂直捲動並移除水平 scrollbar
- 更新環境變數提示卡，明確要求 Agent 不得讀取 Key 原值
- 更新開始使用提示卡說明，明確引導使用者複製並貼回 YouTube 網址
- 將支援網站分頁改為固定內容區，只讓搜尋列下方的網站清單捲動，移除外層重複 scrollbar
- 將「我的提示」建立卡固定於上方，只讓下方的緊湊提示卡與自訂提示清單捲動
- 將「使用情境」的四張內建緊湊提示卡移到「我的提示」建立卡下方，並移除獨立的「使用情境」分頁
- 將支援網站原有的平台研究與 yt-dlp 更新提示合併為搜尋列上方單一的「詢問 Agent 是否支援」標準提示卡
- 將提示介面整理為命名明確的 `PromptActionCard`、`ReusablePromptCard` 與可組合步驟及範例的 `TutorialCard` 共用元件，統一前兩者的「複製提示」按鈕並固定於右上角，同步相容頁面的語意 class 名稱
- 讓所有含分頁的 Modal 共用 `AppDialog` tabbed 版型，固定標題與 Tab 列，只捲動目前分頁下方的內容區
- 將轉錄設定 Modal 的高度統一為使用說明與影音中心的完整畫面高度，同時保留原本較窄的寬度
- 在所有 Modal 的 Tab panel 內容與暗色 scrollbar 之間加入一致的右側間距，並在捲軸出現前預留穩定 gutter
- 影音卡片在滑鼠移入或鍵盤聚焦時，於縮圖右下角顯示 YouTube 式影音時長，新工作會保存來源時長，舊資料沿用播放器已知時長
- 將影音中心的 tabs 移到頂部並改名為「我的影音」與「詳細資訊」，前者簡化為全寬搜尋列與影音卡片，摘要與處理列表收入後者
- 將「影音列表」改為「影音中心」，新增網格與列表分頁，有影音時預設顯示最多三欄的縮圖標題網格，空庫時預設顯示列表
- 將影片庫身分綁定到使用者選定的 project-local workspace，避免 installed plugin 因同機另一個 INSU 服務或 port 衝突而跨專案沿用資料
- 將 `$watch-video` 的第一個使用者可見動作改為啟動目前 workspace 首頁，並用 Codex 內建瀏覽器立即開啟
- 讓影片庫在預設 port 被占用時自動綁定可用 localhost port，並在 workspace 記錄實際 endpoint，不再猜測固定 fallback port
- 在字幕取得前明確確認翻譯需求，翻譯模式不再取得平台字幕，改由明確選定的本機或 OpenAI 模型產生詞級時間，經初譯與完整句潤色後成對輸出共享時間軸的英繁 VTT
- 精簡影片表格為固定欄寬的影片、目前狀態、字幕與操作，移除狀態圓點，並在詳情加入關於、字幕、切分分頁及多語字幕對照
- 以 React + Vite + shadcn/ui 原位取代固定首頁，將導覽、對話框、狀態、表格、字幕對照與播放器入口拆成可重用元件，不另開新版頁面
- 將影片列表的字幕欄改為語言碼下拉選單，並把列表選定的字幕軌直接帶入播放器
- 將首頁導覽收斂為使用說明、轉錄設定與影片列表，前兩者分別以分頁整合既有說明與設定內容
- 將「我的提示」移為使用說明的獨立分頁，並讓開始使用、我的提示與平台研究共用 Agent 提示 callout 元件
- 將內建情境與我的提示統一使用可重用提示卡，卡片列表改為全寬單欄排列
- 將模型區塊標示改為供應商中立的 `LOCAL MODEL` 與 `CLOUD MODEL`，模型欄顯示含供應商的完整名稱，API Key 摘要改為可計數狀態
- 將本機服務原位改為 Hono + Drizzle + Bun SQLite，保留 `status.json`、history 與 log 為事實來源，並投影到 workspace 的 `app.db`
- 加入 workspace-local Bun bootstrap、production bundle、Drizzle migration、桌面與行動版 Playwright 流程，以及 release artifact 驗證
- 移除首頁的介面設定入口、主色與字體切換、瀏覽器外觀偏好及其相容頁面實作
- 簡化首頁封面為純黑底與單一品牌圖片，移除光暈、圓圈、十字、軌道標籤與頁尾更新時間，並拉開主標題行距

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
