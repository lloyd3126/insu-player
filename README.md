# INSU Player

> 用 Agent，讓影音跨越語言。

INSU Player 是為 Codex Agent 設計的本機影音與字幕工作台。把你有權處理的單支影音網址交給 `$watch-video`，Agent 會開啟目前專案的首頁，再協調下載、轉錄、翻譯、字幕重排與播放。

產品以一個固定的 React 首頁為中心，導覽只保留使用說明、功能設定與影音中心。播放器、詳情、字幕對照和處理進度都在同一頁內開啟，不會為每支影音另建一個首頁，也不保留舊版首頁或資產 fallback。React Router 只負責把目前開啟的 modal、影音與 tab 寫進網址，因此重新整理後會回到同一畫面。

## 安裝 Codex plugin

```bash
codex plugin marketplace add https://github.com/lloyd3126/insu-player.git
codex plugin add insu-player@insu-player
```

安裝後重新開啟 Codex task，在要建立影音庫的專案中開啟 INSU Player plugin，選擇「試用」。

如果找不到「試用」，請直接輸入：

```text
用 $watch-video 初始化 INSU Player：安裝所有依賴及 OpenAI SDK、設定 SQLite、完成所有設定並下載 Whisper medium；完成後用 Codex 內建瀏覽器開啟首頁並引導我加入影音及設定字幕翻譯。
```

每個專案都有自己的 `.local/insu-player/` workspace。Plugin 不會因為同一台電腦上有其他 INSU Player 服務，就改用別的專案資料。

## 實際工作流程

Agent 處理一支影音時會：

1. 解析目前專案的 workspace，啟動或沿用它自己的服務。
2. 先用 Codex 內建瀏覽器開啟首頁，讓後續進度持續可見。
3. 確認使用者有權下載與處理該媒體。
4. 在檢查或取得字幕前，先詢問是否需要翻譯及目標 BCP 47 語言。
5. 根據翻譯決定選擇字幕來源與模型，並將處理狀態寫入 job 紀錄。
6. 完成後在影音中心開啟播放，後續可從原進度續播。

### 字幕來源決定

| 需求 | 處理方式 |
| --- | --- |
| 不需要翻譯 | 優先使用來源平台已有字幕；沒有可用字幕時才需要轉錄 |
| 需要翻譯 | 指定目標 BCP 47 語言並明確選擇本機或 OpenAI 模型，且不檢查、不下載任何平台字幕；改由選定模型從原始音訊產生來源 timed units |

### 翻譯與字幕重排

翻譯不是只替換字幕文字。完整流程會：

1. 以模型產生的來源詞級或 Token 時間軸重建完整句子。
2. 由 `$translate-subtitles` 完成目標語初譯，再以完整句進行潤色。
3. 由獨立的 `$segment-subtitles` 先依目標語切分並 freeze，再對齊來源 timed units。
4. 依語言與輸出 profile 處理寬度、標點、閱讀節奏、required terms 與 bilingual anchors。
5. 通過 paired timing 與 deterministic validation 後，依來源／目標語言碼成對匯入字幕軌。

### 模型選擇

- 本機模型：媒體不離開電腦。Whisper、PyTorch、FFmpeg、模型與 cache 都安裝在 workspace，預設模型為 `medium`，首次安裝可能使用數 GB 空間。
- OpenAI 模型：不下載本機 Whisper 模型，但會將音訊片段上傳到 API，可能產生費用。每次上傳都需要使用者明確同意，並由 Agent 帶入 `--allow-api-upload`。

## 首頁功能

| 入口 | 內容 |
| --- | --- |
| 使用說明 | 以 tabs 整合「開始使用」、「我的提示」與「支援網站」 |
| 開始使用 | 複製範例提示，把影音網址交給 Agent |
| 我的提示 | 複製常用的處理、雙語字幕與中斷復原提示，顯示由 Agent 維護的 workspace 提示，也可複製建立提示 |
| 支援網站 | 依目前 workspace 內 yt-dlp 的 extractor 顯示實際支援來源，並提供詢問 Agent 是否支援的整合提示 |
| 功能設定 | 以 tabs 整合「環境變數」、「本機模型」與「雲端模型」 |
| 環境變數 | 以安全提示卡與表格管理白名單內的 API Key，停止服務即清除 |
| 本機模型 | 顯示完整模型名稱、安裝狀態與實際下載大小，並提供請 Agent 準備模型的提示卡 |
| 雲端模型 | 顯示完整模型名稱、API SDK 與 API Key 設定狀態，並提供安全檢查設定的提示卡 |
| 影音中心 | 以頂部 tabs 切換「我的影音」與「詳細資訊」 |
| 我的影音 | 只顯示全寬搜尋列與影音卡片；有影音時預設開啟，網格最多三欄 |
| 詳細資訊 | 顯示摘要統計、狀態篩選與固定欄寬列表；空庫時預設開啟 |

「詳細資訊」的列表會顯示影音、目前狀態、字幕語言碼與操作。每筆影音的詳情依序分為「關於影音」、「執行紀錄」、「原始字幕」、「影音摘要」、「翻譯字幕」、「切分字幕」與「影音筆記」tabs：

- 「關於影音」顯示目前狀態、來源、時長、容量、影音 ID、建立、更新、完成時間與狀態歷程，頁面本身固定，只有狀態歷程表格獨立捲動。
- 「執行紀錄」提供可交給 Agent 的檢查提示與全寬 log 內容。
- 「原始字幕」顯示由 yt-dlp 取得或由本機、雲端模型從音訊轉錄的原始語言字幕。
- 「翻譯字幕」顯示翻譯後的目標語言字幕與工作流程。
- 「影音摘要」、「切分字幕」與「影音筆記」目前使用共用空狀態 panel 保留功能位置。

「關於影音」底部另有移除按鈕，點擊後會開啟共用的直接刪除確認 Modal。Modal 開啟時由同源 API 執行唯讀預覽，沒有 blocker 才會啟用刪除；確認後後端會以該次預覽的 plan digest 執行並驗證，完成後清除前端快取並返回影音中心。相同元件與協議可延伸到具穩定 ID 的字幕、摘要與筆記，不需要複製提示或請 Agent 協助。

字幕內容與 log 只在第一次切到對應分頁時載入，開啟「關於影音」不會先抓取這兩份較大的資料。

目前狀態欄使用簡明的影音進度，並在字幕處理時直接顯示「模型詞級轉錄」、「初次翻譯」、「完整句潤色」、「目標語字幕切分」、「來源時間對齊」與「雙語成對驗證」等實際階段。

## 六個產品 skills

| Skill | 用途 |
| --- | --- |
| `$watch-video` | 主要入口：開啟首頁，新增影音，並協調字幕、轉錄與翻譯 |
| `$video-library` | 啟動、檢查、修復、安全整理影音庫，或依 preview／confirm／execute／verify 協議移除單一資源 |
| `$transcribe-media` | 將本機音訊或影音轉成正規化 JSON、純文字與 WebVTT |
| `$translate-subtitles` | 以詞級或 Token 時間重建完整句子，產生任意模型支援語言組合的完整自然譯文 |
| `$segment-subtitles` | 先依目標語自然切分，再將 frozen pieces 對齊連續來源時間並輸出同步字幕 |
| `$player-manager` | 檢查安裝狀態、安全更新或完整移除 INSU Player |

`plugins/insu-player/skills/` 是業務規則的唯一來源；repository 內的 `.agents/skills/` 只負責將 Codex 導向對應的 canonical skill。

## Workspace 與安全邊界

- 影音庫身分由專案內的 workspace 路徑決定，不由 port 或同機其他服務決定。
- 服務優先使用 `127.0.0.1:8000`。若 port 已被占用，作業系統會分配可用 port，並將實際 `host`、`port` 與 `pid` 記錄在 `.local/insu-player/.insu-player-server.json`。
- uv、Python、Bun、FFmpeg、yt-dlp、Whisper、模型與 workflow cache 都保留在 workspace；不使用 `sudo`、Homebrew、apt、全域 pip 或全域 npm。
- `OPENAI_API_KEY` 只能來自當前 process environment 或首頁的本次服務設定，不會寫入 `.env`、`app.db`、log、job metadata 或 API 回應。
- 服務只綁定 localhost，不對 LAN 或 Internet 開放。
- INSU Player 不繞過 DRM、付費牆、會員、私人存取、地區限制或帳號控制。
- 清理預設只移除可重建中間檔，保留影音、字幕、狀態、log 與播放進度。

## 應用程式架構

| 層級 | 技術 | 職責 |
| --- | --- | --- |
| 前端 | React、React Router、Vite、shadcn/ui、Lucide | 固定首頁、可重新整理的 modal/tab 路由、影音中心、字幕對照與同源播放器 |
| API | Hono on Bun | localhost JSON API、媒體 Range request、WebVTT、播放進度與本次服務環境變數 |
| 查詢投影 | Drizzle、Bun SQLite | 將工作流程資料投影到 workspace 的 `app.db`，供首頁快速查詢 |
| 工作流程 | `status.json`、history、log | 作為中斷復原與 job 狀態的事實來源，不被 `app.db` 反向覆寫 |
| 執行環境 | project-local workspace | 保存 runtime、媒體、字幕、模型、cache 與播放進度 |

## 專案結構

```text
insu-player/
├── .agents/skills/                 # repository discovery bridge
├── plugins/insu-player/            # Codex plugin 與 canonical skills
├── src/client/                     # React 元件化首頁
├── src/server/                     # Hono API、Drizzle schema 與 Bun server
├── src/shared/                     # 前後端共用契約與 domain logic
├── tests/e2e/                      # Playwright 使用者流程
├── tests/                          # runtime、安全、字幕與產品回歸測試
└── .local/insu-player/             # 使用後產生，不進 Git
```

## 開發與驗證

`scripts/build-web.sh` 會在需要時建立 workspace-local Bun，安裝鎖定依賴，執行 TypeScript 檢查，並建置前後端：

```bash
scripts/build-web.sh
```

完整驗證入口：

```bash
INSU_BUN="$PWD/.local/insu-player/.agent-tools/insu-player/bun-runtime/bin/bun"
"$INSU_BUN" run check
"$INSU_BUN" test src
"$INSU_BUN" run build
INSU_BUN="$INSU_BUN" "$INSU_BUN" run test:e2e --workers=1
python3 -m unittest discover -s tests -v
```

程式修改完成後，還需通過六個 skill validator 與 plugin validator。介面圖示統一使用 [Lucide](https://lucide.dev/)，執行時不載入圖示 CDN。

## 更新與移除

請交給 `$player-manager` 先檢查安裝模式與資料邊界，再預覽更新或移除範圍。更新必須保留 `.local/`、jobs、影音、字幕與播放進度；移除產生資料前必須另行取得使用者確認。

移除 Codex plugin：

```bash
codex plugin remove insu-player@insu-player
codex plugin marketplace remove insu-player
```

## 為什麼叫 INSU

INSU 取自臺灣紫嘯鶇學名 `Myophonus insularis` 的種小名。這種只分布於臺灣溪谷的特有鳥類，藍紫色金屬光澤也成為產品的代表色。物種資料可參考[臺灣國家公園主題網](https://www.taiwan.nps.gov.tw/home/zh-tw/eco-gallery/21399.html)與[林業保育署物種介紹](https://taichung.forest.gov.tw/0000253)。

只下載或處理你有權使用的媒體。
