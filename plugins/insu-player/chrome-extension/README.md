# INSU Player Chrome Extension

這個資料夾就是未封裝的 Chrome Extension，不需建置或上架商店。

1. 在 Chrome 開啟 `chrome://extensions/`。
2. 開啟「開發人員模式」。
3. 點「載入未封裝項目」，選擇本資料夾。
4. 回到 INSU Player 首頁，從 navbar 開啟「Chrome 擴充功能 → 連接」完成配對。

擴充功能只連接使用者主動配對的 localhost INSU Player。一般加入只讀取目前分頁。iframe、M3U8 或登入狀態需要額外權限時，會在當下說明並取得同意。Cookie 只會傳到本機服務的短期工作階段，不會寫入 app.db 或工作紀錄。
