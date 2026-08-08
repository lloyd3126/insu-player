# INSU Player

> 用 Agent，讓影片跨越語言。

INSU Player 是為 Agent 設計的本機字幕影片庫。把想看的影片網址交給 `$watch-video`，Agent 會準備好影片與字幕後，放進 INSU 讓你觀看。

首頁集中提供開始使用、進階使用、支援網站、介面設定、環境變數、模型列表與影片列表。觀看時不必離開首頁，每支影片都會在頁面內開啟，處理狀態與播放進度也會持續保留。

## 最快開始

### Release ZIP（最完整的可攜體驗）

1. 從 [GitHub Releases](https://github.com/lloyd3126/insu-player/releases) 下載 `insu-player-vVERSION-portable.zip` 與同名 `.sha256`。
2. 解壓縮後，用 Codex 開啟整個資料夾。
3. 對 Codex 說：

> 請使用 $watch-video，檢查這個 INSU Player 工作區，說明本機與 API 轉錄的差異，然後把這支影片加入影片庫：VIDEO_URL

Codex 會從 `.agents/skills/` 發現技能。工具、模型、cache、影片、字幕、log 與播放進度都留在 `.local/insu-player/`；不需要 `sudo`、Homebrew、全域 pip 或全域 npm。

### Codex plugin

```bash
codex plugin marketplace add https://github.com/lloyd3126/insu-player.git
codex plugin add insu-player@insu-player
```

重新開啟 Codex task 後即可使用 `$watch-video`。Plugin 本身由 Codex 管理；每個影片庫的 runtime 與資料仍安裝到你指定專案的 `.local/insu-player/`。

產品名稱、plugin ID、marketplace、Release 檔名與 workspace 路徑統一使用 `insu-player`。

## 首頁功能

| 入口 | 功能 |
| --- | --- |
| 開始使用 | 開啟以 YouTube 為例的 Agent 對話提示 |
| 進階使用 | 複製內建使用情境，並查看由 Agent 維護的「我的提示」 |
| 支援網站 | 瀏覽目前 workspace 內 yt-dlp 實際支援的網站，未知來源可交給 Agent 研究 |
| 介面設定 | 即時切換主色與全站字體，可選 Google Fonts 或這台電腦已安裝的本機字體 |
| 環境變數 | 將白名單內的 API Key 套用到本次本機服務，不寫入 `.env` 或其他檔案 |
| 模型列表 | 確認本機模型、實際下載大小、API SDK 與 API Key 設定狀態 |
| 影片列表 | 查看下載、轉錄、翻譯與字幕狀態，並在首頁內播放與續播 |

使用規範集中放在頁尾連結。所有 modal 採一致高度與兩種寬度，桌面與窄螢幕皆可操作。

## 五個技能

| Skill | 用途 |
| --- | --- |
| `$watch-video` | 主要入口：新增影片、取得字幕、轉錄、翻譯並開啟影片庫 |
| `$video-library` | 啟動、檢查、修復與整理既有影片庫 |
| `$transcribe-media` | 將本機音訊或影片輸出為 JSON、TXT、WebVTT |
| `$translate-subtitles` | 保留 cue 與時間戳，翻譯為繁體中文並匯入 |
| `$player-manager` | 檢查版本、安全更新或移除 INSU Player |

## 轉錄選項

- `local`：預設且私密。Whisper、Python、FFmpeg、模型與 cache 都安裝在工作區內，預設下載 `medium`；首次安裝可能需要數 GB。
- `openai`：不下載本機 Whisper 模型，但會把音訊片段上傳到 OpenAI，可能產生 API 費用。Agent 必須先取得明確同意，且只有加上 `--allow-api-upload` 才會執行。
- 現成字幕：若來源已有作者或自動字幕，INSU 會優先使用，不進行語音轉錄。

手動入口：

```bash
scripts/portable/setup.sh --provider local --model medium
scripts/portable/serve.sh 8000
scripts/portable/add-video.sh 'VIDEO_URL'
```

API 模式：

```bash
export OPENAI_API_KEY='只放在目前 shell；不要寫進專案'
scripts/portable/setup.sh --provider openai
scripts/portable/add-video.sh 'VIDEO_URL' --provider openai --allow-api-upload
```

也可以先啟動首頁，從 navbar 的「環境變數」把 `OPENAI_API_KEY` 套用到本次本機服務。它不會寫入 `.env` 或其他檔案，停止或重新啟動服務後即清除。無論金鑰從哪裡提供，API 上傳仍必須由 Agent 取得本次明確同意並使用 `--allow-api-upload`。

開啟 `http://127.0.0.1:8000/`，或請 Codex 用內建瀏覽器開啟。

## 更新與完整移除

先預覽，再套用：

```bash
python3 plugins/insu-player/skills/player-manager/scripts/manage.py update
python3 plugins/insu-player/skills/player-manager/scripts/manage.py update --apply
scripts/portable/uninstall.sh
```

`uninstall.sh --yes` 只移除可重建的 runtime 與 cache，保留影片庫；只有在使用者明確要求時才使用 `--include-generated --yes` 移除影片、字幕、log 與進度。

Release ZIP 或 Git checkout 模式下，完整移除的最後一步是停止服務後，把「這一個 INSU Player 資料夾」移到垃圾桶。Plugin 模式另執行：

```bash
codex plugin remove insu-player@insu-player
codex plugin marketplace remove insu-player
```

## 為什麼叫 INSU

INSU 取自臺灣紫嘯鶇學名 `Myophonus insularis` 的種小名。這種只分布於臺灣溪谷的特有鳥類，藍紫色金屬光澤也成為產品的代表色。物種資料可參考[臺灣國家公園主題網](https://www.taiwan.nps.gov.tw/home/zh-tw/eco-gallery/21399.html)與[林業保育署物種介紹](https://taichung.forest.gov.tw/0000253)。

## 專案結構

```text
insu-player/
├── .agents/skills/                 # 用資料夾開啟時的 discovery bridge
├── plugins/insu-player/            # 可安裝的 Codex plugin 與完整 skills
├── scripts/portable/               # Release ZIP 的固定入口
├── examples/                       # 播放器與影片庫模板說明
├── tests/                          # runtime、伺服器、轉錄、更新與 release 測試
└── .local/insu-player/             # 使用後產生；不進 Git
```

版本變更請見 [CHANGELOG.md](CHANGELOG.md)。

只下載或處理你有權使用的媒體。INSU Player 不應用於繞過 DRM、付費牆、會員、私人存取、地區限制或帳號控制。
