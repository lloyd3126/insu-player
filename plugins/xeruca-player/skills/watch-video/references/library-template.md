# 本機影片列表首頁模板

這個模板是 `xeruca-player` 流程的固定首頁。它不需前端建置工具，預設只使用本機字體與同源資產；使用者在設定中主動選擇 Google Fonts 時，才會向 Google 載入該字體。`library_server.py` 提供同源 JSON API、影片 Range request、縮圖、VTT、播放器頁面、播放進度端點，以及不落盤的工作階段環境變數端點。

## 介面契約

- `/`：固定影片庫首頁
- `/api/jobs`：所有任務的即時摘要
- `/api/jobs/<video-id>`：單一任務、歷程與產物資訊
- `/api/jobs/<video-id>/log`：執行紀錄末段
- `/api/prompts`：workspace「我的提示」唯讀清單
- `/api/models`：workspace 實際下載的本機模型、檔案大小、API SDK 安裝狀態與 API Key 是否已設定
- `GET /api/environment`：只回傳白名單環境變數是否已設定
- `POST /api/environment`：把白名單變數套用到目前本機服務程序
- `DELETE /api/environment/<name>`：從目前本機服務程序清除變數
- `PUT /api/jobs/<video-id>/playback`：只寫入該 job 的 `ui-state.json`
- `/watch/<video-id>/`：可獨立開啟、也可嵌入 iframe 的播放器
- `/media/<video-id>/video`：支援 HTTP Range 的 MP4
- `/captions/<video-id>/<language>.vtt`：字幕

首頁是全高入口頁；主視覺與 navbar 的「開始使用」會開啟同一個 YouTube 範例 modal，「進階使用」提供內建情境與 workspace「我的提示」的唯讀複製介面，「支援網站」列出 workflow-local yt-dlp 的實際支援清單，「環境變數」只管理目前服務程序的白名單變數，「模型列表」分別顯示本機模型的實際下載大小，以及 API SDK 與 API Key 是否已設定，「影片列表」則開啟持續更新的任務列表 modal。列表每 2.5 秒更新一次；環境變數 modal 開啟時，遮罩狀態也跟著同一個 `LAST SYNC` 輪詢更新。播放時從影片列表疊開 iframe modal，關閉後會清除 `src` 以停止解碼並回到列表；播放進度存於同一 job 的 `ui-state.json`，刪除專案資料夾時會一起移除，不使用瀏覽器 `localStorage`。主色設定則保存在目前瀏覽器並即時套用，不寫入影片 job。

介面設定 modal 可即時切換主色與全頁唯一字體。字體可選常見本機字體、輸入已安裝的本機字體名稱，或由使用者主動選擇 Google Fonts；不使用斜體。外觀偏好只保存在目前瀏覽器，不寫入影片 job 或 `prompts.json`。

## 安全邊界

影片列表、進階使用與模型列表 modal 刻意只有觀察、搜尋、篩選、複製、查看紀錄與播放功能。模型列表只回傳模型名稱、實際檔案大小、provider 安裝狀態與 API Key 是否已設定，不會公開 Key、模型檔案或路徑。環境變數 modal 只允許程式內建白名單，公開狀態端點不回傳原值；寫入與清除要求同源請求。服務啟動時會建立權限為 `0600` 的短期 session descriptor，內容只有 localhost endpoint 與隨機 token，不含 API 金鑰，停止服務後移除。Agent 只有在使用者明確同意 API 上傳並提供 `--allow-api-upload` 時，才可透過 descriptor 讓轉錄子程序繼承服務程序中的金鑰。除此之外，新增影片、提示管理、重試、取消、翻譯與刪除都由 Agent 或 INSU 工作流程腳本執行。伺服器只允許預定路由，而且只綁定 localhost，不會把 `.agent-tools`、模型或任意工作區檔案公開出去。

## 啟動

```bash
plugins/xeruca-player/skills/watch-video/scripts/serve-library.sh <workspace> 8000
```

然後開啟 <http://127.0.0.1:8000/>。首頁依賴 `library_server.py`，不能使用一般靜態伺服器取代。
