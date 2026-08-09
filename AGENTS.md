# INSU Player agent guide

本 repository 以 Codex skills 為唯一操作入口。先選擇 `.agents/skills/` 中符合任務的 skill；該入口會要求完整讀取 `plugins/insu-player/skills/` 的 canonical skill。使用者本次明確指示永遠優先。

## Runtime boundary

- Release ZIP 預設 workspace 是 `.local/insu-player/`。
- Developer checkout 或 plugin 模式必須使用使用者指定專案內的專用 workspace；不要默默寫入 home directory。
- 禁止 `sudo`、Homebrew、apt、全域 pip 與全域 npm。uv、Python、Deno、FFmpeg、yt-dlp、Whisper、模型及 workflow cache 都必須位於 workspace。
- 執行任何 Bun、Vite、測試或建置指令前，先在同一個 shell process 將 `<workspace>/.agent-tools/insu-player/bun-runtime/bin` 加入 `PATH`；本 repository 預設即為 `.local/insu-player/.agent-tools/insu-player/bun-runtime/bin`。不要只用絕對路徑呼叫最外層 Bun，因為 `bun run` 內的巢狀腳本仍會再次解析 `bun`，且不得假設使用者已安裝全域 Bun。
- `OPENAI_API_KEY` 只能來自目前 process environment；不可寫入檔案、log、metadata 或回覆。
- API 上傳需要本次任務的明確授權與 `--allow-api-upload`／`--consent-to-upload`。

## Media safety

- 先確認使用者有權下載與處理媒體。
- 不繞過 DRM、付費牆、會員、私人存取、地區限制或帳號控制。
- 刪除前先解析精確 workspace/job 路徑；預設只移除可重建檔案並保留影片與字幕。
- 完整移除單一 library resource 必須先用 `video-library` removal protocol 產生唯讀 preview，取得使用者對該次 plan digest 的明確確認後才能 execute，最後必須 verify；不得接受提示中的任意檔案路徑。
- 不要自行刪除 repository root。完整移除時先停止服務，預覽清理範圍，再取得使用者對生成資料與資料夾移除的確認。

## Product behavior

- `$watch-video` 是對使用者的主要入口。
- 固定首頁是唯一觀看入口；播放器在同源 iframe modal 內開啟。
- `status.json`、job history 與 log 是中斷復原的事實來源。
- 不需要翻譯時優先使用來源既有字幕；沒有字幕才轉錄。
- 取得字幕前先確認是否需要翻譯與目標 BCP 47 語言。需要翻譯時再要求選擇本機或 OpenAI 模型，且禁止取得任何平台字幕；模型從原始音訊產生來源語言的詞級或 Token 時間，`translate-subtitles` 重建完整句並完成初譯與潤色，`segment-subtitles` 再以 target-first 固定目標語切分並對齊連續來源時間，驗證後成對匯入兩軌。
- 程式修改後執行全部測試、六個 skill validator、plugin validator 與 release 建置測試。

完整 skill 的唯一來源位於 `plugins/insu-player/skills/`；`.agents/skills/` 只做 repository discovery bridge，不要複製業務邏輯。
