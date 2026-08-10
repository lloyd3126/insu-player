# INSU Player agent guide

本 repository 以 Codex skills 為唯一操作入口。先選擇 `.agents/skills/` 中符合任務的 skill。該入口會要求完整讀取 `plugins/insu-player/skills/` 的 canonical skill。使用者本次明確指示永遠優先。

## Runtime boundary

- Release ZIP 預設 workspace 是 `.local/insu-player/`。
- Developer checkout 或 plugin 模式必須使用使用者指定專案內的專用 workspace。不要默默寫入 home directory。
- 禁止 `sudo`、Homebrew、apt、全域 pip 與全域 npm。uv、Python、Deno、FFmpeg、yt-dlp、Whisper、模型及 workflow cache 都必須位於 workspace。
- 執行任何 Bun、Vite、測試或建置指令前，先在同一個 shell process 將 `<workspace>/.agent-tools/insu-player/bun-runtime/bin` 加入 `PATH`。本 repository 預設即為 `.local/insu-player/.agent-tools/insu-player/bun-runtime/bin`。不要只用絕對路徑呼叫最外層 Bun，因為 `bun run` 內的巢狀腳本仍會再次解析 `bun`，且不得假設使用者已安裝全域 Bun。
- `OPENAI_API_KEY` 只能來自目前 process environment。不可寫入檔案、log、metadata 或回覆。
- API 上傳需要本次任務的明確授權與 `--allow-api-upload`／`--consent-to-upload`。

## Media safety

- 先確認使用者有權下載與處理媒體。
- 不繞過 DRM、付費牆、會員、私人存取、地區限制或帳號控制。
- 刪除前先解析精確 workspace/job 路徑。預設只移除可重建檔案並保留影片與字幕。
- 完整移除單一 library resource 必須先用 `video-library` removal protocol 產生唯讀 preview，取得使用者對該次 plan digest 的明確確認後才能 execute，最後必須 verify。不得接受提示中的任意檔案路徑。
- 不要自行刪除 repository root。完整移除時先停止服務，預覽清理範圍，再取得使用者對生成資料與資料夾移除的確認。

## Product behavior

- `$watch-video` 是對使用者的主要入口。
- 下載、安裝、轉錄、指定畫質或其他長時間工作超出目前 turn 時，使用 `$monitor-player-job` 建立附著目前 task 的 heartbeat。排程只負責重新喚醒 Agent。`status.json`、job history、media catalog 與 log 仍是事實來源。不得建立 standalone task、worktree、sleep 輪詢、cron、daemon 或資料庫 fallback。完成、重複失敗或需要使用者決策時停止 heartbeat。
- 固定首頁是唯一觀看入口。播放器在同源 iframe modal 內開啟。
- `status.json`、job history 與 log 是中斷復原的事實來源。
- 來源字幕只接受創作者人工 CC 或由模型從原始音訊產生的轉錄。平台自動字幕一律不得下載、匯入或作為參考。人工 CC 可立即播放，也可作為文字與術語參考，但不能作為細粒度 timing。
- 把使用者視為第一次使用且不了解技術名詞的人。網頁提示一次只要求貼上網址。Agent 只用一般語言確認下載權利、要整理原語字幕或翻譯、翻譯目標語言，以及實際資料處理邊界。不得要求使用者選 skill、模型名稱、provider、processor、timing、content、segmentation、artifact、Source Alignment、BCP 47 或模型參數。
- 來源語言預設由 timing 模型從音訊偵測。只有無法可靠辨識、多語混用或語系差異會影響結果時，才用一般語言名稱追問。Agent 必須在內部正規化保存用 BCP 47 tag，再轉成所選模型接受的參數。
- Agent 先唯讀檢查環境並提出一個安全建議。預設使用本機 Whisper medium 建立細粒度時間，再由目前 Agent 讀取轉錄文字完成內容與切分。若實際使用 API，必須先用白話說明會上傳音訊、字幕文字或兩者、可能費用與本機替代方案，再取得本次明確同意。內部仍要分別記錄 timing、內容與切分 processor。
- `proofread-subtitles` 負責同語言完整句校正，`translate-subtitles` 負責跨語言完整句初譯與潤色，`segment-subtitles` 再獨立以 output-first／target-first 固定切分並對齊連續來源時間。三個階段必須各自記錄 processor，不得互相替代。只有影音可播放、完整句字幕與切分字幕都驗證並匯入後，才可宣告整體完成。
- 目前沒有外部使用者。資料契約採 clean break。舊 job、舊 transcript 或舊 manifest 不做 migration、coercion、fallback 或 legacy reader，直接視為不支援並重建。
- 字幕管理介面只允許使用者直接切換目前播放版本與刪除字幕。製作、校正、翻譯、切分及重試都由固定提示交給 Agent 與對應 skill 執行。
- 所有網頁文案、網頁可複製提示、plugin 試用提示、skill Agent 提示與文件中的示範提示都不得使用全形的 semicolon 字元。
- 程式修改後執行全部測試、八個 skill validator、plugin validator 與 release 建置測試。

完整 skill 的唯一來源位於 `plugins/insu-player/skills/`。`.agents/skills/` 只做 repository discovery bridge，不要複製業務邏輯。
