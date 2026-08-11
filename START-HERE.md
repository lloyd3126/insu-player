# 從這裡開始

用 Codex 開啟整個解壓縮後的 `insu-player-vVERSION` 資料夾，然後貼上：

> 使用 $watch-video 初始化 INSU Player。先開啟專案首頁，再安裝所有依賴、雲端 STT SDK、SQLite 與 Whisper medium。所有工具、模型、cache、影音與字幕都必須留在這個資料夾。完成後停在首頁，請我打開「開始說明 → 加入影音」並貼上網址，不要直接詢問網址或技術選項。

預設工作區是：

```text
<解壓縮資料夾>/.local/insu-player/
```

常用指令：

```bash
scripts/portable/serve.sh
scripts/portable/doctor.sh
scripts/portable/setup.sh --model medium
scripts/portable/add-video.sh 'VIDEO_URL' --translate zh-TW --language und
scripts/portable/update.sh
scripts/portable/uninstall.sh
```

第一個動作先用 Codex 內建瀏覽器開啟服務回報的實際網址，不要等影片處理完成才開啟。首頁服務會先在 workspace 安裝自己的 Bun runtime，再啟動 Hono。服務優先使用 `http://127.0.0.1:8000/`，若該 port 已被占用，會先做獨占探測、取得可用 port，並把實際 endpoint 記錄在 `.local/insu-player/.insu-player-server.json`。首次完整媒體環境安裝需要網路、時間與數 GB 空間。API 模式會上傳音訊且可能收費，沒有使用者本次明確同意就不要執行。

使用者只需要在首頁貼上網址，再用一般語言回答要整理原語字幕或翻譯，以及翻譯時想要的語言。來源語言由音訊偵測。第一次安裝會自動選用已驗證的 Whisper medium。之後若要更換轉錄模型，使用者可直接到「轉錄設定」操作，不需要在對話中回答模型、provider、processor、語言碼或命令參數。

翻譯與同語言校正都沿用「轉錄設定」目前選用的精確模型。支援本機 Whisper、OpenAI、Groq、ElevenLabs、xAI 與 OpenRouter，且不會自動切換或 fallback。兩條路徑都只接受創作者人工 CC 或模型轉錄。人工 CC 可直接播放並作為文字參考，平台自動字幕一律排除。轉錄模型必須從原始音訊產生來源語言 timed units，雲端 API 只能用於這個音訊轉錄階段。`translate-subtitles` 或 `proofread-subtitles` 由目前 Agent 先審查完整句邊界並完成內容，`segment-subtitles` 再由目前 Agent 獨立切分並做語義 Source Alignment。

首頁的「開始說明」以「初始化」、「下一步」、「加入影音」與「操作流程」四個 tabs 分開說明，每個 tab 只放一個主要段落。加入影音提供網址欄位並產生已帶入網址的完整提示。若只想先下載多支影音，可點首頁的「加入影音」，逐行貼上最多 50 個單支網址、確認權利後送出。下載由介面直接管理，不需要 Agent，完成後再複製提示請 Agent 接續字幕。

首頁 navbar 依序提供「開始說明」、「我的提示」、「轉錄設定」、「支援網站」、「擴充功能」與「影片中心」，全部使用純文字。「我的提示」與「支援網站」各自使用獨立 modal。「支援網站」會讀取 workspace 內 yt-dlp 的實際支援清單。「轉錄設定」以同一張表格列出本機與雲端轉錄模型，使用者可選用模型並從詳情下載、驗證、移除或設定對應 provider Key。「影片中心」集中顯示處理進度、依狀態產生的下一步與播放器。

若想從 Chrome 目前分頁直接加入影音，從首頁 navbar 開啟「擴充功能」，依照「安裝」、「連接」與「使用」三個 tabs 載入 `plugins/insu-player/chrome-extension/` 並完成 localhost 配對。登入狀態只會在使用者當下確認後供一次下載使用，不會保存到資料庫。

完成有效的校正或翻譯字幕後，可到詳情的「影音摘要」複製提示。`$summarize-video` 先建立文字摘要 revision，`$map-video-summary` 再從指定文字摘要建立 Markmap revision。這兩個 skill 不會修改影音或字幕，也不會覆寫舊摘要。

需要雲端語音轉錄時，可以從首頁「環境變數」輸入所選服務的 API Key。Key 只存在本次本機服務程序，不會寫入 `.env`、job、log 或 metadata，停止或重新啟動服務後需要重新輸入。
