# 本機影音中心首頁模板

這個模板是 `insu-player` 流程的固定首頁。React + Vite + shadcn/ui build 位於 `assets/library/app/`，較大的功能對話框按需載入，並由單一 overlay coordinator 組合；它不是平行的新版首頁。所有執行時資產同源，不依賴 CDN。Hono bundle 位於 `assets/server/insu-player-server.js`，透過 workspace-local Bun 提供 JSON API、影片 Range request、縮圖、VTT、播放器、播放進度與不落盤的工作階段環境變數端點。Drizzle migration 會在 workspace 建立 `app.db`。

`status.json`、job history 與 workflow log 是中斷復原的事實來源。`app.db` 是讀取時更新的查詢投影，不取代或反向覆寫這些工作流程檔案。

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
- `/api/models`：workspace 實際下載的本機模型、檔案大小、API SDK 安裝狀態與 API Key 是否已設定
- `GET /api/environment`：只回傳白名單環境變數是否已設定
- `POST /api/environment`：把白名單變數套用到目前本機服務程序
- `DELETE /api/environment/<name>`：從目前本機服務程序清除變數
- `PUT /api/jobs/<video-id>/playback`：寫入該 job 的 `ui-state.json` 並更新 SQLite 投影
- `/watch/<video-id>/`：可獨立開啟、也可嵌入 iframe 的播放器
- `/media/<video-id>/video`：支援 HTTP Range 的 MP4
- `/captions/<video-id>/<language>.vtt`：字幕

首頁是全高入口頁；navbar 只保留「使用說明」、「功能設定」與「影音中心」。主視覺與 navbar 的「使用說明」會開啟同一個 dialog，並以 tabs 切換開始使用、我的提示與支援網站；內建使用情境提示位於「我的提示」建立卡下方。「功能設定」以 tabs 切換環境變數、本機模型與雲端模型；三個分頁都固定上方提示卡並只讓下方表格捲動。環境變數表格只呈現變數名稱、設定狀態、遮蔽的新值輸入與操作，不重複顯示 SDK 狀態；模型分頁移除重複的模型標題與摘要。「影音中心」每 2.5 秒更新，並在頂部以「我的影音」與「詳細資訊」tabs 切換。「我的影音」只放全寬搜尋列與最多三欄的縮圖標題卡片；「詳細資訊」收納摘要統計、狀態篩選與固定欄寬列表。有影音時預設開啟前者，空庫時預設開啟後者。播放與詳情共用同一層 overlay，播放器在同源 iframe 內開啟。詳情依序分為關於影音、畫質管理、字幕管理、影音摘要、影音筆記與執行紀錄六個 tabs。關於影音顯示媒體資訊與獨立捲動的狀態歷程表格；畫質管理顯示來源可下載畫質、本機 rendition、active rendition、執行進度與直接移除操作；字幕管理以內層 tabs 統一原始字幕、翻譯字幕與切分字幕，共用版本譜系、revision 選單、驗證狀態與多語並排表格，且只有表格區域捲動；執行紀錄提供 Agent 檢查提示與全寬 log。原始字幕收納 yt-dlp 來源字幕或本機、雲端模型轉錄字幕，翻譯字幕顯示完整目標語字幕，切分字幕顯示 target-first alignment 結果。影音摘要與影音筆記共用空狀態 panel 保留位置。畫質、字幕與 log 只在使用者切到對應分頁時載入；字幕內層分頁與 revision 寫入 URL，重新整理後保留目前畫面。播放器頁尾以已下載 rendition 的畫質選單切換 active rendition，不會在播放器內下載新畫質。

支援網站在搜尋列上方提供單一「詢問 Agent 是否支援」提示卡；提示會先檢查目前解析器，必要時安全更新 workspace 內的 yt-dlp，仍不支援才研究平台。

## 安全邊界

我的提示、本機模型與雲端模型維持觀察、搜尋、複製與查看用途。影音中心另提供少數成熟且邊界明確的同源操作：切換已下載畫質、建立 exact-height 畫質下載工作，以及經共用確認對話框移除影音／字幕／非 active rendition。所有媒體操作只接受 video ID、rendition ID 或高度，不接受瀏覽器提供的路徑或來源 URL。雲端模型表格以選單顯示每個模型相容的 API Key 名稱與設定狀態，未設定時可直接切到環境變數分頁。模型資料只回傳模型名稱、實際檔案大小、provider 安裝狀態、API Key 名稱與是否已設定，不會公開 Key、模型檔案或路徑。環境變數只允許程式內建白名單，公開狀態端點不回傳原值；寫入與清除要求同源請求。服務啟動時會建立權限為 `0600` 的短期 session descriptor，內容只有 localhost endpoint 與隨機 token，不含 API 金鑰，停止服務後移除。Agent 只有在使用者明確同意 API 上傳並提供 `--allow-api-upload` 時，才可透過 descriptor 讓轉錄子程序繼承服務程序中的金鑰。

新增影片、提示管理、轉錄、翻譯及複雜修復仍由 Agent 或 INSU 工作流程腳本執行。伺服器只允許預定路由，而且只綁定 localhost，不會把 `.agent-tools`、模型或任意工作區檔案公開出去。

## 啟動

```bash
plugins/insu-player/skills/watch-video/scripts/serve-library.sh <workspace>
```

然後開啟命令回報的實際網址。服務優先使用 <http://127.0.0.1:8000/>；若該 port 已被占用，會先做獨占探測，再由作業系統分配可用 port，並把實際 endpoint 寫入 `<workspace>/.insu-player-server.json`。首頁只使用 workspace-local Bun 執行 Hono bundle，不能使用一般靜態伺服器取代。
