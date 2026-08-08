# 從這裡開始

用 Codex 開啟整個解壓縮後的 `insu-player-vVERSION` 資料夾，然後貼上：

> 請使用 $watch-video，先執行 INSU Player 環境檢查。所有工具、模型、cache、影片與字幕都必須留在這個資料夾。說明本機與 OpenAI API 轉錄的差異後，把這支影片加入影片庫：VIDEO_URL

預設工作區是：

```text
<解壓縮資料夾>/.local/insu-player/
```

常用指令：

```bash
scripts/portable/doctor.sh
scripts/portable/setup.sh --provider local --model medium
scripts/portable/serve.sh 8000
scripts/portable/add-video.sh 'VIDEO_URL'
scripts/portable/update.sh
scripts/portable/uninstall.sh
```

首次本機安裝需要網路、時間與數 GB 空間。API 模式會上傳音訊且可能收費，沒有使用者本次明確同意就不要執行。完成後請用 Codex 內建瀏覽器開啟 `http://127.0.0.1:8000/`。

首頁的「開始使用」提供 YouTube 對話範例；「支援網站」會讀取 workspace 內 yt-dlp 的實際支援清單；「模型列表」可確認本機模型大小、API SDK 與 API Key 設定狀態；「影片列表」則集中顯示處理進度與播放器。

需要 OpenAI API 時，可以從首頁「環境變數」輸入 `OPENAI_API_KEY`。Key 只存在本次本機服務程序，不會寫入 `.env`、job、log 或 metadata，停止或重新啟動服務後需要重新輸入。
