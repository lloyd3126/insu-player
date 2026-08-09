# INSU Player agent guide

本 repository 以 Codex skills 為唯一操作入口。先選擇 `.agents/skills/` 中符合任務的 skill；該入口會要求完整讀取 `plugins/insu-player/skills/` 的 canonical skill。使用者本次明確指示永遠優先。

## Runtime boundary

- Release ZIP 預設 workspace 是 `.local/insu-player/`。
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
- 不需要翻譯時優先使用來源既有字幕；沒有字幕才轉錄。
- 取得字幕前先確認是否需要繁中翻譯。需要翻譯時再要求選擇本機或 OpenAI 模型，且禁止取得任何平台字幕；模型從原始音訊產生英文詞級時間，重建完整英文句子並完成初譯與潤色後，英文與繁中共用句級時間段，逗號與句號改為半形空格，再成對匯入兩軌。
- 程式修改後執行全部測試、五個 skill validator、plugin validator 與 release 建置測試。

完整 skill 的唯一來源位於 `plugins/insu-player/skills/`；`.agents/skills/` 只做 repository discovery bridge，不要複製業務邏輯。
