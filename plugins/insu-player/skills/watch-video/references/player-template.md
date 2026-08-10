# INSU 本機字幕播放器模板

這是一個不需要建置工具或外部 CDN 的靜態播放器。它使用瀏覽器原生 `<video controls>` 播放本機 MP4，以 JavaScript 讀取外部 VTT，並依影片時間切換字幕。

模板有兩種用途：影片庫透過 `/watch/<video-id>/?embed=1` 動態注入設定並放在 iframe modal。`prepare-player.sh` 則可選擇性匯出一支獨立播放器。嵌入模式會用同源 `postMessage` 回報 ready、播放時間與狀態，並接受 pause、seek 與字幕切換命令。

## 完成資料夾

```text
player/
├── index.html
├── config.js
├── video.mp4
├── captions.zh-TW.vtt
├── captions.en.vtt
└── media-info.txt                  # prepare-player.sh 產生的檢查資訊
```

固定檔名是預設值，不是硬限制。可以在 `config.js` 修改影片和字幕來源。

## 從完全沒有工具開始

如果還沒有影片、字幕、Python、FFmpeg、yt-dlp 或 Whisper，請從 [INSU watch-video skill](../SKILL.md) 開始。該流程會先檢查環境，再把工具安裝到隔離的工作資料夾，並提供完整移除方式。

如果已經有上面五個檔案，只需要一個本機 HTTP server。可以使用 INSU 工作流程安裝的 Python：

```bash
plugins/insu-player/skills/watch-video/scripts/serve-player.sh \
  <workspace> \
  <player-directory> \
  8000
```

也可以使用電腦上既有的 Python：

```bash
python3 -m http.server 8000 --bind 127.0.0.1 --directory <player-directory>
```

接著開啟 <http://127.0.0.1:8000/>。不要直接以 `file://` 雙擊 HTML，瀏覽器可能會阻擋 VTT 的 `fetch`。

## 設定

`config.js` 支援：

- `title`：瀏覽器標題與頁面主標
- `kicker`：主標上方的小字
- `video.src` 與 `video.type`：影片路徑和 MIME type
- `defaultLanguage`：首次載入的字幕代碼
- `captions`：字幕代碼、顯示名稱和 VTT 路徑

新增字幕時，把 VTT 放進播放器資料夾，再增加一個 `captions` 項目。字幕必須使用 UTF-8、以 `WEBVTT` 開頭，而且至少含一組有效時間戳。

## 首次驗證

- [ ] HTTP server terminal 沒有 `404`
- [ ] 影片可播放且有聲音
- [ ] 頁面顯示的影片長度合理
- [ ] 預設字幕顯示 cue 數，不是 0
- [ ] 字幕選單可切換繁中、英文與關閉
- [ ] 拖曳到中段和末段後字幕仍同步
- [ ] 斷網重新整理時，原生播放器仍能播放本機影片

## 日常使用

影片庫的日常入口是 `serve-library.sh`，不需要替每支影片建立 `player/`。再次使用只要重新啟動同一個 server，首頁會掃描 `jobs/<video-id>/`。

只有需要攜出單支影片時，才用 `prepare-player.sh` 建立固定命名的 export。它會先驗證 VTT 和媒體，再複製模板與素材。

## 更新模板

先保留自己的 `video.mp4`、VTT 和 `config.js`，再從 repository 更新 `index.html`。若新版 `config.js` 結構改變，先比較差異，不直接覆蓋自訂設定。

## 停止與移除

1. 回到 HTTP server terminal 按 `Ctrl+C`。
2. 只要停止使用，不需要刪除任何檔案。
3. 要移除播放器時，先確認資料夾內是否有唯一一份影片或字幕備份，再刪除精確的 player 目錄。
4. 要同時移除 Whisper、yt-dlp、uv、Deno、模型與快取，使用 INSU 工作流程的 `uninstall.sh` 先做 dry run。
5. 播放器只包含資料夾內的 HTML、JavaScript、MP4 與 VTT，沒有前端套件需要 uninstall。

使用者影片、字幕和翻譯是產物，預設不會跟著工具移除。
