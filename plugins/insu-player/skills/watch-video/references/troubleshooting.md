# yt-dlp 來源字幕流程：故障排除

先執行：

```bash
plugins/insu-player/skills/watch-video/scripts/doctor.sh <workspace>
```

不要在不知道前一步是否成功時重跑整套流程。保存錯誤訊息、命令、影片 ID 與完成到哪一階段。

## workflow-local FFmpeg 找不到

這版透過 `imageio-ffmpeg` 的平台 wheel 取得真正的 FFmpeg binary，再複製到 `<workspace>/.agent-tools/insu-player/bin/ffmpeg`。不需要 `ffprobe`、Homebrew 或 `sudo`。

若 doctor 顯示未安裝，重新執行 `setup-environment.sh`。若套件沒有目前 OS／CPU 的 wheel，停止並回報不支援的平台。不要私自改用系統套件管理器。媒體資訊記錄在 job 的 `media-info.txt`。

## yt-dlp 顯示 JavaScript runtime 或 EJS 警告

目前完整 YouTube 支援可能需要 `yt-dlp-ejs` 和 JavaScript runtime。此 INSU 工作流程安裝 `yt-dlp[default]`，並在工作 runtime 內放置 Deno。確認：

```bash
<workspace>/.agent-tools/insu-player/bin/deno --version
<workspace>/.agent-tools/insu-player/.venv/bin/yt-dlp --verbose --version
```

使用腳本時會明確傳入專案私有 Deno。若仍有警告，先執行 `update-environment.sh`，再用短片測試。

## YouTube 回傳 403、要求登入或 bot 驗證

- 停止高速重試，確認 yt-dlp 是否為最新版。一次 403 只代表該次簽名串流 URL 失敗，不能直接判定高畫質不可用。
- 讓下載腳本重新解析同一畫質的全新 URL，對每條視訊／音訊串流做小段 HTTP Range probe。兩次 fresh probe 都失敗後，才可嘗試下一個實際存在的畫質。
- 自動降級不得低於 720p。若只剩 480p、360p 或更低格式，停止並回報候選畫質。使用者明確接受後才重跑 `--allow-low-quality`。
- 檢查 `<job>/media-work/catalog.json` 與該次 `<job>/media-work/runs/<run-id>/`：run 必須記錄每次 probe 的 HTTP 狀態、下載結果、選定 format ID 及實際解析度，而且任何地方都不得保存簽名串流 URL。
- 下載完成後比對該次 run 的 `media-info.txt` 與 `selection.json`。實際解析度無法確認或和指定畫質不同時，不可把 rendition 標為完成。
- 影片畫質不影響本流程的 Whisper 速度。轉錄使用獨立 `audio.m4a`。不要為了轉錄速度降低播放畫質。
- 先在一般瀏覽器確認影片確實可由使用者觀看。
- 年齡、會員、私人或地區限制不能靠本 INSU 工作流程規避。
- `--cookies-from-browser` 會讀取登入工作階段，屬於敏感權限。只有使用者明確要求、理解風險且有權存取時才使用。
- 不匯出 cookie 到 repository，不把 cookie 貼進聊天。完成後依需要登出或撤銷工作階段。

## 找不到目標語言字幕

先確認使用者是否在字幕取得前選擇翻譯並以一般語言名稱說明目標語言。Agent 負責從音訊偵測來源語言並正規化 BCP 47 與模型參數，不得把語言碼、provider 或 processor 的責任交給使用者。轉錄必須讀取「轉錄設定」中目前選用且已就緒的精確模型 ID，不得接受命令列覆寫。翻譯模式不得檢查或下載任何平台字幕。來源 timed units 必須由本機或經本次明確 API 上傳同意的選定模型從原始音訊產生。若 schema-version 3 `transcript.json` 缺少 exact processor identity、words、resolved language、engineLanguage 或 chunk metadata，使用同一個已固定且已授權的模型重新轉錄。不要修補舊 transcript，不要自動 fallback 到另一個 provider，也不要把 Whisper 的英語 translation task 當成任意目標語言翻譯。

## VTT 已下載但播放器顯示 0 cues

- 確認檔案以 `WEBVTT` 開頭。
- 確認至少有一行 `00:00:00.000 --> 00:00:01.000` 格式的時間戳。
- YouTube VTT 可能在時間戳與文字間插入空行。模板 parser 已兼容，但仍要檢查內容不是空檔或錯誤頁面。
- 確認檔案是 UTF-8，而且沒有把 JSON 或 HTML 錯誤內容存成 `.vtt`。

## 首頁顯示處理中，但 terminal 已經停止

首頁會檢查 active operation 的 PID 和最後更新時間。程序消失超過約 45 秒後，`effectiveState` 會顯示「已中斷」，但不會擅自修改 SQLite 中的原始 operation event。先打開詳細資料看 log，確認 active rendition、音訊或 VTT 是否已完成，再只重跑對應命令。「畫質管理」的 operation 若失去 live PID，會顯示為可重試的「已中斷」。

不要只把狀態手動改成 `ready`。`ready` 但 media catalog 缺少 active rendition 或檔案會被首頁視為失敗。

## 首頁可以開，但影片拖曳或播放失敗

請使用 `serve-library.sh`。一般靜態 server 沒有 job API，也不保證正確處理 Range request。

```bash
plugins/insu-player/skills/watch-video/scripts/serve-library.sh <workspace>
```

確認瀏覽器 network 中 `/media/VIDEO_ID/video` 回傳 `200` 或 `206`，並查看 active rendition 對應 run 的 `media-info.txt` 是否列出視訊與音訊 stream。影片庫只接受 `media-work/catalog.json` 登記且位於 `source/renditions/` 的 active rendition。

## `file://` 可以播放影片但字幕載入失敗

瀏覽器通常會限制本機頁面 `fetch` 其他檔案。日常使用 `serve-library.sh`。獨立 export 才使用 `serve-player.sh`。不要直接雙擊 HTML。

## 離線時播放器無法顯示

模板沒有外部 CDN，使用瀏覽器原生 `<video controls>`。若影片不能播，檢查：

- `media-work/catalog.json` 的 active rendition 檔案是否存在
- 瀏覽器是否支援影片 codec
- `media-info.txt` 是否顯示視訊與音訊 stream
- HTTP server 的 terminal 是否回傳 404

## Whisper 安裝失敗

- 確認使用 Python 3.11 和 workflow-local `.venv`。
- 若 `tiktoken` 缺少適用 wheel，Whisper 上游可能要求 Rust。先保存完整錯誤，再依上游 README 安裝 Rust，不要直接修改系統 Python。
- 公司網路若有 TLS proxy，說明憑證問題。不要關閉 TLS 驗證作為長期解法。

## Whisper 模型下載中斷或磁碟不足

- 用 `doctor.sh` 檢查可用空間。
- 刪除前先確認模型目錄只屬於此 workflow：`<workspace>/.agent-tools/insu-player/models/`。
- 可以改用較小模型，例如 `small`，但要重新抽查品質。
- 不要把未完成模型移到 repository 或誤認為有效模型。

## Apple Silicon 出現 MPS／Torch segmentation fault

此流程預設使用 CPU。若手動指定 MPS 後 crash，改回：

```bash
transcribe.sh <workspace> <video-id> --mode proofread --language und --output-language und --device cpu
```

CPU 可能較慢，但通常比反覆 crash 更可預期。

## 字幕逐漸不同步

- 比較 MP4 和音訊來源的實際 duration。
- 確認轉錄使用的音訊來自同一支影片版本。
- 檢查是否在翻譯時合併 cue 卻沒有保留原時間。
- 開頭準確、末段偏移通常是來源時基或剪輯版本不同，不是單一句翻譯問題。

## Port 已被占用

先保留本次已選定的 workspace。Port 被占用不表示應改用該 port 背後的服務或 workspace。不要因對方已有 runtime、jobs 或正在運作就跨專案沿用。

一般啟動不要指定 port：

```bash
serve-library.sh <workspace>
```

Hono/Bun 服務會先獨占探測 `8000`。若已被占用，就由作業系統分配可用 localhost port，並將實際 `host`、`port`、`pid` 與 runtime 寫入 `<workspace>/.insu-player-server.json`。讀取啟動輸出或該檔案後開啟實際網址，不要猜測下一個 port。

只有當 `.insu-player-server.pid`、`.insu-player-server.json` 與 live process 都屬於本次選定的 workspace，才能把既有程序視為同一個影片庫。若是另一個 workspace 的 server，讓它繼續運作。只有確定是本次 workspace 的上一個 server 時，才回到其 terminal 按 `Ctrl+C`。不要任意終止不確定來源的程序。

## 首頁沒有出現新影片

- 確認 `app.db` 的 `media_items` 存在該 `video_id`。
- media record 必須符合現行 schema 1，而且 `videoId` 只能含英數字、底線與連字號。
- 首頁每 2.5 秒更新。可按右上重新整理按鈕。
- 確認啟動 server 時使用的是同一個 workspace。
- 看 terminal 是否有 `/api/jobs` 的 `500`。資料契約不合時不修補舊列，對該影音做精確移除後重建。

## iframe modal 是黑畫面

- 等待 player 的 metadata 載入。大型 MP4 第一個 Range request 可能稍久。
- 開啟詳細資料的「畫質管理」，確認 job 有可觀看的 active rendition。
- 確認瀏覽器原生 controls 已顯示。頁面不需要任何 CDN。
- Active rendition codec 不相容時重新檢查對應的 `media-info.txt`。不要直接覆蓋現用副本，應產生並驗證新的 rendition 後再切換。

## 翻譯檔匯入失敗

校正或翻譯 revision 先用 `reflow_subtitles.py validate-pair` 驗證完整句 input/output 軌。切分 revision 還要先用 `segment_subtitles.py validate` 檢查 frozen output、width、source spans、anchors 與 risky/blocked boundaries。最後統一用 `import-subtitle-revision.sh` 匯入，不要用來源單軌 `import-caption.sh`。成對軌必須有相同 cue ID、數量與時間。空文字、時間重疊、換行或內部 marker 都會拒絕。每個 revision 都寫入新的 immutable artifact 目錄，既有 revision 不允許覆寫。
