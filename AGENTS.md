# INSU Player agent guide

本 repository 以 Codex skills 為唯一操作入口。先選擇 `.agents/skills/` 中符合任務的 skill。該入口會要求完整讀取 `plugins/insu-player/skills/` 的 canonical skill。使用者本次明確指示永遠優先。

## Runtime boundary

- Release ZIP 預設 workspace 是 `.local/insu-player/`。
- Developer checkout 或 plugin 模式必須使用使用者指定專案內的專用 workspace。不要默默寫入 home directory。
- 禁止 `sudo`、Homebrew、apt、全域 pip 與全域 npm。uv、Python、Deno、FFmpeg、yt-dlp、Whisper、模型及 workflow cache 都必須位於 workspace。
- 執行任何 Bun、Vite、測試或建置指令前，先在同一個 shell process 將 `<workspace>/.agent-tools/insu-player/bun-runtime/bin` 加入 `PATH`。本 repository 預設即為 `.local/insu-player/.agent-tools/insu-player/bun-runtime/bin`。不要只用絕對路徑呼叫最外層 Bun，因為 `bun run` 內的巢狀腳本仍會再次解析 `bun`，且不得假設使用者已安裝全域 Bun。
- INSU Player 首頁服務啟動時必須清除繼承自 Codex、terminal profile 或 parent process 的 `OPENAI_API_KEY`、`GROQ_API_KEY`、`ELEVENLABS_API_KEY`、`XAI_API_KEY` 與 `OPENROUTER_API_KEY`。首頁只能使用使用者從「轉錄設定」中對應雲端模型詳情設定的本次服務值。同一 provider 的模型共用一份 Key。直接執行轉錄工具時 Key 才能來自目前 process environment。Key 不可寫入檔案、log、metadata 或回覆。
- 雲端 API 只允許用於音訊轉錄。音訊上傳需要本次任務的明確授權與 `--consent-to-audio-upload`。選定 provider 後不得自動 fallback 到另一家服務或缺少 word timing 的路由。完整句重建、校正、翻譯、字幕切分與 Source Alignment 固定由目前 Agent 完成，不得將字幕文字送往另一個 API 模型。

## Media safety

- 先確認使用者有權下載與處理媒體。
- 不繞過 DRM、付費牆、會員、私人存取、地區限制或帳號控制。
- 刪除前先解析精確 workspace/job 路徑。預設只移除可重建檔案並保留影片與字幕。
- 完整移除單一 library resource 必須先用 `video-library` removal protocol 產生唯讀 preview，取得使用者對該次 plan digest 的明確確認後才能 execute，最後必須 verify。不得接受提示中的任意檔案路徑。
- 不要自行刪除 repository root。完整移除時先停止服務，預覽清理範圍，再取得使用者對生成資料與資料夾移除的確認。

## Product behavior

- `$watch-video` 是對使用者的主要入口。
- 下載、安裝、轉錄、指定畫質或其他長時間工作超出目前 turn 時，使用 `$monitor-player-job` 建立附著目前 task 的 heartbeat。排程只負責重新喚醒 Agent。SQLite 中的 media item、operation、event 與已註冊產物是事實來源，log 只用於診斷。不得建立 standalone task、worktree、sleep 輪詢、cron、daemon 或檔案狀態 fallback。完成、重複失敗或需要使用者決策時停止 heartbeat。
- 固定首頁是唯一觀看入口。播放器在同源 iframe modal 內開啟。
- Chrome Extension 只接受首頁「擴充功能」即時產生的當前專屬 ZIP。ZIP 內含綁定精確 loopback origin、protocol、build 與 data schema 的一次性啟用資格，安裝後自動連接，不得要求使用者另外下載或上傳設定檔，也不得掃描或猜測 port。啟用資格 30 分鐘失效且只能使用一次。SQLite 只保存 ticket hash，一次性 ticket 與成功認領後產生的 connection token 必須不同，原值禁止寫入 SQLite、log、metadata 或回覆。Extension 只能共用既有下載佇列與 `/extension/library` 卡片頁，不得建立第二套資料庫、下載器、播放器或 Agent 提示介面。頁面、iframe、直接媒體與 HLS 必須組成同一支影音的有序 yt-dlp 備援來源，不要求使用者選擇模式。使用者確認內容權利並加入時即同意傳送該來源組涉及的 Cookie，Cookie 只能進入短期記憶體工作階段與權限 `0600` 的暫存 jar，禁止寫入 SQLite、log、metadata 或回覆，工作結束與服務啟動時必須刪除。不得繞過 DRM，直播與受保護 HLS 必須直接拒絕。
- SQLite 中的 media item、operation event、artifact catalog 與 playback state 是中斷復原的唯一事實來源。
- Runtime 只接受現行 clean-break 資料契約：media record schema 3、model transcript schema 3、proofread／translation manifest schema 5、segmentation manifest schema 4、media catalog schema 1。舊版、缺欄或無效資料直接失敗，不得在 server、startup 或一般讀取路徑建立 migration、legacy reader、推定值或相容 fallback。
- 使用者在破壞性更新後明確要求保留既有資料時，只能使用獨立的 `$migrate-player-library` 做一次性遷移。舊 `app.db` 與 jobs 在 preview 和 staging 中唯讀，以目前 schema 與 validator 建立 current-shape 資料，取得 exact digest 確認後才可原子切換。無法證明的欄位不得猜測，無效衍生產物保留來源影音後重建。這個 skill 不得改變 runtime 的 clean-break 規則。
- 只沿用 build ID 與 data schema 都完全相同的 workspace server。若 descriptor 指向其他 build，必須明確停止該 workspace 的程序再重新啟動，server 不得自動終止或接管舊程序。
- 來源字幕只接受創作者人工 CC 或由模型從原始音訊產生的轉錄。平台自動字幕一律不得下載、匯入或作為參考。人工 CC 可立即播放，也可作為文字與術語參考，但不能作為細粒度 timing。
- 把使用者視為第一次使用且不了解技術名詞的人。網頁提示一次只要求貼上網址。Agent 只用一般語言確認下載權利、要整理原語字幕或翻譯、翻譯目標語言，以及實際資料處理邊界。不得在對話中要求使用者選 skill、模型名稱、provider、processor、timing、content、segmentation、artifact、Source Alignment、BCP 47 或模型參數。
- 來源語言預設由 timing 模型從音訊偵測。只有無法可靠辨識、多語混用或語系差異會影響結果時，才用一般語言名稱追問。Agent 必須在內部正規化保存用 BCP 47 tag，再轉成所選模型接受的參數。
- 「轉錄設定」中的單一模型目錄是後續新工作所用轉錄模型的唯一事實來源。初次安裝完成並驗證 Whisper medium 後自動選用它，不額外詢問新手。使用者之後可在同一表格確定性切換本機或雲端模型，並在模型詳情管理下載或 provider Key。執行端只能讀取並固定該次 `model_id`，不接受 provider 或 model 覆寫參數，不得由 Agent 自行切換或 fallback。雲端 timing 僅支援 OpenAI、Groq、ElevenLabs、xAI 與 OpenRouter 的明確契約。模型選用、API Key 已設定與音訊上傳同意是三個獨立狀態，實際使用雲端模型前仍必須用白話說明服務名稱、音訊上傳、可能費用與本機替代方案，再取得本次音訊轉錄的明確同意。內部仍要分別記錄 timing、內容與切分 processor，其中 content 與 segmentation 必須是 `agent / codex`。
- `proofread-subtitles` 負責由目前 Agent 建立完整句邊界並完成同語言校正，`translate-subtitles` 負責由目前 Agent 完成跨語言完整句初譯與潤色，`segment-subtitles` 再由目前 Agent 獨立以 output-first／target-first 固定切分並做語義 Source Alignment。不得使用字數、時間長度或比例分配取代語義對齊。三個階段必須各自記錄 processor，不得互相替代。只有影音可播放、完整句字幕與切分字幕都驗證並匯入後，才可宣告整體完成。
- 目前沒有外部使用者。資料契約採 clean break。一般 runtime 遇到舊 job、舊 transcript 或舊 manifest 不做 migration、coercion、fallback 或 legacy reader。未明確要求保存時直接視為不支援並重建。
- 字幕管理介面只允許使用者直接刪除字幕。播放器提供第一字幕與第二字幕兩個獨立語言選單，兩者不得選擇相同語言。影片中心的字幕樣式分頁以第一字幕、第二字幕與雙語字幕三個 tabs 分別管理單軌文字與背景樣式、雙軌間距，並可在兩個單軌設定間單向同步。製作、校正、翻譯、切分及重試都由固定提示交給 Agent 與對應 skill 執行。
- 所有網頁文案、網頁可複製提示、plugin 試用提示、skill Agent 提示與文件中的示範提示都不得使用全形的 semicolon 字元。
- 程式修改後執行全部測試、所有 skill validator、plugin validator 與 release 建置測試。

完整 skill 的唯一來源位於 `plugins/insu-player/skills/`。`.agents/skills/` 只做 repository discovery bridge，不要複製業務邏輯。
