# Xeruca Player

> Call in a video. Your agent handles the rest.

Xeruca Player 是為 Codex 設計的本機字幕影片庫。你只要把有權處理的影片交給 `$watch-video`；Agent 會處理下載、現成字幕、本機或 API 轉錄、繁體中文翻譯、可續播的本機播放器與工作狀態。

觀看時不必離開影片庫首頁：每支影片都在同源 iframe modal 中播放，下載中、待轉錄、待翻譯、失敗與完成狀態則持續留在同一張表格。

## 最快開始

### Release ZIP（最完整的可攜體驗）

1. 從 GitHub Releases 下載 `xeruca-player-vVERSION-portable.zip` 與同名 `.sha256`。
2. 解壓縮後，用 Codex 開啟整個資料夾。
3. 對 Codex 說：

> 請使用 $watch-video，檢查這個 Xeruca Player 工作區，說明本機與 API 轉錄的差異，然後把這支我有權處理的影片加入影片庫：VIDEO_URL

Codex 會從 `.agents/skills/` 發現技能。工具、模型、cache、影片、字幕、log 與播放進度都留在 `.local/xeruca-player/`；不需要 `sudo`、Homebrew、全域 pip 或全域 npm。

### Codex plugin

```bash
codex plugin marketplace add https://github.com/lloyd3126/xeruca-player.git
codex plugin add xeruca-player@xeruca-player
```

重新開啟 Codex task 後即可使用 `$watch-video`。Plugin 本身由 Codex 管理；每個影片庫的 runtime 與資料仍安裝到你指定專案的 `.local/xeruca-player/`。

## 五個技能

| Skill | 用途 |
| --- | --- |
| `$watch-video` | 主要入口：新增影片、取得字幕、轉錄、翻譯並開啟影片庫 |
| `$video-library` | 啟動、檢查、修復與整理既有影片庫 |
| `$transcribe-media` | 將本機音訊或影片輸出為 JSON、TXT、WebVTT |
| `$translate-subtitles` | 保留 cue 與時間戳，翻譯為繁體中文並匯入 |
| `$player-manager` | 檢查版本、安全更新或移除 Xeruca Player |

## 轉錄選項

- `local`：預設且私密。Whisper、Python、FFmpeg、模型與 cache 都安裝在工作區內；首次安裝可能需要數 GB。
- `openai`：不下載本機 Whisper 模型，但會把音訊片段上傳到 OpenAI，可能產生 API 費用。Agent 必須先取得明確同意，且只有加上 `--allow-api-upload` 才會執行。
- 現成字幕：若來源已有作者或自動字幕，Xeruca 會優先使用，不進行語音轉錄。

手動入口：

```bash
scripts/portable/setup.sh --provider local --model turbo
scripts/portable/serve.sh 8000
scripts/portable/add-video.sh 'VIDEO_URL'
```

API 模式：

```bash
export OPENAI_API_KEY='只放在目前 shell；不要寫進專案'
scripts/portable/setup.sh --provider openai
scripts/portable/add-video.sh 'VIDEO_URL' --provider openai --allow-api-upload
```

開啟 `http://127.0.0.1:8000/`，或請 Codex 用內建瀏覽器開啟。

## 更新與完整移除

先預覽，再套用：

```bash
python3 plugins/xeruca-player/skills/player-manager/scripts/manage.py update
python3 plugins/xeruca-player/skills/player-manager/scripts/manage.py update --apply
scripts/portable/uninstall.sh
```

`uninstall.sh --yes` 只移除可重建的 runtime 與 cache，保留影片庫；只有在使用者明確要求時才使用 `--include-generated --yes` 移除影片、字幕、log 與進度。

Release ZIP 或 Git checkout 模式下，完整移除的最後一步是停止服務後，把「這一個 Xeruca Player 資料夾」移到垃圾桶。Plugin 模式另執行：

```bash
codex plugin remove xeruca-player@xeruca-player
codex plugin marketplace remove xeruca-player
```

## 為什麼叫 Xeruca

名稱取自臺灣特有的招潮蟹 `Xeruca formosensis`（臺灣旱招潮）。揮動大螯像是在呼叫 Agent；多足則像下載、播放、轉錄、翻譯與字幕幾條同時運作的工作流。物種資料可參考[海洋保育署圖鑑](https://www.oca.gov.tw/ch/home.jsp?dataserno=202202220027&id=522&mcustomize=ocamaritime_view.jsp&parentpath=0%2C298%2C386)與[相關粒線體研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC9755983/)。

## 專案結構

```text
xeruca-player/
├── .agents/skills/                 # 用資料夾開啟時的 discovery bridge
├── plugins/xeruca-player/          # 可安裝的 Codex plugin 與完整 skills
├── scripts/portable/               # Release ZIP 的固定入口
├── examples/                       # 播放器與影片庫模板說明
├── tests/                          # runtime、伺服器、轉錄、更新與 release 測試
└── .local/xeruca-player/           # 使用後產生；不進 Git
```

只下載或處理你有權使用的媒體。Xeruca Player 不應用於繞過 DRM、付費牆、會員、私人存取、地區限制或帳號控制。
