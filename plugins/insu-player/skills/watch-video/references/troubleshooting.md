# yt-dlp 來源字幕流程：故障排除

先執行：

```bash
plugins/insu-player/skills/watch-video/scripts/doctor.sh <workspace>
```

不要在不知道前一步是否成功時重跑整套流程。保存錯誤訊息、命令、影片 ID 與完成到哪一階段。

## workflow-local FFmpeg 找不到

這版透過 `imageio-ffmpeg` 的平台 wheel 取得真正的 FFmpeg binary，再複製到 `<workspace>/.agent-tools/insu-player/bin/ffmpeg`。不需要 `ffprobe`、Homebrew 或 `sudo`。

若 doctor 顯示未安裝，重新執行 `setup-environment.sh`。若套件沒有目前 OS／CPU 的 wheel，停止並回報不支援的平台；不要私自改用系統套件管理器。媒體資訊記錄在 job 的 `media-info.txt`。

## yt-dlp 顯示 JavaScript runtime 或 EJS 警告

目前完整 YouTube 支援可能需要 `yt-dlp-ejs` 和 JavaScript runtime。此 INSU 工作流程安裝 `yt-dlp[default]`，並在工作 runtime 內放置 Deno。確認：

```bash
<workspace>/.agent-tools/insu-player/bin/deno --version
<workspace>/.agent-tools/insu-player/.venv/bin/yt-dlp --verbose --version
```

使用腳本時會明確傳入專案私有 Deno。若仍有警告，先執行 `update-environment.sh`，再用短片測試。

## YouTube 回傳 403、要求登入或 bot 驗證

- 停止高速重試，確認 yt-dlp 是否為最新版。
- 先在一般瀏覽器確認影片確實可由使用者觀看。
- 年齡、會員、私人或地區限制不能靠本 INSU 工作流程規避。
- `--cookies-from-browser` 會讀取登入工作階段，屬於敏感權限；只有使用者明確要求、理解風險且有權存取時才使用。
- 不匯出 cookie 到 repository，不把 cookie 貼進聊天；完成後依需要登出或撤銷工作階段。

## 找不到目標語言字幕

先確認使用者是否在字幕取得前選擇翻譯與目標 BCP 47 語言。翻譯模式不得檢查或下載任何平台字幕，必須由使用者明確選擇本機或 OpenAI 模型，再從原始音訊產生來源 timed units。若 `transcript.json` 沒有 words/tokens，使用相同 provider 重新轉錄並檢查 timing granularity；不要把 Whisper 的英語 translation task 當成任意目標語言翻譯。

## VTT 已下載但播放器顯示 0 cues

- 確認檔案以 `WEBVTT` 開頭。
- 確認至少有一行 `00:00:00.000 --> 00:00:01.000` 格式的時間戳。
- YouTube VTT 可能在時間戳與文字間插入空行；模板 parser 已兼容，但仍要檢查內容不是空檔或錯誤頁面。
- 確認檔案是 UTF-8，而且沒有把 JSON 或 HTML 錯誤內容存成 `.vtt`。

## 首頁顯示處理中，但 terminal 已經停止

首頁會檢查 active job 的 PID 和最後更新時間。程序消失超過約 45 秒後，`effectiveState` 會顯示「已中斷」，但不會擅自修改原始 `status.json`。先打開詳細資料看 log，確認 `video.mp4`、音訊或 VTT 是否已完成，再只重跑對應命令。

不要只把狀態手動改成 `ready`；`ready` 但缺 `source/video.mp4` 會被首頁視為失敗。

## 首頁可以開，但影片拖曳或播放失敗

請使用 `serve-library.sh`。一般靜態 server 沒有 job API，也不保證正確處理 Range request。

```bash
plugins/insu-player/skills/watch-video/scripts/serve-library.sh <workspace>
```

確認瀏覽器 network 中 `/media/VIDEO_ID/video` 回傳 `200` 或 `206`，並查看 job 的 `media-info.txt` 是否列出視訊與音訊 stream。影片庫只認固定路徑 `<workspace>/jobs/VIDEO_ID/source/video.mp4`。

## `file://` 可以播放影片但字幕載入失敗

瀏覽器通常會限制本機頁面 `fetch` 其他檔案。日常使用 `serve-library.sh`；獨立 export 才使用 `serve-player.sh`。不要直接雙擊 HTML。

## 離線時播放器無法顯示

模板沒有外部 CDN，使用瀏覽器原生 `<video controls>`。若影片不能播，檢查：

- `video.mp4` 是否存在
- 瀏覽器是否支援影片 codec
- `media-info.txt` 是否顯示視訊與音訊 stream
- HTTP server 的 terminal 是否回傳 404

## Whisper 安裝失敗

- 確認使用 Python 3.11 和 workflow-local `.venv`。
- 若 `tiktoken` 缺少適用 wheel，Whisper 上游可能要求 Rust；先保存完整錯誤，再依上游 README 安裝 Rust，不要直接修改系統 Python。
- 公司網路若有 TLS proxy，說明憑證問題；不要關閉 TLS 驗證作為長期解法。

## Whisper 模型下載中斷或磁碟不足

- 用 `doctor.sh` 檢查可用空間。
- 刪除前先確認模型目錄只屬於此 workflow：`<workspace>/.agent-tools/insu-player/models/`。
- 可以改用較小模型，例如 `small`，但要重新抽查品質。
- 不要把未完成模型移到 repository 或誤認為有效模型。

## Apple Silicon 出現 MPS／Torch segmentation fault

此流程預設使用 CPU。若手動指定 MPS 後 crash，改回：

```bash
transcribe.sh <workspace> <video-id> --model medium --device cpu
```

CPU 可能較慢，但通常比反覆 crash 更可預期。

## 字幕逐漸不同步

- 比較 MP4 和音訊來源的實際 duration。
- 確認轉錄使用的音訊來自同一支影片版本。
- 檢查是否在翻譯時合併 cue 卻沒有保留原時間。
- 開頭準確、末段偏移通常是來源時基或剪輯版本不同，不是單一句翻譯問題。

## Port 已被占用

先保留本次已選定的 workspace。Port 被占用不表示應改用該 port 背後的服務或 workspace；不要因對方已有 runtime、jobs 或正在運作就跨專案沿用。

一般啟動不要指定 port：

```bash
serve-library.sh <workspace>
```

Hono/Bun 服務會先獨占探測 `8000`；若已被占用，就由作業系統分配可用 localhost port，並將實際 `host`、`port`、`pid` 與 runtime 寫入 `<workspace>/.insu-player-server.json`。讀取啟動輸出或該檔案後開啟實際網址，不要猜測下一個 port。

只有當 `.insu-player-server.pid`、`.insu-player-server.json` 與 live process 都屬於本次選定的 workspace，才能把既有程序視為同一個影片庫。若是另一個 workspace 的 server，讓它繼續運作。只有確定是本次 workspace 的上一個 server 時，才回到其 terminal 按 `Ctrl+C`；不要任意終止不確定來源的程序。

## 首頁沒有出現新影片

- 確認存在 `<workspace>/jobs/VIDEO_ID/status.json`。
- `status.json` 必須是 JSON object，而且 `videoId` 只能含英數字、底線與連字號。
- 首頁每 2.5 秒更新；可按右上重新整理按鈕。
- 確認啟動 server 時使用的是同一個 workspace。
- 看 terminal 是否有 `/api/jobs` 的 `500`。狀態檔無法解析時，修復 JSON；不要刪除整個 job。

## iframe modal 是黑畫面

- 等待 player 的 metadata 載入；大型 MP4 第一個 Range request 可能稍久。
- 開啟詳細資料確認 job 可觀看且 `video.mp4` 存在。
- 確認瀏覽器原生 controls 已顯示；頁面不需要任何 CDN。
- `video.mp4` codec 不相容時重新檢查 `media-info.txt`，必要時用 workflow-local FFmpeg 轉為 H.264 + AAC；先保留原檔，不直接覆蓋唯一副本。

## 翻譯檔匯入失敗

翻譯模式先使用 `segment_subtitles.py validate` 檢查 frozen target、width、source spans、anchors 與 risky/blocked boundaries，再用 `reflow_subtitles.py validate-pair` 和 `import-bilingual-captions.sh` 驗證成對軌；不要使用單軌 `import-caption.sh`。來源與目標語必須有相同 cue ID、數量與時間，空文字、時間重疊、換行或內部 marker 都會拒絕匯入。確認兩軌和語言碼都正確後才加 `--force`。
