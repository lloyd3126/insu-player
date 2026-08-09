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
- `/api/prompts`：workspace「我的提示」唯讀清單
- `/api/models`：workspace 實際下載的本機模型、檔案大小、API SDK 安裝狀態與 API Key 是否已設定
- `GET /api/environment`：只回傳白名單環境變數是否已設定
- `POST /api/environment`：把白名單變數套用到目前本機服務程序
- `DELETE /api/environment/<name>`：從目前本機服務程序清除變數
- `PUT /api/jobs/<video-id>/playback`：寫入該 job 的 `ui-state.json` 並更新 SQLite 投影
- `/watch/<video-id>/`：可獨立開啟、也可嵌入 iframe 的播放器
- `/media/<video-id>/video`：支援 HTTP Range 的 MP4
- `/captions/<video-id>/<language>.vtt`：字幕

首頁是全高入口頁；navbar 只保留「使用說明」、「功能設定」與「影音中心」。主視覺與 navbar 的「使用說明」會開啟同一個 dialog，並以 tabs 切換開始使用、我的提示與支援網站；內建使用情境提示位於「我的提示」建立卡下方。「功能設定」以 tabs 切換環境變數、本機模型與雲端模型；三個分頁都固定上方提示卡並只讓下方表格捲動。環境變數表格只呈現變數名稱、設定狀態、遮蔽的新值輸入與操作，不重複顯示 SDK 狀態；模型分頁移除重複的模型標題與摘要。「影音中心」每 2.5 秒更新，並在頂部以「我的影音」與「詳細資訊」tabs 切換。「我的影音」只放全寬搜尋列與最多三欄的縮圖標題卡片；「詳細資訊」收納摘要統計、狀態篩選與固定欄寬列表。有影音時預設開啟前者，空庫時預設開啟後者。播放與詳情共用同一層 overlay，播放器在同源 iframe 內開啟；詳情分為關於、字幕、切分與處理紀錄四個 tabs。關於顯示媒體資訊與獨立捲動的狀態歷程，字幕顯示語言、模型、字幕流程與多語對照，處理紀錄顯示目前階段與全寬 Workflow log。字幕與 log 只在使用者切到對應分頁時載入。

支援網站在搜尋列上方提供單一「詢問 Agent 是否支援」提示卡；提示會先檢查目前解析器，必要時安全更新 workspace 內的 yt-dlp，仍不支援才研究平台。

## 安全邊界

影音中心、我的提示、本機模型與雲端模型刻意只有觀察、搜尋、篩選、複製、查看紀錄與播放功能。雲端模型表格以選單顯示每個模型相容的 API Key 名稱與設定狀態，未設定時可直接切到環境變數分頁。模型資料只回傳模型名稱、實際檔案大小、provider 安裝狀態、API Key 名稱與是否已設定，不會公開 Key、模型檔案或路徑。環境變數只允許程式內建白名單，公開狀態端點不回傳原值；寫入與清除要求同源請求。服務啟動時會建立權限為 `0600` 的短期 session descriptor，內容只有 localhost endpoint 與隨機 token，不含 API 金鑰，停止服務後移除。Agent 只有在使用者明確同意 API 上傳並提供 `--allow-api-upload` 時，才可透過 descriptor 讓轉錄子程序繼承服務程序中的金鑰。

新增影片、提示管理、重試、取消、翻譯與刪除仍由 Agent 或 INSU 工作流程腳本執行。伺服器只允許預定路由，而且只綁定 localhost，不會把 `.agent-tools`、模型或任意工作區檔案公開出去。

## 啟動

```bash
plugins/insu-player/skills/watch-video/scripts/serve-library.sh <workspace>
```

然後開啟命令回報的實際網址。服務優先使用 <http://127.0.0.1:8000/>；若該 port 已被占用，會先做獨占探測，再由作業系統分配可用 port，並把實際 endpoint 寫入 `<workspace>/.insu-player-server.json`。首頁依賴 workspace-local Bun 執行 Hono bundle，不能使用一般靜態伺服器取代。產品只保留 React build，不提供舊版 HTML、CSS、JavaScript 或資產 fallback。`library_server.py` 僅供診斷與測試，並供應同一份 React build，不是目前啟動器入口。
