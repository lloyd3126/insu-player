# INSU Player

> 用 Agent，讓影音跨越語言。

INSU Player 是為 Codex Agent 設計的本機影音與字幕工作台。把你有權處理的單支影音網址交給 `$watch-video`，Agent 會開啟目前專案的首頁，再協調下載、轉錄、翻譯、字幕重排與播放。長時間下載或轉錄可由附著目前 task 的 heartbeat 稍後接續。

產品以一個固定的 React 首頁為中心，導覽依序保留開始說明、我的提示、轉錄設定、支援網站、擴充功能與影片中心，而且只顯示文字。播放器、詳情、字幕對照和處理進度都在同一頁內開啟，不會為每支影音另建一個首頁，也不保留舊版首頁或資產 fallback。React Router 只負責把目前開啟的 modal、影音與 tab 寫進網址，因此重新整理後會回到同一畫面。

## 安裝 Codex plugin

```bash
codex plugin marketplace add https://github.com/lloyd3126/insu-player.git
codex plugin add insu-player@insu-player
```

安裝後重新開啟 Codex task，在要建立影音庫的專案中開啟 INSU Player plugin，選擇「試用」。

如果找不到「試用」，請直接輸入：

```text
使用 $watch-video 初始化 INSU Player。先開啟專案首頁，再安裝所有依賴、雲端 STT SDK、SQLite 與 Whisper medium。完成後停在首頁，請我打開「開始說明 → 加入影音」並貼上網址，不要直接詢問網址或技術選項。
```

每個專案都有自己的 `.local/insu-player/` workspace。Plugin 不會因為同一台電腦上有其他 INSU Player 服務，就改用別的專案資料。

## 實際工作流程

Agent 處理一支影音時會：

1. 解析目前專案的 workspace，啟動或沿用它自己的服務。
2. 先用 Codex 內建瀏覽器開啟首頁，讓後續進度持續可見。
3. 確認使用者有權下載與處理該媒體。
4. 用一般語言詢問要整理影片原本語言的字幕，還是翻譯成另一種語言。來源語言預設由語音辨識自動判斷，翻譯時只需要回答想要的語言名稱。
5. Agent 唯讀檢查「轉錄設定」目前選用的模型與就緒狀態。第一次安裝會自動選用已驗證的 Whisper medium，使用者不需要在對話中回答 skill、模型 ID、provider、processor、語言碼或字幕產物類型。之後若想更換，可直接在同一個模型表格確定性操作。內部仍會完整記錄語音時間、內容處理與字幕切分所用能力。
6. 工作超出目前 turn 時，由 `$monitor-player-job` 定期回到同一個 task，依 SQLite 中的 operation 與 event 接續已授權階段。
7. 完成後在影片中心開啟播放，後續可從原進度續播。

### 字幕來源決定

| 來源 | 處理方式 |
| --- | --- |
| 創作者人工 CC | 可立即播放，也可作為拼字與術語參考，但 cue 邊界不能當作細粒度 timing |
| 平台自動字幕 | 一律不下載、不匯入，也不作為模型參考 |
| 模型轉錄 | 從原始音訊產生來源語言的 word、token 或 grapheme-group timing，校正、翻譯與切分都必須使用 |

### 校正 翻譯與字幕切分

字幕製作不是逐 cue 置換文字。完整流程會：

1. 以模型產生的來源詞級或 Token 時間軸重建完整句子。
2. 不翻譯時由 `$proofread-subtitles` 完成同語言校正。翻譯時由 `$translate-subtitles` 完成目標語初譯與完整句潤色。
3. 由獨立的 `$segment-subtitles` 先依定稿輸出語言切分並 freeze，翻譯路徑即採 target-first，再對齊來源 timed units。
4. 依語言與輸出 profile 處理寬度、標點、閱讀節奏、required terms 與 bilingual anchors。
5. 通過 paired timing 與 deterministic validation 後，依來源／目標語言碼成對匯入字幕軌。

### 資料處理方式

- 預設設定：第一次安裝並驗證完成後，轉錄設定會選用本機 Whisper medium。每個新工作只讀取開始當下的介面選擇並固定使用，再由目前的 Agent 讀取轉錄文字，完成校正或翻譯與字幕切分。影音播放畫質不會為了加快語音辨識而降低。
- 全部留在本機：Agent 會先確認目前 workspace 的本機文字模型真的能完成所需語言的校正、翻譯與切分，不會把 Whisper 誤當翻譯模型。
- 使用雲端 STT：支援 OpenAI、Groq、ElevenLabs、xAI 與 OpenRouter，只用於音訊轉錄。使用者先在「轉錄設定」選用確切模型，並從該模型詳情設定 provider 對應的 API Key。同一 provider 的模型共用一份 Key。模型選用、API Key 與本次音訊上傳同意彼此獨立，每一次上傳前仍會說明服務名稱、音訊上傳、可能費用與本機替代方案並取得明確同意。選定服務後不會自動 fallback。完整句重建、校正、翻譯、切分與 Source Alignment 由目前 Agent 完成。

## 首頁功能

| 入口 | 內容 |
| --- | --- |
| 開始說明 | 以「初始化」、「下一步」、「加入影音」與「操作流程」四個 tabs 分開呈現，每個 tab 只放一個主要段落 |
| 初始化 | 顯示初始化工作卡與 workspace 能力檢查，引導初次使用者完成本機環境 |
| 加入一支影音 | 貼上單支影音網址，確認格式正確後複製已帶入網址的完整提示 |
| 我的提示 | 複製常用的處理、雙語字幕與中斷復原提示，顯示由 Agent 維護的 workspace 提示，也可複製建立提示 |
| 支援網站 | 依目前 workspace 內 yt-dlp 的 extractor 顯示實際支援來源，並提供詢問 Agent 是否支援的整合提示 |
| 轉錄設定 | 以單一表格列出本機與雲端語音辨識模型，可查看就緒狀態、選用模型與開啟詳情 |
| 模型詳情 | 本機模型可下載、取消、驗證與移除。雲端模型可設定或清除該 provider 共用的 API Key。選擇只套用到之後的新工作，停止服務會清除 Key |
| 影片中心 | 以頂部 tabs 切換「我的影音」與「詳細資訊」 |
| 加入影音 | 從首頁直接逐行加入最多 50 個單支影音網址，在介面建立下載佇列並取得不超過 1080p 的最高相容 MP4。下載完成後再複製提示，請 Agent 接續字幕流程 |
| 我的影音 | 只顯示全寬搜尋列與影音卡片。有影音時預設開啟，網格最多三欄 |
| 詳細資訊 | 顯示摘要統計、狀態篩選與固定欄寬列表。空庫時預設開啟 |
| 擴充功能 | 首頁 navbar 的獨立 modal，標題為「Chrome 擴充功能」，以「安裝」、「連接」與「使用」三個 tabs 說明未封裝載入、目前 workspace 配對及從目前分頁加入影音 |

### Chrome 擴充功能

未封裝 Extension 位於 `plugins/insu-player/chrome-extension/`，不需建置或上架商店。使用者從首頁 navbar 開啟「擴充功能」，依序使用「安裝」、「連接」與「使用」三個 tabs。配對綁定目前 workspace 的 token 與實際 localhost origin，不掃描或猜測其他 port。

一般操作只讀取目前分頁並送入現有下載佇列。使用者可以選擇頁面、embed、直接 MP4 或已結束的 M3U8。iframe 與網路串流偵測需要暫時網站權限，下載需要登入狀態時會再開啟明確同意視窗。只會收集目前頁面、frame 與媒體 host 需要的 Cookie，傳到本機服務的短期工作階段，寫成權限 `0600` 的暫存 cookie jar。Cookie 值不會寫入 `app.db`、operation、log 或 API 回覆，下載程序結束或服務重啟時就會刪除。

擴充功能不繞過 DRM、付費牆、會員、私人存取、地區限制或帳號控制。第一版只接受已結束的 HLS，拒絕直播、SAMPLE-AES、CENC、EME、Widevine、FairPlay、PlayReady 與無法還原實際網路來源的 blob。Chrome 專用 `/extension/library` 頁面只顯示搜尋、影音卡片、觀看與字幕選擇，不顯示 Agent 提示或轉錄設定。

「詳細資訊」的列表會顯示影音、字幕語言碼與操作。每筆影音的詳情依序分為「關於影音」、「畫質管理」、「字幕管理」、「影音摘要」、「影音筆記」與「執行紀錄」六個 tabs：

- 「關於影音」顯示目前狀態、來源、時長、容量、影音 ID、建立、更新、完成時間與狀態歷程，頁面本身固定，只有狀態歷程表格獨立捲動。
- 「畫質管理」顯示來源可下載畫質、已下載 rendition、目前播放畫質、可用空間及下載進度。使用者明確點選哪個高度，就只下載並驗證該高度。不會自動降級，也不會在下載完成後擅自切換目前播放畫質。
- 「字幕管理」最上方固定顯示一張製作提示卡，讓使用者把固定提示交給 Agent。其下是每個語言的目前播放版本選單，再以內層 tabs 管理「原始字幕」、「校正字幕」、「翻譯字幕」與「切分字幕」。只有字幕表格捲動，提示、播放版本、tabs、revision 與工具列保持固定。
- 「原始字幕」只包含創作者人工 CC，或本機與支援的雲端 STT 從音訊產生的原始語言字幕。「校正字幕」顯示同語言完整句校正。「翻譯字幕」顯示跨語言完整翻譯。「切分字幕」顯示 output-first／target-first 切分與 Source Alignment 結果。
- 製作、校正、翻譯、切分及重試都透過提示交給 Agent。介面中只有切換目前播放版本與刪除 revision 是使用者可直接執行的傳統操作。
- 「影音摘要」採上下流程。先由 `$summarize-video` 從指定的有效完整句校正或翻譯字幕建立版本化文字摘要，再由 `$map-video-summary` 從指定文字摘要建立版本化 Markmap。介面可切換 revision、刪除未被依賴的版本，並縮放、收合、符合畫面或匯出 SVG。兩個步驟各自使用提示卡，Agent 不會把摘要或心智圖工作塞進字幕 skill。
- 「影音筆記」可直接新增、編輯、刪除筆記，並可連結播放時間與標籤。點擊時間會回到同支影音的精確位置。
- 「執行紀錄」提供可交給 Agent 的檢查提示與全寬 log 內容。

「關於影音」底部另有移除按鈕，點擊後會開啟共用的直接刪除確認 Modal。Modal 開啟時由同源 API 執行唯讀預覽，沒有 blocker 才會啟用刪除。確認後後端會以該次預覽的 plan digest 執行並驗證，完成後清除前端快取並返回影片中心。非 active 的本地畫質、字幕 revision、文字摘要與心智圖也共用相同協議。active 畫質必須先切換才可移除，仍被心智圖依賴的文字摘要必須先移除相關心智圖。所有操作都使用穩定 ID，不需要複製提示或請 Agent 協助。

畫質、字幕 catalog、所選字幕版本內容與 log 只在第一次切到對應分頁時載入，開啟「關於影音」不會先抓取這些資料。字幕內層分頁與 revision 會映射到 `/jobs/<video-id>/subtitles/<source|proofread|translation|segmentation>?artifact=<artifact-id>`，因此重新整理後仍保留目前畫面。

播放器以每個語言獨立解析版本，預設順序是「有效切分字幕 > 有效完整句校正或翻譯 > 人工 CC > 模型原始字幕」。使用者在字幕管理中明確選擇的有效版本會持續保留。處理中、invalid 或 stale 的新版不會蓋掉既有可播版本。

影音摘要與關於頁使用簡明的處理狀態，例如「準備辨識語音」、「正在整理字幕內容」、「正在重新切分字幕」、「正在同步字幕時間」與「正在檢查字幕」。每個詳情頁會依目前狀態顯示一張下一步卡片。處理中只提示等待，工作中斷時提供精確續跑提示，完整句完成但尚未切分時只接續切分，全部驗證完成後明確顯示完成。

## 十個產品 skills

| Skill | 用途 |
| --- | --- |
| `$watch-video` | 主要入口：開啟首頁，新增影音，並協調字幕、轉錄與翻譯 |
| `$monitor-player-job` | 以目前 task 的 heartbeat 監控長時間下載、轉錄、畫質與字幕工作，完成或需決策時停止 |
| `$video-library` | 啟動、檢查、修復、安全整理影音庫，或依 preview／confirm／execute／verify 協議移除單一資源 |
| `$transcribe-media` | 將本機音訊或影音轉成正規化 JSON、純文字與 WebVTT |
| `$proofread-subtitles` | 在來源語言內校正 ASR、術語與完整句，不負責翻譯或顯示切分 |
| `$translate-subtitles` | 以詞級或 Token 時間重建完整句子，產生任意模型支援語言組合的完整自然譯文 |
| `$segment-subtitles` | 先依目標語自然切分，再將 frozen pieces 對齊連續來源時間並輸出同步字幕 |
| `$summarize-video` | 從一個已驗證的完整句字幕版本建立不可覆寫、可追溯的文字摘要 revision |
| `$map-video-summary` | 從一個指定文字摘要 revision 建立安全、可驗證的 Markmap 心智圖 |
| `$player-manager` | 檢查安裝狀態、安全更新或完整移除 INSU Player |

`plugins/insu-player/skills/` 是業務規則的唯一來源。repository 內的 `.agents/skills/` 只負責將 Codex 導向對應的 canonical skill。

## Workspace 與安全邊界

- 影音庫身分由專案內的 workspace 路徑決定，不由 port 或同機其他服務決定。
- 服務優先使用 `127.0.0.1:8000`。若 port 已被占用，作業系統會分配可用 port，並將實際 `host`、`port` 與 `pid` 記錄在 `.local/insu-player/.insu-player-server.json`。
- uv、Python、Bun、FFmpeg、yt-dlp、Whisper、模型與 workflow cache 都保留在 workspace。不使用 `sudo`、Homebrew、apt、全域 pip 或全域 npm。
- 首頁服務啟動時會清除從 Codex、terminal profile 或 parent process 繼承的 `OPENAI_API_KEY`、`GROQ_API_KEY`、`ELEVENLABS_API_KEY`、`XAI_API_KEY` 與 `OPENROUTER_API_KEY`。需要雲端轉錄時，使用者必須在「轉錄設定」開啟對應模型詳情，為本次服務重新設定 provider Key。Key 不會寫入 `.env`、`app.db`、log、job metadata 或 API 回應。直接執行轉錄工具時仍可從該命令的 process environment 取得 Key。
- 服務只綁定 localhost，不對 LAN 或 Internet 開放。
- INSU Player 不繞過 DRM、付費牆、會員、私人存取、地區限制或帳號控制。
- Chrome Extension 的必要權限只用於目前分頁與 localhost。iframe、網路串流與 Cookie 使用額外權限，成功加入後會回收。Extension 配對、短期媒體工作階段與 cookie jar 都會在完整重建時清除。
- 清理預設只移除可重建中間檔，保留影音、字幕、狀態、log 與播放進度。

### 需要重新開始時重置影音庫

如果目前沒有需要保留的影音，或想用全新的資料驗證流程，可以請 Agent 完整重建目前專案的 INSU Player。這會清空影音、字幕、本次服務 API Key、工作紀錄、Chrome Extension 配對與 SQLite 資料庫，並移除短期 Cookie 工作階段與舊的相容資料，但會保留程式碼、workspace-local Bun、Whisper 與已下載模型：

```text
完整重建目前專案的 INSU Player。清空影音、字幕、API Key、工作紀錄與資料庫，移除所有相容層。保留程式碼、Bun runtime、Whisper 與模型。請先產生唯讀預覽和 digest，等我確認後執行，最後重啟首頁並驗證影音庫為 0 筆。
```

重置是破壞性操作。Agent 必須先確認目前專案與 workspace，列出清除範圍、容量、資料庫與可保留項目，產生本次 plan digest，不能直接刪除。看到預覽後，只有在你回覆以下文字時才會執行：

```text
確認重建 PREVIEW_DIGEST
```

完成後 Agent 會停止舊服務、清除已確認的 workspace 資料、以目前 schema 建立空白 `app.db`、重新啟動首頁，並驗證影音庫與相關資料表為空。為了避免誤刪其他專案，提示中不需要自行填寫路徑，也不要提供任意檔案路徑給 Agent。

如果只想移除影音與字幕、保留資料庫結構和設定，請改用：

```text
只清空目前影音和字幕，保留資料庫結構與設定。請先列出唯讀預覽和 plan digest，等我確認後執行並驗證。
```

## 應用程式架構

| 層級 | 技術 | 職責 |
| --- | --- | --- |
| 前端 | React、React Router、Vite、shadcn/ui、Lucide、Markmap | 固定首頁、可重新整理的 modal/tab 路由、下載佇列、模型管理、摘要心智圖、字幕對照與同源播放器 |
| API | Hono on Bun | localhost JSON API、Extension 配對與短期媒體工作階段、批次最高相容畫質下載、統一模型目錄、provider session credential、模型下載與驗證、摘要 revision、exact-height rendition、媒體 Range request、WebVTT 與播放進度 |
| 查詢投影 | Drizzle、Bun SQLite | 以目前唯一 schema 保存下載批次、Extension 配對 metadata、模型選擇、摘要依賴並投影工作流程。Cookie 值不入庫，舊 schema 不遷移、不讀取，也沒有相容層 |
| 工作流程 | SQLite `operations`、`operation_events` | 作為中斷復原與進度的唯一事實來源 |
| 執行環境 | project-local workspace | 保存 runtime、媒體、字幕、模型、cache 與播放進度 |

## 專案結構

```text
insu-player/
├── .agents/skills/                 # repository discovery bridge
├── plugins/insu-player/            # Codex plugin 與 canonical skills
│   └── chrome-extension/            # 直接由 Chrome 載入的未封裝 Extension
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

程式修改完成後，還需通過所有 skill validator 與 plugin validator。介面圖示統一使用 [Lucide](https://lucide.dev/)，執行時不載入圖示 CDN。

長時間工作追蹤使用 ChatGPT／Codex 桌面版的 Scheduled tasks，並固定附著於目前 task、使用目前專案的 local checkout。它不會在 Hono 或 SQLite 中建立另一套 scheduler。需要本機影音、模型或 workspace 時，Mac 必須保持開機且 ChatGPT 桌面程式持續運作。沒有 Scheduled tasks 能力的環境會明確回報不支援，不提供舊式輪詢 fallback。

## 更新與移除

請交給 `$player-manager` 先檢查安裝模式與資料邊界，再預覽更新或移除範圍。更新必須保留 `.local/`、jobs、影音、字幕與播放進度。移除產生資料前必須另行取得使用者確認。

移除 Codex plugin：

```bash
codex plugin remove insu-player@insu-player
codex plugin marketplace remove insu-player
```

## 為什麼叫 INSU

INSU 取自臺灣紫嘯鶇學名 `Myophonus insularis` 的種小名。這種只分布於臺灣溪谷的特有鳥類，藍紫色金屬光澤也成為產品的代表色。物種資料可參考[臺灣國家公園主題網](https://www.taiwan.nps.gov.tw/home/zh-tw/eco-gallery/21399.html)與[林業保育署物種介紹](https://taichung.forest.gov.tw/0000253)。

只下載或處理你有權使用的媒體。
