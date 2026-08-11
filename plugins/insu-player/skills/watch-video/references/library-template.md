# 本機影片中心首頁模板

這個模板是 `insu-player` 流程的固定首頁。React + Vite + shadcn/ui build 位於 `assets/library/app/`，較大的功能對話框按需載入，並由單一 overlay coordinator 組合。它不是平行的新版首頁。所有執行時資產同源，不依賴 CDN。Hono bundle 位於 `assets/server/insu-player-server.js`，透過 workspace-local Bun 提供 JSON API、影片 Range request、縮圖、VTT、播放器、播放進度、統一模型目錄與不落盤的 provider credential 端點。Drizzle current schema 會在 workspace 建立 `app.db`。

`app.db` 中的 media item、operation、event、artifact 與 playback row 是中斷復原的唯一事實來源。Workflow log 只用於診斷，不可用來推定狀態。

## 介面契約

- `/`：固定影片庫首頁
- `/api/health`：Bun、Hono 與 SQLite 服務狀態及實際 port
- `/api/jobs`：所有任務的即時摘要
- `/api/jobs/<video-id>`：單一任務、歷程與產物資訊
- `/api/jobs/<video-id>/log`：執行紀錄末段
- `/api/jobs/<video-id>/captions`：以英文句級時間軸對齊的多語字幕列
- `GET /api/jobs/<video-id>/media`：來源可用畫質、已下載 rendition、active rendition 與 operation
- `POST /api/jobs/<video-id>/media/refresh`：重新取得來源畫質 metadata
- `POST /api/jobs/<video-id>/media/renditions`：建立 exact-height 背景下載工作
- `PUT /api/jobs/<video-id>/media/active`：切換播放器使用的已下載 rendition
- `/api/prompts`：workspace「我的提示」唯讀清單
- `GET /api/models`：回傳本機與雲端語音辨識模型、唯一選用狀態、就緒狀態與 provider credential 遮罩狀態
- `GET /api/models/<model-id>`：回傳指定模型與其 provider 狀態，不回傳 Key 原值
- `PUT /api/models/selection`：以穩定 model ID 選用一個已就緒模型
- `PUT /api/providers/<provider>/credential`：把該 provider 的固定 Key 套用到目前本機服務程序
- `DELETE /api/providers/<provider>/credential`：從目前本機服務程序清除 provider Key
- `PUT /api/jobs/<video-id>/playback`：直接寫入 SQLite playback state
- `/watch/<video-id>/`：可獨立開啟、也可嵌入 iframe 的播放器
- `/media/<video-id>/video`：支援 HTTP Range 的 MP4
- `/captions/<video-id>/<language>.vtt`：字幕

首頁是全高入口頁。navbar 依序只顯示「開始說明」、「我的提示」、「轉錄設定」、「支援網站」、「擴充功能」與「影片中心」六個純文字入口。「開始說明」以「初始化」、「下一步」、「加入影音」與「操作流程」四個 tabs 分開呈現，每個 tab 只放一個主要段落。加入影音先讓使用者貼上單支影音網址，通過 http 或 https 格式驗證後，才啟用「複製加入提示」。提示會安全嵌入該網址，不顯示或複製技術 placeholder。操作流程以四個步驟說明貼上網址、複製提示、回答白話問題與回到影片中心查看結果。「我的提示」與「支援網站」是各自獨立、可由 URL 恢復的 dialog，內建使用情境提示位於「我的提示」建立卡下方。「擴充功能」會開啟標題為「Chrome 擴充功能」的獨立 dialog，以安裝、連接、使用三個 tabs 說明未封裝資料夾載入、目前 localhost origin 配對、頁面／embed／MP4／HLS 加入，以及登入 Cookie 的單次本機使用邊界。

「轉錄設定」只顯示一張統一模型表格，欄位固定為選用、類型、模型、狀態與操作。模型欄取得剩餘寬度，其餘欄位依內容收合。詳情按鈕開啟可重新整理保留的 nested modal。本機詳情負責下載、取消、驗證與移除，雲端詳情負責該 provider 共用 Key 的設定與清除。「影片中心」每 2.5 秒更新，並在頂部以「我的影音」與「詳細資訊」tabs 切換。「我的影音」只放全寬搜尋列與最多三欄的縮圖標題卡片。「詳細資訊」收納摘要統計、狀態篩選與固定欄寬列表。有影音時預設開啟前者，空庫時預設開啟後者。播放與詳情共用同一層 overlay，播放器在同源 iframe 內開啟。

詳情依序分為關於影音、畫質管理、字幕管理、影音摘要、影音筆記與執行紀錄六個 tabs。關於影音顯示媒體資訊、依目前狀態產生的下一步卡片，以及獨立捲動的狀態歷程表格。處理中只顯示等待，失敗時提供精確恢復提示，完整句字幕完成但尚未切分時只提供切分提示，驗證完成後顯示完成。畫質管理顯示來源可下載畫質、本機 rendition、active rendition、執行進度與直接移除操作。字幕管理以內層 tabs 統一原始字幕、校正字幕、翻譯字幕與切分字幕，共用版本譜系、revision 選單、驗證狀態與多語並排表格，而且只有表格區域捲動。校正、翻譯與切分分頁上方提供共用提示卡，翻譯卡優先沿用最新有效校正稿。執行紀錄提供 Agent 檢查提示與全寬 log。原始字幕收納 yt-dlp 來源字幕或本機、雲端模型轉錄字幕，校正字幕保存同語言完整句修正，翻譯字幕顯示完整目標語字幕，切分字幕顯示 target-first alignment 結果。影音摘要與影音筆記共用空狀態 panel 保留位置。畫質、字幕與 log 只在使用者切到對應分頁時載入。字幕內層分頁與 revision 寫入 URL，重新整理後保留目前畫面。播放器頁尾以已下載 rendition 的畫質選單切換 active rendition，不會在播放器內下載新畫質。

支援網站在搜尋列上方提供單一「詢問 Agent 是否支援」提示卡。提示會先檢查目前解析器，必要時安全更新 workspace 內的 yt-dlp，仍不支援才研究平台。

## 安全邊界

我的提示與模型目錄維持觀察、搜尋、複製與查看用途。影片中心另提供少數成熟且邊界明確的同源操作：切換已下載畫質、建立 exact-height 畫質下載工作，以及經共用確認對話框移除影音／字幕／非 active rendition。所有媒體操作只接受 video ID、rendition ID 或高度，不接受瀏覽器提供的路徑或來源 URL。模型目錄顯示每個本機或雲端模型的完整名稱、類型、就緒狀態與唯一選用狀態。模型資料只回傳穩定 ID、provider、service、model、安裝狀態、credential 名稱與是否已設定，不會公開 Key、模型檔案或路徑。Provider credential 只允許程式內建的固定映射，公開端點不回傳原值，寫入與清除要求同源請求。同一 provider 的多個模型共用一份 session credential。正常啟動腳本會先清除 parent process 的白名單 Key，首頁只能使用使用者在雲端模型詳情設定的本次服務值。服務啟動時會建立權限為 `0600` 的 `.insu-provider-session.json`，內容只有 localhost endpoint 與隨機 token，不含 API 金鑰，停止服務後移除。Agent 只有在使用者明確同意所選雲端服務接收音訊並提供 `--consent-to-audio-upload` 時，才可透過 descriptor 讓轉錄子程序繼承服務程序中的金鑰。雲端 API 不得用於字幕文字處理，也不得自動 fallback。

新增影片、提示管理、轉錄、翻譯及複雜修復仍由 Agent 或 INSU 工作流程腳本執行。伺服器只允許預定路由，而且只綁定 localhost，不會把 `.agent-tools`、模型或任意工作區檔案公開出去。

## 啟動

```bash
plugins/insu-player/skills/watch-video/scripts/serve-library.sh <workspace>
```

然後開啟命令回報的實際網址。服務優先使用 <http://127.0.0.1:8000/>。若該 port 已被占用，會先做獨占探測，再由作業系統分配可用 port，並把實際 endpoint 寫入 `<workspace>/.insu-player-server.json`。首頁只使用 workspace-local Bun 執行 Hono bundle，不能使用一般靜態伺服器取代。
