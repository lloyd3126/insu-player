# INSU Player Chrome Extension

這個資料夾就是未封裝的 Chrome Extension，不需建置或上架商店。

1. 在 Chrome 開啟 `chrome://extensions/`。
2. 開啟「開發人員模式」。
3. 點「載入未封裝項目」，選擇本資料夾。
4. 若先前已載入過同一資料夾，按該擴充功能卡片的「重新載入」。
5. 保持 INSU Player 首頁開啟，點 Chrome 工具列中的 INSU Player。
6. 按「連接目前的 INSU Player」。

擴充功能只連接使用者目前開啟並主動確認的 localhost INSU Player，不掃描其他連接埠。一般加入只讀取目前分頁。iframe、M3U8 或登入狀態需要額外權限時，會在當下說明並取得同意。Cookie 只會傳到本機服務的短期工作階段，不會寫入 app.db 或工作紀錄。
