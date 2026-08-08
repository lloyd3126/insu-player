# Xeruca Player agent guide

本 repository 以 Codex skills 為唯一操作入口。先選擇 `.agents/skills/` 中符合任務的 skill；該入口會要求完整讀取 `plugins/xeruca-player/skills/` 的 canonical skill。使用者本次明確指示永遠優先。

## Runtime boundary

- Release ZIP 預設 workspace 是 `.local/xeruca-player/`。
- Developer checkout 或 plugin 模式必須使用使用者指定專案內的專用 workspace；不要默默寫入 home directory。
- 禁止 `sudo`、Homebrew、apt、全域 pip 與全域 npm。uv、Python、Deno、FFmpeg、yt-dlp、Whisper、模型及 workflow cache 都必須位於 workspace。
- `OPENAI_API_KEY` 只能來自目前 process environment；不可寫入檔案、log、metadata 或回覆。
- API 上傳需要本次任務的明確授權與 `--allow-api-upload`／`--consent-to-upload`。

## Media safety

- 先確認使用者有權下載與處理媒體。
- 不繞過 DRM、付費牆、會員、私人存取、地區限制或帳號控制。
- 刪除前先解析精確 workspace/job 路徑；預設只移除可重建檔案並保留影片與字幕。
- 不要自行刪除 repository root。完整移除時先停止服務，預覽清理範圍，再取得使用者對生成資料與資料夾移除的確認。

## Product behavior

- `$watch-video` 是對使用者的主要入口。
- 固定首頁是唯一觀看入口；播放器在同源 iframe modal 內開啟。
- `status.json`、job history 與 log 是中斷復原的事實來源。
- 優先使用來源既有字幕；沒有字幕才轉錄。繁中翻譯必須保留 VTT 時間軸與 cue 順序。
- 程式修改後執行全部測試、五個 skill validator、plugin validator 與 release 建置測試。

完整 skill 的唯一來源位於 `plugins/xeruca-player/skills/`；`.agents/skills/` 只做 repository discovery bridge，不要複製業務邏輯。
