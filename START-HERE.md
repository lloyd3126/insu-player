# 從這裡開始

用 Codex 開啟整個解壓縮後的 `insu-player-vVERSION` 資料夾，然後貼上：

> 請使用 $watch-video，第一個動作先啟動 INSU Player 首頁並用 Codex 內建瀏覽器開啟，保持首頁開啟後再執行環境檢查。所有工具、模型、cache、影音與字幕都必須留在這個資料夾。說明本機與 OpenAI API 模型的差異，並在取得字幕前問我要做同語言校正或翻譯、來源語言，以及翻譯時的目標語言，再把這支影音加入影音庫：VIDEO_URL

預設工作區是：

```text
<解壓縮資料夾>/.local/insu-player/
```

常用指令：

```bash
scripts/portable/serve.sh
scripts/portable/doctor.sh
scripts/portable/setup.sh --provider local --model medium
scripts/portable/add-video.sh 'VIDEO_URL' --translate zh-TW --provider local
scripts/portable/update.sh
scripts/portable/uninstall.sh
```

第一個動作先用 Codex 內建瀏覽器開啟服務回報的實際網址，不要等影片處理完成才開啟。首頁服務會先在 workspace 安裝自己的 Bun runtime，再啟動 Hono；服務優先使用 `http://127.0.0.1:8000/`，若該 port 已被占用，會先做獨占探測、取得可用 port，並把實際 endpoint 記錄在 `.local/insu-player/.insu-player-server.json`。首次完整媒體環境安裝需要網路、時間與數 GB 空間。API 模式會上傳音訊且可能收費，沒有使用者本次明確同意就不要執行。

翻譯使用 `--translate TARGET_BCP47 --provider local|openai`，同語言校正使用 `--proofread --provider local|openai`。兩條路徑都只接受創作者人工 CC 或模型轉錄；人工 CC 可直接播放並作為文字參考，平台自動字幕一律排除。選定模型必須從原始音訊產生來源語言 timed units；`translate-subtitles` 或 `proofread-subtitles` 先完成完整句內容，`segment-subtitles` 再獨立切分並對齊來源時間。

首頁的「開始使用」提供 YouTube 對話範例；「支援網站」會讀取 workspace 內 yt-dlp 的實際支援清單；功能設定中的「本機模型」與「雲端模型」分頁可分別確認下載大小、API SDK 與 API Key 設定狀態；「影音中心」則集中顯示處理進度與播放器。

需要 OpenAI API 時，可以從首頁「環境變數」輸入 `OPENAI_API_KEY`。Key 只存在本次本機服務程序，不會寫入 `.env`、job、log 或 metadata，停止或重新啟動服務後需要重新輸入。
