# yt-dlp 來源影音庫、多語轉錄、翻譯與字幕切分

## 最終體驗

這個 skill 把 yt-dlp 目前版本可辨識的單支線上影片收進一個持續使用的本機影片庫。YouTube 是首頁與文件的預設範例，不是唯一支援來源。日常入口不是每支影片各自的 HTML，而是目前 workspace 的固定首頁。服務優先使用：

```text
http://127.0.0.1:8000/
```

首頁是全高入口頁，navbar 只保留「使用說明」、「功能設定」與「影音中心」。「使用說明」以 tabs 切換開始使用、我的提示與支援網站；內建使用情境提示位於「我的提示」建立卡下方。「功能設定」以 tabs 切換環境變數、本機模型與雲端模型；三個分頁都在上方提供對應的 Agent 提示卡，Tab panel 固定不捲動，只有下方表格捲動。環境變數表格顯示白名單變數、設定狀態、遮蔽的新值輸入與操作，不顯示 SDK 狀態；本機模型顯示 workspace 實際下載的 Whisper 模型與大小，雲端模型顯示 API SDK 安裝狀態與 API Key 選單。「影音中心」在頂部以「我的影音」與「詳細資訊」tabs 切換。有影音時預設開啟「我的影音」，只顯示全寬搜尋列與最多三欄的縮圖標題卡片；沒有影音時預設開啟「詳細資訊」。單筆詳情依序提供關於影音、畫質管理、字幕管理、影音摘要、影音筆記與執行紀錄。「畫質管理」列出來源可下載畫質、本地已下載畫質、目前播放畫質與背景下載進度。「字幕管理」再以內層 tabs 切換原始字幕、翻譯字幕與切分字幕，共用來源→翻譯→切分版本譜系、revision 選單、驗證狀態與多語並排表格；只有表格捲動。字幕內層分頁與 revision 都寫入 localhost URL，重新整理後保留目前畫面。播放器畫質選單只顯示已下載畫質，字幕選單只顯示語言碼。從卡片或列表按「觀看」會再疊開同頁 iframe modal，關閉後回到影音中心，背景任務與狀態輪詢不會中斷。

首頁仍是單一 React 應用程式，但使用 React Router 將使用說明、功能設定、影音中心、影音詳情、播放器及其 tab 狀態映射到 localhost URL。重新整理或直接開啟該 URL 必須恢復同一個 modal 與 tab；Hono/Bun 服務要對這些 allowlist 前端路徑回傳同一份 React `index.html`。

支援網站在搜尋列上方提供單一「詢問 Agent 是否支援」提示卡；提示會先檢查目前解析器，必要時安全更新 workspace 內的 yt-dlp，仍不支援才研究平台。

首頁除了保存播放位置、字幕語言偏好與經過預覽確認的影音／字幕刪除外，仍是讀取為主的控制台。新增、重試、翻譯、取消與清理由 Agent 或明確的腳本命令執行。

`8000` 只是優先嘗試的 port，不代表這台電腦只能有一個 INSU Player。若已被占用，服務會讓作業系統分配可用 port，並把實際 endpoint 記錄在 workspace 的 `.insu-player-server.json`。不同專案可以同時使用不同 workspace 與 port。

## 目的與成功條件

輸入：

- 目前 workflow-local yt-dlp 有對應 extractor 的單支影片 URL
- 專用 workspace 路徑
- 在取得字幕前確認是否需要翻譯；需要時確認原始語言、目標字幕語言與可接受的機器翻譯範圍

輸出：

- 至少一個通過驗證且設為 active 的瀏覽器相容 MP4 rendition
- 可用的原文與任意模型支援目標語言 VTT
- 可中斷恢復的 `status.json` 與 workflow log
- 同源、本機限定、支援影片 Range request 的影片庫首頁

完成標準：影片能從 navbar 的影音中心開啟播放，字幕可切換且時間同步；若尚待轉錄或翻譯，列表要正確顯示待辦，而不是假裝完成。

## 不處理的範圍

- 不繞過 DRM、付費、會員、私人、地區或帳號限制。
- 不把影片、字幕、cookie、模型、venv 或快取 commit 到 repository。
- 不保證來源平台一定提供字幕或自動翻譯。
- 找不到 extractor 時，Agent 應使用 INSU Player 研究來源、公開介面與媒體格式，研究不等於繞過存取控制。
- 不把 Whisper 的英語 translation task 當成任意目標語言翻譯；完整目標語翻譯由明確選定並記錄的本機或 API 語言模型完成。
- 不讀取登入 cookie，除非使用者明確要求並理解授權範圍。cookie 不得貼入聊天或寫進 repository。
- 不把本機服務公開到 LAN 或 Internet。

## 支援環境與資源預估

腳本支援 macOS、Linux 與 Windows WSL。原生 Windows 可依同一架構手動安裝，但這一版沒有 PowerShell 腳本。

建議預留至少 10 GB 加影片大小。預設下載 `medium`。資源較少時可改用 `small`，需要其他速度與準確度取捨時可明確指定不同模型。純 CPU 轉錄長片可能接近或超過影片時長。

## 架構與資料契約

```text
<workspace>/
├── .insu-player-server.json       # 服務運作期間的實際 localhost host、port 與 pid，停止後移除
├── .insu-environment-session.json # 服務運作期間的 localhost capability，不含 API key，停止後移除
├── .agent-tools/insu-player/     # uv、Python、venv、FFmpeg、yt-dlp、Deno、選用 provider、模型與全部已知快取
├── prompts.json                    # Agent 維護、首頁唯讀的「我的提示」
└── jobs/
    └── <video-id>/
        ├── status.json                     # 唯一任務狀態來源，atomic write
        ├── manifest.txt
        ├── media-info.txt                  # 初次下載的媒體檢查紀錄
        ├── media-work/
        │   ├── catalog.json                # 可用來源畫質、全部 rendition、active rendition 與 operation
        │   └── runs/<run-id>/              # selection、attempts、media-info 與 workflow log
        ├── ui-state.json                   # 首頁播放進度，atomic write
        ├── source/
        │   ├── renditions/<rendition-id>.mp4 # 通過驗證、不可被任意路徑指向的本地畫質
        │   ├── audio.m4a                   # 需要轉錄時才保留
        │   └── thumbnail.jpg
        ├── subtitle-work/
        │   ├── bilingual-sentences.json    # 完整句來源與自然目標語翻譯
        │   ├── segmentation-plan.json      # frozen target pieces 與來源 timed-unit spans
        │   └── artifacts/
        │       └── <artifact-id>/          # 不可變的來源／翻譯／切分 revision
        │           ├── <language>.vtt
        │           └── manifest.json       # 翻譯與切分 revision 必須有 manifest
        ├── youtube-captions/               # 只有不翻譯時可保存來源播放 VTT
        ├── whisper/                        # 本機或 API 的 transcript.json、文字與播放 VTT
        └── logs/workflow.log
```

`status.json` 記錄標題、來源、目前 state/stage、0–100 進度、程序 PID、錯誤、產物、最多 120 筆歷程，以及 revisioned `subtitleArtifacts`、親子依賴、tracks 與選用的 `activeSubtitleTracks`。寫入採暫存檔加 atomic replace，避免首頁在更新中讀到半份 JSON。`app.db` 只做可重建的查詢投影。

「我的提示」分頁先顯示建立提示卡，再顯示內建情境與可直接複製的提示，最後列出 Agent 維護的 workspace 提示。建立卡右上角可複製提示交給 Agent 共同整理。Agent 依 [prompt-library.md](prompt-library.md) 使用專用腳本新增或修改，首頁只提供 `GET /api/prompts`，不允許使用者在瀏覽器直接編輯 workspace。「環境變數」分頁以安全提示卡與表格管理程式白名單中的變數，目前為 `OPENAI_API_KEY`。值只存在本機服務程序，公開 API 只回傳是否已設定，停止服務後即消失；SDK 安裝狀態只在雲端模型分頁呈現。

## Workspace 與服務邊界

- Plugin 安裝只共用 skill 程式碼，不會建立全機共用的影片庫。每個專案的 runtime、jobs、字幕與播放進度都留在該專案選定的 workspace。
- Portable 模式使用該 repository 的 `.local/insu-player/`。Developer checkout 或 installed plugin 優先使用者明確指定的 project-local workspace；未指定時才使用 `<目前專案根目錄>/.local/insu-player/`。
- 在執行 doctor、setup、serve 或 process 前先解析一次 workspace 的絕對路徑，回報給使用者，後續每一步固定使用同一路徑。
- 不搜尋目前專案之外的 INSU workspace，也不因另一個 workspace 已完成安裝、有影片或正在背景執行而改用它。只有使用者明確指定時才能跨越專案邊界。
- 只有選定 workspace 內的 `.insu-player-server.pid`、`.insu-player-server.json` 與 live process 能證明服務屬於該 workspace。單看 localhost port、程序名稱或其他專案的 PID 不足以沿用服務。
- Port 衝突不會改變 workspace 身分。一般啟動不指定 port；服務先嘗試 `8000`，若已被占用就原子性地綁定作業系統分配的可用 localhost port，把實際 endpoint 寫入 `.insu-player-server.json`，並回報實際首頁網址。只有使用者明確要求特定 port 時才嚴格使用該 port。
- Workspace 解析完成後，第一個使用者可見動作是啟動或沿用該 workspace 的服務，並用 Codex 內建瀏覽器開啟實際首頁。不要等 doctor、安裝、下載或字幕處理完成才開啟，也不要只把 URL 印在回覆中。

主要狀態：

| 狀態 | 意義 | 下一步 |
| --- | --- | --- |
| `checking` / `downloading` | 正在檢查字幕或下載媒體 | 等待或查看 log |
| `needs_transcription` | 沒有可用文字軌 | 執行 `transcribe.sh` |
| `transcribing` | 選定 provider 轉錄中 | 等待；可在中斷後重跑 |
| `needs_translation` | 有來源 timed units，沒有完整目標語翻譯 | 選定模型完成初譯與完整句潤色 |
| `translating` | 正在翻譯或建立新字幕 revision | 匯入完整句翻譯後即可播放；切分可後續升級 |
| `ready` | 影片與所需字幕可觀看 | 首頁觀看或清理中間檔 |
| `interrupted` | active state 的程序已消失 | Agent 檢查產物後從該階段續跑 |
| `failed` | 命令失敗 | 查看 detail/log，再做針對性修復 |

影片存在時，即使仍待轉錄或翻譯也可以先觀看。`ready` 是完整工作完成，不是播放的唯一條件。

## 使用優先序

1. 使用者本次明確指示。
2. 安全、權利與外部狀態限制。
3. 本 INSU 工作流程的自動流程。
4. 失敗時才改走更低階的手動命令。

先使用 `process-video.sh`，再依狀態處理翻譯。不要一開始就拆成十幾個手動命令，也不要為每支影片複製一套播放器。

## 階段 0：取得 skills

建議從 GitHub Release 下載 `insu-player-vX.Y.Z-portable.zip` 與 checksum。解壓縮後用 Agent 開啟整個資料夾並從根目錄 `START-HERE.md` 開始；不需要安裝 Git。已有 Git 且要參與維護時才使用 `git clone`。

Agent 先讀根目錄 `AGENTS.md` 與本文件。

## 階段 1：先開啟目前 Workspace 的首頁

解析並回報本次選定的 workspace 絕對路徑後，立即啟動首頁：

```bash
plugins/insu-player/skills/watch-video/scripts/serve-library.sh \
  .local/insu-player
```

讓 `serve-library.sh` 在獨立 terminal／執行 session 持續運作，讀取它回報並寫入 `.insu-player-server.json` 的實際網址，再用 Codex 內建瀏覽器開啟該網址，而不是只在訊息中提供網址。這是第一個使用者可見的產品動作；首頁保持開啟，後續 doctor、安裝與 job 狀態會在同一頁逐步更新。

若 `8000` 已由另一個 workspace 占用，不要改用、檢查或停止該服務；這次啟動會自動取得其他可用 port，記錄後再用內建瀏覽器開啟實際網址，不需要猜測 `8010` 或逐一試 port。`serve-library.sh` 在 workflow runtime 尚未安裝時可先使用系統 Python 3 顯示空白首頁。若系統沒有 Python 3，先明確回報這個例外阻塞，再執行 workspace 內的安裝流程，workflow Python 一可用就立刻開啟首頁。

Server 僅綁定 `127.0.0.1`，並且只暴露 allowlist 路由：首頁資產、job JSON、唯讀提示 JSON、模型安裝摘要 JSON、環境變數遮罩狀態與同源工作階段寫入、log 尾端、標準化 MP4、縮圖、VTT、player，以及只寫 `ui-state.json` 的播放進度端點。模型摘要只包含名稱、實際大小、provider 狀態與 API Key 是否已設定，不包含 Key、路徑或檔案內容。環境變數的原值不會從公開端點讀回，Agent 的轉錄子程序只能透過服務啟動時建立的短期 capability 取得，而且仍須先有本次 API 上傳同意。它不提供任意目錄瀏覽，也不會公開 `.agent-tools` 或模型。

影片 endpoint 支援 HTTP Range，拖曳時不需重新傳送整支影片。播放器與首頁同源，因此 iframe 能安全交換 ready、播放時間、暫停與接續播放訊息。

關閉 server：回到 terminal 按 `Ctrl+C`。它是前景程序，不安裝背景 daemon 或開機自動啟動。

## 階段 2：確認權利與需求

下載前確認：

1. URL 與是否只處理單支影片；腳本固定 `--no-playlist`。
2. 使用者已接受首頁集中顯示的使用規範；來源平台條款與所在地規範仍可能適用。
3. 在任何字幕檢查或下載前，先問要「同語言校正」或「翻譯」，並確認來源 BCP 47 語言；翻譯時再確認輸出 BCP 47 語言。
4. 分別確認 timing、內容與切分 processor。Timing 只能選本機或 OpenAI API 模型；內容與切分各自可選本機模型、OpenAI API 模型或目前的 Agent。本機需下載大型依賴與模型；OpenAI 會上傳音訊或文字並可能產生費用，每一次 API 上傳都要先取得明確同意。
5. workspace 是否可能包含敏感內容。

字幕來源只接受創作者人工 CC 與模型轉錄。人工 CC 可在兩條路徑中下載、立即播放，並作為拼字與術語參考；平台自動字幕一律不得下載、匯入或參考。無論有沒有人工 CC，只要要校正、翻譯或切分，都必須由選定模型從原始音訊建立來源語言的 word、token 或 grapheme-group timing。

## 階段 3：從零盤點環境

```bash
plugins/insu-player/skills/watch-video/scripts/doctor.sh .local/insu-player
```

`doctor.sh` 唯讀，不安裝或刪除。Agent 要用白話說明 OS／CPU、磁碟、`curl`、`unzip`、workflow-local FFmpeg、runtime、模型和既有 jobs。系統 Python、FFmpeg、yt-dlp、Deno 與 uv 只列為「偵測但不使用」。

若缺 `curl` 或 `unzip`，停止並說明；這版不會呼叫套件管理器或 `sudo`。Release 的支援環境預期已有作業系統基礎的 HTTPS 下載與 ZIP 解壓能力。

## 階段 4：隔離安裝

```bash
plugins/insu-player/skills/watch-video/scripts/setup-environment.sh \
  .local/insu-player \
  --provider local \
  --model medium
```

腳本只在 `<workspace>/.agent-tools/insu-player/` 安裝：

- uv 與 uv 管理的 Python 3.11
- 專用 `.venv`
- 核心 `yt-dlp[default]`、`imageio-ffmpeg`，以及所選 provider 的 `openai-whisper` 或 OpenAI SDK
- 從平台 wheel 複製到 workflow `bin/` 的 FFmpeg
- 本機 provider 才需要的 Whisper 模型
- workflow-local Deno

Deno 不是拿來開網頁伺服器；它提供部分 yt-dlp extractors 所需的 JavaScript runtime。影片庫伺服器固定使用 workspace 內的 Bun 執行 Hono，資料投影由 Drizzle 與 Bun SQLite 管理。

腳本不修改 shell profile、不取代系統 Python、不把工具加入全域 `PATH`，也不使用 Homebrew、APT、DNF 或 Pacman。執行時把 `HOME`、`TMPDIR`、`UV_*`、完整 XDG config/data/state/cache、`TORCH_HOME`、`TIKTOKEN_CACHE_DIR`、`HF_HOME`、Python bytecode、Deno 與 yt-dlp cache 全部改到 runtime；yt-dlp 加上 `--ignore-config`，不讀使用者全域設定。低資源環境可用 `--model small`；API-only 使用 `--provider openai`，不會安裝 Whisper 或下載模型。

安裝後再次執行 doctor，必須看到 `status: ready`。

## 階段 5：處理一支新影片

日常預設使用單一入口：

```bash
plugins/insu-player/skills/watch-video/scripts/process-video.sh \
  .local/insu-player \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  --translate zh-TW \
  --provider local \
  --model medium \
  --language en
```

流程會：

1. 解析影片 ID 與標題並建立／續用 job。
2. 只檢查並匯入創作者人工 CC；明確排除平台自動字幕。
3. 下載瀏覽器相容 MP4 與縮圖。
4. 固定準備音訊，並用使用者選定的 provider 建立細粒度來源時間軸；人工 CC 只作文字參考。
5. 即時更新狀態、進度、PID 與 log。
6. 翻譯路徑停在 `needs_translation`，校正路徑停在 `needs_proofreading`。完整句 revision 驗證後即可播放，再由 `$segment-subtitles` 建立獨立的切分 revision。

影片畫質採獨立的播放品質契約：預設先選擇不超過 1080p 的最高瀏覽器相容 MP4。每個候選畫質在下載前都重新解析串流 URL 並做小段 HTTP Range probe；一次 403 不能判定該畫質不可用，同一畫質必須以新 URL 再驗證一次。只有兩次都失敗才往下一個實際存在的畫質嘗試。720p 以上可以自動降級並完整記錄；低於 720p 時停止，要求使用者明確同意後才可加入 `--allow-low-quality`。轉錄固定使用另外準備的音訊，影片畫質不參與 Whisper 速度判斷。

來源畫質、已下載 rendition、目前播放 rendition 及執行狀態寫入 `<job>/media-work/catalog.json`；每次執行的 HTTP 狀態、下載結果、選定 format ID、實際寬高、codec 與驗證結果寫入 `<job>/media-work/runs/<run-id>/`。下載後以 workflow-local FFmpeg 重新讀取實際解析度；與指定畫質不一致或無法確認解析度時，不得發布到 `source/renditions/`。初次下載仍使用 720p 自動選擇下限；使用者從「畫質管理」明確點選的畫質則是 exact-height 操作，不套用自動降級，也不自動切換 active rendition。

重新取得來源清單或下載指定畫質：

```bash
plugins/insu-player/skills/watch-video/scripts/manage-rendition.sh \
  .local/insu-player VIDEO_ID discover

plugins/insu-player/skills/watch-video/scripts/manage-rendition.sh \
  .local/insu-player VIDEO_ID download 1080
```

同語言校正：

```bash
plugins/insu-player/skills/watch-video/scripts/process-video.sh \
  .local/insu-player \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  --language en \
  --proofread \
  --provider local \
  --model medium
```

如果只想先下載、稍後再轉錄：

```bash
plugins/insu-player/skills/watch-video/scripts/process-video.sh \
  .local/insu-player \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  --language en \
  --translate zh-TW \
  --provider local \
  --no-transcribe
```

低於 720p 仍需使用者明確同意後加入 `--allow-low-quality`。

重新執行會沿用固定 job，不建立重複首頁或覆蓋其他影片。yt-dlp 使用 `--no-overwrites`；若檔案損壞，Agent 先確認精確目標再移除並重跑。

## 階段 6：只重跑指定階段

下載與字幕來源檢查：

```bash
plugins/insu-player/skills/watch-video/scripts/download-video.sh \
  .local/insu-player \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  --language en \
  --translate zh-TW
```

本機 Whisper 轉錄：

```bash
plugins/insu-player/skills/watch-video/scripts/transcribe.sh \
  .local/insu-player \
  VIDEO_ID \
  --mode translate \
  --provider local \
  --model medium \
  --language en \
  --output-language zh-TW \
  --device cpu
```

若 `audio.m4a` 不存在，腳本會從同一 job 的 active rendition 擷取，不必再下載一份媒體。Apple Silicon 或不確定 GPU 環境預設 CPU；確定 CUDA 可用才指定 `--device cuda`。

OpenAI API 轉錄必須先取得這次音訊上傳的明確同意，並只在目前 terminal 設定 key：

~~~bash
export OPENAI_API_KEY='set-in-current-terminal'
plugins/insu-player/skills/watch-video/scripts/transcribe.sh \
  .local/insu-player VIDEO_ID \
  --mode translate --provider openai --model whisper-1 \
  --language en --output-language zh-TW --allow-api-upload
~~~

API 音訊會先轉為低位元率分段，單檔低於 25 MB，再把 segment 與 word timestamps offset 回完整時間軸。Key 不寫入 job、log 或 metadata。

若首頁服務已啟動，也可以從 navbar 的「環境變數」輸入 `OPENAI_API_KEY`，再執行同一個 `transcribe.sh --allow-api-upload` 命令。腳本會讓 API 轉錄子程序繼承服務程序中的值，不會把值回傳給首頁、寫入 `.env`、命令列、job、log 或 metadata。停止或重新啟動服務後需要重新輸入。

## 階段 7：完整句內容與獨立字幕切分

`transcribe.sh` 以模型 timed units 建立 schema-version 4 content manifest，保存 `mode`、`sourceLanguage`、`outputLanguage`、`timingProcessor`、獨立的 `contentProcessor` 與人工 CC text references。來源可以是任意已確認 timing 模型支援的 BCP 47 語言；timed units 可以是 word、token 或 grapheme-group。

- `mode=proofread`：使用 `$proofread-subtitles`，來源與輸出語言相同，完成同語校正與潤色。
- `mode=translate`：使用 `$translate-subtitles`，先對完整句初譯，再完成自然目標語潤色。

兩者都把初稿寫入 `draftOutputText`、定稿寫入 `outputText`，保存 source timed-unit ranges、raw punctuation、專有名詞、數字、邏輯關係、required terms 與 processor metadata。不要在這一步依 cue 或字數切分。

完整句 pair 驗證後，用統一 importer 寫成 immutable `proofread` 或 `translation` artifact；它立即可供播放，不需要等待切分：

```bash
plugins/insu-player/skills/watch-video/scripts/import-subtitle-revision.sh \
  .local/insu-player VIDEO_ID INPUT.final.vtt OUTPUT.final.vtt \
  --source-language SOURCE_BCP47 \
  --output-language OUTPUT_BCP47 \
  --processor-provider agent --processor-service codex \
  --artifact-kind proofread_or_translation \
  --revision 1 \
  --manifest .local/insu-player/jobs/VIDEO_ID/subtitle-work/content-manifest.json \
  --timing-source-artifact MODEL_TRANSCRIPT_ARTIFACT_ID \
  --text-reference-artifact MANUAL_CC_ARTIFACT_ID
```

沒有人工 CC 時省略 `--text-reference-artifact`。接著把 content artifact 交給獨立的 `$segment-subtitles`：

```bash
python3 plugins/insu-player/skills/segment-subtitles/scripts/segment_subtitles.py prepare \
  --content-manifest .local/insu-player/jobs/VIDEO_ID/subtitle-work/content-manifest.json \
  --source-transcript .local/insu-player/jobs/VIDEO_ID/whisper/PROVIDER/transcript.json \
  --output .local/insu-player/jobs/VIDEO_ID/subtitle-work/segmentation-plan.json

python3 plugins/insu-player/skills/segment-subtitles/scripts/segment_subtitles.py record-segmentation-processor \
  --plan .local/insu-player/jobs/VIDEO_ID/subtitle-work/segmentation-plan.json \
  --provider agent --service codex
```

先依 finalized output language 決定 pieces，翻譯模式即採 target-first；凍結 target revision 後才能填入連續 source spans。不得使用 risky／blocked boundary，也不得為了 timing 改寫 frozen output。

Validation 通過後，以同一 importer 寫入 `segmentation` artifact，並指定 `--timing-source-artifact` 與 `--content-parent-artifact`。每個 revision 都只寫入自己的 `subtitle-work/artifacts/<artifact-id>/`。

播放器對每個語言採 `valid segmentation > valid complete proofread/translation > manual CC source > model source`，但保留使用者在字幕管理中明確選擇的有效版本。處理中、invalid 或 stale 的新 artifact 不得蓋掉最後可用版本。

## 階段 8：首頁驗證

- [ ] 首頁不重新導向，每支 job 只占一列
- [ ] processing job 的進度會更新；程序消失後顯示中斷
- [ ] 按「觀看」開啟 iframe modal，關閉後仍在首頁
- [ ] MP4 能播放、有聲音、duration 合理
- [ ] 預設沿用上次選擇，否則依 workflow 目標語、來源語與可用語言排序；下拉只顯示 BCP 47 語言碼與關閉
- [ ] 播放、暫停、拖曳後字幕同步
- [ ] 關閉 modal 後 iframe `src` 被清除，影片停止解碼
- [ ] 重開同支影片可從 job 內 `ui-state.json` 的進度接續
- [ ] 「詳情」依序顯示關於影音、畫質管理、字幕管理、影音摘要、影音筆記與執行紀錄
- [ ] 「字幕管理」內以原始字幕、翻譯字幕、切分字幕 tabs 共用版本譜系與 revision 選擇；原始字幕包含 yt-dlp 來源或本機、雲端模型轉錄的字幕，翻譯與切分表格都以多語並排呈現，且只有表格區域捲動
- [ ] 字幕內層 tab 與 revision 都映射到 URL，重新整理可恢復同一畫面；舊的三個字幕頂層路徑不再接受
- [ ] 完整翻譯一完成就可播放；有效切分稿完成時在不中斷播放偏好的前提下自動升級；無效或處理中的新版不取代舊版
- [ ] 開啟「關於影音」時不先請求字幕與 log，只有切到字幕或執行紀錄分頁才按需載入
- [ ] 斷網時仍可使用原生 `<video controls>` 與本機 VTT；首頁預設不發出 CDN 請求，只有使用者主動選擇 Google Fonts 時載入字體

## 使用四、五次之後的預期流程

環境與 server 只需設定一次。之後每次：

1. 使用者把 yt-dlp 支援的 URL 交給 Agent；未知來源則請 Agent 先研究支援方式。
2. Agent 先確認目前 workspace 的首頁已用 Codex 內建瀏覽器開啟，沒有開啟就先開啟。
3. Agent 執行 `process-video.sh`；首頁自動多一列。
4. 使用者可以繼續留在首頁，從 navbar 開啟影音中心查看下載／轉錄進度或觀看既有影片。
5. 待翻譯時先完成並匯入完整句目標語翻譯，此時即可觀看；再由 `$segment-subtitles` 產生獨立的 target-first 切分 revision，驗證成功後自動升級 active tracks。
6. 磁碟累積後只清理已完成 job 的中間檔，保留首頁播放需要的檔案。

不需要重裝 Python、重下模型、重建 HTML、重開每支影片的 server，也不需要離開首頁找不同 player 目錄。

## 清理單一 job

先 dry run：

```bash
plugins/insu-player/skills/watch-video/scripts/clean-job.sh \
  .local/insu-player \
  VIDEO_ID
```

只移除可重建的 audio、原始 YouTube 字幕與 Whisper 工作檔，保留影片、標準化字幕、縮圖、狀態和 log：

```bash
plugins/insu-player/skills/watch-video/scripts/clean-job.sh \
  .local/insu-player \
  VIDEO_ID \
  --yes
```

完整移除精確 job 改由 `$video-library` 的 removal protocol 管理。先進行唯讀預覽：

```bash
<workspace>/.agent-tools/insu-player/.venv/bin/python \
  plugins/insu-player/skills/video-library/scripts/remove_library_item.py \
  preview .local/insu-player \
  --kind video \
  --video-id VIDEO_ID
```

首頁的共用刪除對話框會自動執行唯讀 preview，只有沒有 blocker 時才啟用確認按鈕；使用者確認後，server 以該次 digest 執行 `execute --yes` 並 `verify`。digest 或資源狀態有變化就必須重新預覽；active job、symlink、資料庫檢查失敗或非 cascade 關聯都會拒絕移除。字幕分頁使用同一個對話框與 `subtitle-artifact` handler，刪除指定 revision 時會連鎖移除依賴它的下游字幕，但保留影音及其他不相關內容。

## 匯出獨立播放器（選用）

固定首頁是日常入口。只有需要複製／交付一支自包含資料夾時才使用：

```bash
plugins/insu-player/skills/watch-video/scripts/prepare-player.sh \
  --video .local/insu-player/jobs/VIDEO_ID/source/renditions/ACTIVE_RENDITION_ID.mp4 \
  --zh .local/insu-player/jobs/VIDEO_ID/subtitle-work/artifacts/SEGMENTATION_ARTIFACT_ID/zh-TW.vtt \
  --en .local/insu-player/jobs/VIDEO_ID/subtitle-work/artifacts/SEGMENTATION_ARTIFACT_ID/en.vtt \
  --output .local/insu-player/exports/VIDEO_ID

plugins/insu-player/skills/watch-video/scripts/serve-player.sh \
  .local/insu-player \
  .local/insu-player/exports/VIDEO_ID \
  8010
```

這會複製大型 MP4；不要把 export 誤當影片庫的必要步驟。

## 更新

先停止轉錄與 server：

```bash
plugins/insu-player/skills/watch-video/scripts/update-environment.sh .local/insu-player
plugins/insu-player/skills/watch-video/scripts/doctor.sh .local/insu-player
```

`update-environment.sh` 只刷新 workflow-local runtime，可用 `--provider local|openai|both` 選擇依賴。Repository、plugin 或 Release ZIP 本身的版本更新交給 `$player-manager`；更新後重新啟動 `serve-library.sh` 即會使用新版首頁模板，jobs 不需要搬移。

## 完整移除

先停止 server 與所有處理命令。預覽：

```bash
plugins/insu-player/skills/watch-video/scripts/uninstall.sh .local/insu-player
```

只移除工具、模型與快取，保留影片庫：

```bash
plugins/insu-player/skills/watch-video/scripts/uninstall.sh .local/insu-player --yes
```

連所有 jobs 一起刪除：

```bash
plugins/insu-player/skills/watch-video/scripts/uninstall.sh \
  .local/insu-player \
  --include-generated \
  --yes
```

流程不會新增或移除系統 FFmpeg。若使用 portable release，停止程序後直接刪除整個解壓縮資料夾，即可移除所有 workflow-owned 工具、模型、jobs、播放進度與已知持久快取。瀏覽器歷史、瀏覽器一般 cache 與作業系統暫存依各自政策管理，不宣稱由本流程刪除。

## 使用者可以怎麼請 Agent

首次：

> 依照 `$watch-video` 建立本機影片庫。先啟動目前 workspace 的首頁並用 Codex 內建瀏覽器開啟，保持首頁開啟後再跑 doctor，列出會安裝的位置、空間與系統影響；取得我同意後完成安裝並處理這支影片。

日常：

> 沿用既有 `.local/insu-player`，把這支影音加入本機影音庫。先問我是否需要翻譯及目標語言，再分別詢問 timing、內容與切分要使用本機模型、OpenAI 模型或目前的 Agent；timing 不接受 Agent。翻譯模式不取得任何平台字幕，完成來源 timed units、完整自然譯文與 target-first 切分，完成 Source Alignment 和驗證後輸出同步雙語字幕。首頁保持啟動，完成後告訴我狀態。

續跑：

> 查看本機影片庫中所有待轉錄、待翻譯、中斷與失敗項目。先讀 status 和 log，只重跑必要階段，不要重新下載已完成影片。

清理：

> 列出已完成影片中可安全清掉的中間檔與預估容量，先 dry run，不要刪除影片、標準化字幕、狀態或 log。

移除：

> 完整移除指定的 INSU Player 影音。請使用 `$video-library`，固定目前專案的 workspace，先以 `remove_library_item.py preview` 列出檔案、資料庫、依賴、容量與可復原性；在我確認該次 plan digest 前不要停止程序或刪除。確認後只執行同一份計畫，最後用 `verify` 檢查並回報。

> 依 uninstall 章節先做 dry run，分開列出 runtime、模型與 jobs；確認沒有背景程序，先不要真的刪除。

## 上游文件

- [uv](https://docs.astral.sh/uv/)
- [OpenAI Whisper](https://github.com/openai/whisper)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [Deno](https://docs.deno.com/runtime/)
- [FFmpeg](https://ffmpeg.org/download.html)
- [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg)
