# INSU Player Chrome Extension

這個資料夾是 Chrome Extension 原始碼。一般使用者應從 INSU Player 首頁的「擴充功能 → 下載」取得目前服務即時產生的專屬 ZIP。

1. 解壓縮從 INSU Player 下載的 ZIP。
2. 在 Chrome 開啟 `chrome://extensions/`。
3. 開啟「開發人員模式」。
4. 點「載入未封裝項目」，選擇解壓縮後的資料夾。
5. 點 Chrome 工具列中的 INSU Player。
6. 開啟擴充功能。它會讀取 ZIP 內的一次性啟用資格並自動連接。

ZIP 內的啟用資格只接受精確 loopback origin、目前 protocol、build 與 data schema，30 分鐘失效且只能使用一次。資料庫只保存 ticket hash，擴充功能不掃描其他連接埠。一般加入只讀取目前分頁，頁面、iframe、直接媒體與 M3U8 會自動成為同一支影音的 yt-dlp 備援來源，不要求使用者選擇模式。使用者確認內容權利並加入後，擴充功能會自動傳送這組來源需要的 Cookie 到本機短期工作階段，不會寫入 app.db 或工作紀錄。Chrome 首次仍可能顯示必要的權限提示。
