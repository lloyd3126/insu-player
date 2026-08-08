# yt-dlp 來源影片庫、轉錄與繁中字幕

## 最終體驗

這個 skill 把 yt-dlp 目前版本可辨識的單支線上影片收進一個持續使用的本機影片庫。YouTube 是首頁與文件的預設範例，不是唯一支援來源。日常入口不是每支影片各自的 HTML，而是固定首頁：

```text
http://127.0.0.1:8000/
```

首頁是全高入口頁。主視覺與 navbar 的「開始使用」會開啟同一個 YouTube 操作範例。「進階使用」提供可複製的內建情境與「我的提示」，「支援網站」列出 workflow-local yt-dlp 的實際支援清單，「介面設定」可即時更換主色與全頁字體，「環境變數」管理本次服務的白名單變數。「模型列表」會顯示 workspace 實際下載的本機 Whisper 模型、實際檔案大小、API SDK 安裝狀態與 API Key 是否已設定，「影片列表」則以 modal 顯示所有影片的下載、轉錄、翻譯與完成狀態、進度、字幕、容量及最近 log。從列表按「觀看」會再疊開同頁 iframe modal，關閉後回到影片列表，背景任務與狀態輪詢不會中斷。

首頁除了保存播放位置外是唯讀控制台。新增、重試、翻譯、取消、清理與刪除仍由 Agent 或明確的腳本命令執行，避免在瀏覽器誤觸資料變更。

## 目的與成功條件

輸入：

- 目前 workflow-local yt-dlp 有對應 extractor 的單支影片 URL
- 專用 workspace 路徑
- 原始語言、目標字幕語言與可接受的機器翻譯範圍

輸出：

- 瀏覽器相容 `video.mp4`
- 可用的原文、英文與／或繁體中文 VTT
- 可中斷恢復的 `status.json` 與 workflow log
- 同源、本機限定、支援影片 Range request 的影片庫首頁

完成標準：影片能從 navbar 的影片列表 modal 開啟播放，字幕可切換且時間同步；若尚待轉錄或翻譯，列表要正確顯示待辦，而不是假裝完成。

## 不處理的範圍

- 不繞過 DRM、付費、會員、私人、地區或帳號限制。
- 不把影片、字幕、cookie、模型、venv 或快取 commit 到 repository。
- 不保證來源平台一定提供字幕或自動翻譯。
- 找不到 extractor 時，Agent 應使用 INSU Player 研究來源、公開介面與媒體格式，研究不等於繞過存取控制。
- Whisper 的 `translate` 只會翻成英文，不會直接產生繁中；繁中由現成字幕或 Agent 保留 cue 時間軸翻譯。
- 不讀取登入 cookie，除非使用者明確要求並理解授權範圍。cookie 不得貼入聊天或寫進 repository。
- 不把本機服務公開到 LAN 或 Internet。

## 支援環境與資源預估

腳本支援 macOS、Linux 與 Windows WSL。原生 Windows 可依同一架構手動安裝，但這一版沒有 PowerShell 腳本。

建議預留至少 10 GB 加影片大小。8 GB RAM 適合 `small`；16 GB 以上較適合 `turbo`。純 CPU 轉錄長片可能接近或超過影片時長。

## 架構與資料契約

```text
<workspace>/
├── .insu-environment-session.json # 服務運作期間的 localhost capability，不含 API key，停止後移除
├── .agent-tools/xeruca-player/     # uv、Python、venv、FFmpeg、yt-dlp、Deno、選用 provider、模型與全部已知快取
├── prompts.json                    # Agent 維護、首頁唯讀的「我的提示」
└── jobs/
    └── <video-id>/
        ├── status.json                     # 唯一任務狀態來源，atomic write
        ├── manifest.txt
        ├── media-info.txt
        ├── ui-state.json                   # 首頁播放進度，atomic write
        ├── source/
        │   ├── video.mp4                   # 首頁只播放這個固定路徑
        │   ├── audio.m4a                   # 需要轉錄時才保留
        │   └── thumbnail.jpg
        ├── captions/
        │   ├── en.vtt                      # 標準化可播放字幕
        │   ├── source.vtt
        │   └── zh-TW.vtt
        ├── youtube-captions/               # 可重建的原始下載字幕
        ├── whisper/                        # 可重建的本機或 API 轉錄工作輸出
        └── logs/workflow.log
```

`status.json` 記錄標題、來源、目前 state/stage、0–100 進度、程序 PID、錯誤、產物、字幕來源與最多 120 筆歷程。寫入採暫存檔加 atomic replace，避免首頁在更新中讀到半份 JSON。

「進階使用」modal 提供內建情境與可直接複製的提示；「我的提示」由 Agent 依 [prompt-library.md](prompt-library.md) 使用專用腳本新增或修改。首頁只提供 `GET /api/prompts`，不允許使用者在瀏覽器直接編輯 workspace。「環境變數」modal 只接受程式白名單中的變數，目前為 `OPENAI_API_KEY`。值只存在本機服務程序，公開 API 只回傳是否已設定，停止服務後即消失。

主要狀態：

| 狀態 | 意義 | 下一步 |
| --- | --- | --- |
| `checking` / `downloading` | 正在檢查字幕或下載媒體 | 等待或查看 log |
| `needs_transcription` | 沒有可用文字軌 | 執行 `transcribe.sh` |
| `transcribing` | 選定 provider 轉錄中 | 等待；可在中斷後重跑 |
| `needs_translation` | 有原文字幕，沒有繁中 | Agent 保留時間戳翻譯 |
| `translating` | Agent 正在翻譯 | 完成後 `import-caption.sh` |
| `ready` | 影片與繁中字幕可觀看 | 首頁觀看或清理中間檔 |
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

建議從 GitHub Release 下載 `xeruca-player-vX.Y.Z-portable.zip` 與 checksum。解壓縮後用 Agent 開啟整個資料夾並從根目錄 `START-HERE.md` 開始；不需要安裝 Git。已有 Git 且要參與維護時才使用 `git clone`。

Agent 先讀根目錄 `AGENTS.md` 與本文件。

## 階段 1：確認權利與需求

下載前確認：

1. URL 與是否只處理單支影片；腳本固定 `--no-playlist`。
2. 使用者已接受首頁集中顯示的使用規範；來源平台條款與所在地規範仍可能適用。
3. 原始語言、需要的字幕語言、是否接受機器翻譯。
4. 選擇本機或 OpenAI API provider；本機需下載大型依賴與模型，API 會上傳音訊並可能產生費用。
5. workspace 是否可能包含敏感內容。

如果只要現成字幕，Agent 應先檢查字幕來源，不必立刻下載 Whisper 模型或影片。

## 階段 2：從零盤點環境

```bash
plugins/xeruca-player/skills/watch-video/scripts/doctor.sh work/xeruca-player
```

`doctor.sh` 唯讀，不安裝或刪除。Agent 要用白話說明 OS／CPU、磁碟、`curl`、`unzip`、workflow-local FFmpeg、runtime、模型和既有 jobs。系統 Python、FFmpeg、yt-dlp、Deno 與 uv 只列為「偵測但不使用」。

若缺 `curl` 或 `unzip`，停止並說明；這版不會呼叫套件管理器或 `sudo`。Release 的支援環境預期已有作業系統基礎的 HTTPS 下載與 ZIP 解壓能力。

## 階段 3：隔離安裝

```bash
plugins/xeruca-player/skills/watch-video/scripts/setup-environment.sh \
  work/xeruca-player \
  --provider local \
  --model turbo
```

腳本只在 `<workspace>/.agent-tools/xeruca-player/` 安裝：

- uv 與 uv 管理的 Python 3.11
- 專用 `.venv`
- 核心 `yt-dlp[default]`、`imageio-ffmpeg`，以及所選 provider 的 `openai-whisper` 或 OpenAI SDK
- 從平台 wheel 複製到 workflow `bin/` 的 FFmpeg
- 本機 provider 才需要的 Whisper 模型
- workflow-local Deno

Deno 不是拿來開網頁伺服器；它提供部分 yt-dlp extractors 所需的 JavaScript runtime。影片庫伺服器使用 Python 標準庫，不增加 PHP、Node 或資料庫依賴。

腳本不修改 shell profile、不取代系統 Python、不把工具加入全域 `PATH`，也不使用 Homebrew、APT、DNF 或 Pacman。執行時把 `HOME`、`TMPDIR`、`UV_*`、完整 XDG config/data/state/cache、`TORCH_HOME`、`TIKTOKEN_CACHE_DIR`、`HF_HOME`、Python bytecode、Deno 與 yt-dlp cache 全部改到 runtime；yt-dlp 加上 `--ignore-config`，不讀使用者全域設定。低資源環境可用 `--model small`；API-only 使用 `--provider openai`，不會安裝 Whisper 或下載模型。

安裝後再次執行 doctor，必須看到 `status: ready`。

## 階段 4：啟動固定首頁

```bash
plugins/xeruca-player/skills/watch-video/scripts/serve-library.sh \
  work/xeruca-player \
  8000
```

開啟 <http://127.0.0.1:8000/>。Server 僅綁定 `127.0.0.1`，並且只暴露 allowlist 路由：首頁資產、job JSON、唯讀提示 JSON、模型安裝摘要 JSON、環境變數遮罩狀態與同源工作階段寫入、log 尾端、標準化 MP4、縮圖、VTT、player，以及只寫 `ui-state.json` 的播放進度端點。模型摘要只包含名稱、實際大小、provider 狀態與 API Key 是否已設定，不包含 Key、路徑或檔案內容。環境變數的原值不會從公開端點讀回，Agent 的轉錄子程序只能透過服務啟動時建立的短期 capability 取得，而且仍須先有本次 API 上傳同意。它不提供任意目錄瀏覽，也不會公開 `.agent-tools` 或模型。

影片 endpoint 支援 HTTP Range，拖曳時不需重新傳送整支影片。播放器與首頁同源，因此 iframe 能安全交換 ready、播放時間、暫停與接續播放訊息。

關閉 server：回到 terminal 按 `Ctrl+C`。它是前景程序，不安裝背景 daemon 或開機自動啟動。

## 階段 5：處理一支新影片

日常預設使用單一入口：

```bash
plugins/xeruca-player/skills/watch-video/scripts/process-video.sh \
  work/xeruca-player \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  --model turbo \
  --language en \
  --track en
```

流程會：

1. 解析影片 ID 與標題並建立／續用 job。
2. 嘗試作者字幕與自動字幕，標準化為 `captions/*.vtt`。
3. 下載瀏覽器相容 MP4 與縮圖。
4. 沒有文字軌時準備音訊並執行使用者選定的轉錄 provider。
5. 即時更新狀態、進度、PID 與 log。
6. 有繁中時設為 `ready`；只有原文時停在 `needs_translation`。

如果只想先下載、稍後再轉錄：

```bash
plugins/xeruca-player/skills/watch-video/scripts/process-video.sh \
  work/xeruca-player \
  'https://www.youtube.com/watch?v=VIDEO_ID' \
  --no-transcribe
```

重新執行會沿用固定 job，不建立重複首頁或覆蓋其他影片。yt-dlp 使用 `--no-overwrites`；若檔案損壞，Agent 先確認精確目標再移除並重跑。

## 階段 6：只重跑指定階段

下載與字幕來源檢查：

```bash
plugins/xeruca-player/skills/watch-video/scripts/download-video.sh \
  work/xeruca-player \
  'https://www.youtube.com/watch?v=VIDEO_ID'
```

本機 Whisper 轉錄：

```bash
plugins/xeruca-player/skills/watch-video/scripts/transcribe.sh \
  work/xeruca-player \
  VIDEO_ID \
  --model turbo \
  --language en \
  --track en \
  --device cpu
```

若 `audio.m4a` 不存在，腳本會從同一 job 的 `video.mp4` 擷取，不必再下載一份媒體。Apple Silicon 或不確定 GPU 環境預設 CPU；確定 CUDA 可用才指定 `--device cuda`。

OpenAI API 轉錄必須先取得這次音訊上傳的明確同意，並只在目前 terminal 設定 key：

~~~bash
export OPENAI_API_KEY='set-in-current-terminal'
plugins/xeruca-player/skills/watch-video/scripts/transcribe.sh \
  work/xeruca-player VIDEO_ID \
  --provider openai --model whisper-1 \
  --language en --track en --allow-api-upload
~~~

API 音訊會先轉為低位元率分段，單檔低於 25 MB，再把 segment timestamps offset 回完整時間軸。Key 不寫入 job、log 或 metadata。

若首頁服務已啟動，也可以從 navbar 的「環境變數」輸入 `OPENAI_API_KEY`，再執行同一個 `transcribe.sh --allow-api-upload` 命令。腳本會讓 API 轉錄子程序繼承服務程序中的值，不會把值回傳給首頁、寫入 `.env`、命令列、job、log 或 metadata。停止或重新啟動服務後需要重新輸入。

## 階段 7：Agent 翻譯繁中字幕

Agent 先將 job 標成翻譯中：

```bash
<workspace>/.agent-tools/xeruca-player/.venv/bin/python \
  plugins/xeruca-player/skills/watch-video/scripts/job_state.py update \
  --job-dir <workspace>/jobs/VIDEO_ID \
  --state translating \
  --stage translation \
  --message 'Agent 正在翻譯繁體中文字幕' \
  --record-history
```

翻譯規則：

1. 以通過抽查的原文／英文 VTT 為唯一時間軸。
2. 保留每個 cue 的起訖時間和順序，只翻文字。
3. 專有名詞、產品名、股票代號與數字不可臆改。
4. 長字幕分批時以 cue 時間銜接，避免漏段或重複。
5. 輸出 UTF-8、以 `WEBVTT` 開頭，至少有一個 `-->` cue。
6. 抽查開頭、中間、結尾與專有名詞密集區。

將譯文匯入固定 track：

```bash
plugins/xeruca-player/skills/watch-video/scripts/import-caption.sh \
  work/xeruca-player \
  VIDEO_ID \
  zh-TW \
  /path/to/translated.zh-TW.vtt \
  --source agent-translation \
  --label '繁體中文'
```

若目的 track 已存在，只有明確要替換時才加 `--force`。匯入會驗證 VTT、atomic replace，並在影片存在時將 job 設為 `ready`。

## 階段 8：首頁驗證

- [ ] 首頁不重新導向，每支 job 只占一列
- [ ] processing job 的進度會更新；程序消失後顯示中斷
- [ ] 按「觀看」開啟 iframe modal，關閉後仍在首頁
- [ ] MP4 能播放、有聲音、duration 合理
- [ ] 預設繁中；可切英文／原文／關閉
- [ ] 播放、暫停、拖曳後字幕同步
- [ ] 關閉 modal 後 iframe `src` 被清除，影片停止解碼
- [ ] 重開同支影片可從 job 內 `ui-state.json` 的進度接續
- [ ] 詳細資料能看到狀態歷程與 log
- [ ] 斷網時仍可使用原生 `<video controls>` 與本機 VTT；首頁預設不發出 CDN 請求，只有使用者主動選擇 Google Fonts 時載入字體

## 使用四、五次之後的預期流程

環境與 server 只需設定一次。之後每次：

1. 使用者把 yt-dlp 支援的 URL 交給 Agent；未知來源則請 Agent 先研究支援方式。
2. Agent 執行 `process-video.sh`；首頁自動多一列。
3. 使用者可以繼續留在首頁，從 navbar 開啟影片列表查看下載／轉錄進度或觀看既有影片。
4. 待翻譯時 Agent 產生繁中 VTT 並匯入；該列自動變成完成。
5. 磁碟累積後只清理已完成 job 的中間檔，保留首頁播放需要的檔案。

不需要重裝 Python、重下模型、重建 HTML、重開每支影片的 server，也不需要離開首頁找不同 player 目錄。

## 清理單一 job

先 dry run：

```bash
plugins/xeruca-player/skills/watch-video/scripts/clean-job.sh \
  work/xeruca-player \
  VIDEO_ID
```

只移除可重建的 audio、原始 YouTube 字幕與 Whisper 工作檔，保留影片、標準化字幕、縮圖、狀態和 log：

```bash
plugins/xeruca-player/skills/watch-video/scripts/clean-job.sh \
  work/xeruca-player \
  VIDEO_ID \
  --yes
```

完整刪除精確 job 必須同時指定：

```bash
plugins/xeruca-player/skills/watch-video/scripts/clean-job.sh \
  work/xeruca-player \
  VIDEO_ID \
  --all \
  --yes
```

active job 會拒絕清理。首頁下一次輪詢會反映結果。

## 匯出獨立播放器（選用）

固定首頁是日常入口。只有需要複製／交付一支自包含資料夾時才使用：

```bash
plugins/xeruca-player/skills/watch-video/scripts/prepare-player.sh \
  --video work/xeruca-player/jobs/VIDEO_ID/source/video.mp4 \
  --zh work/xeruca-player/jobs/VIDEO_ID/captions/zh-TW.vtt \
  --en work/xeruca-player/jobs/VIDEO_ID/captions/en.vtt \
  --output work/xeruca-player/exports/VIDEO_ID

plugins/xeruca-player/skills/watch-video/scripts/serve-player.sh \
  work/xeruca-player \
  work/xeruca-player/exports/VIDEO_ID \
  8010
```

這會複製大型 MP4；不要把 export 誤當影片庫的必要步驟。

## 更新

先停止轉錄與 server：

```bash
plugins/xeruca-player/skills/watch-video/scripts/update-environment.sh work/xeruca-player
plugins/xeruca-player/skills/watch-video/scripts/doctor.sh work/xeruca-player
```

`update-environment.sh` 只刷新 workflow-local runtime，可用 `--provider local|openai|both` 選擇依賴。Repository、plugin 或 Release ZIP 本身的版本更新交給 `$player-manager`；更新後重新啟動 `serve-library.sh` 即會使用新版首頁模板，jobs 不需要搬移。

## 完整移除

先停止 server 與所有處理命令。預覽：

```bash
plugins/xeruca-player/skills/watch-video/scripts/uninstall.sh work/xeruca-player
```

只移除工具、模型與快取，保留影片庫：

```bash
plugins/xeruca-player/skills/watch-video/scripts/uninstall.sh work/xeruca-player --yes
```

連所有 jobs 一起刪除：

```bash
plugins/xeruca-player/skills/watch-video/scripts/uninstall.sh \
  work/xeruca-player \
  --include-generated \
  --yes
```

流程不會新增或移除系統 FFmpeg。若使用 portable release，停止程序後直接刪除整個解壓縮資料夾，即可移除所有 workflow-owned 工具、模型、jobs、播放進度與已知持久快取。瀏覽器歷史、瀏覽器一般 cache 與作業系統暫存依各自政策管理，不宣稱由本流程刪除。

## 使用者可以怎麼請 Agent

首次：

> 依照 `$watch-video` 建立本機影片庫。先跑 doctor，列出會安裝的位置、空間與系統影響；取得我同意後完成安裝、啟動固定首頁，再處理這支影片。

日常：

> 沿用既有 `work/xeruca-player`，把這支影片加入本機影片庫。依目前 yt-dlp extractor 處理，優先使用現成字幕，沒有才跑 Whisper；保留時間戳翻成繁中。首頁保持啟動，完成後告訴我狀態。

續跑：

> 查看本機影片庫中所有待轉錄、待翻譯、中斷與失敗項目。先讀 status 和 log，只重跑必要階段，不要重新下載已完成影片。

清理：

> 列出已完成影片中可安全清掉的中間檔與預估容量，先 dry run，不要刪除影片、標準化字幕、狀態或 log。

移除：

> 依 uninstall 章節先做 dry run，分開列出 runtime、模型與 jobs；確認沒有背景程序，先不要真的刪除。

## 上游文件

- [uv](https://docs.astral.sh/uv/)
- [OpenAI Whisper](https://github.com/openai/whisper)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [Deno](https://docs.deno.com/runtime/)
- [FFmpeg](https://ffmpeg.org/download.html)
- [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg)
