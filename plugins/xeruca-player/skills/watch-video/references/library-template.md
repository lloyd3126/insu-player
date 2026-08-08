# 本機影片庫首頁模板

這個模板是 `xeruca-player` 流程的固定首頁。它不需前端建置工具或外部 CDN；`library_server.py` 提供同源 JSON API、影片 Range request、縮圖、VTT、播放器頁面，以及唯一可寫的播放進度端點。

## 介面契約

- `/`：固定影片庫首頁
- `/api/jobs`：所有任務的即時摘要
- `/api/jobs/<video-id>`：單一任務、歷程與產物資訊
- `/api/jobs/<video-id>/log`：執行紀錄末段
- `PUT /api/jobs/<video-id>/playback`：只寫入該 job 的 `ui-state.json`
- `/watch/<video-id>/`：可獨立開啟、也可嵌入 iframe 的播放器
- `/media/<video-id>/video`：支援 HTTP Range 的 MP4
- `/captions/<video-id>/<language>.vtt`：字幕

首頁每 2.5 秒更新一次。播放時使用單一 iframe modal，關閉後會清除 `src` 以停止解碼；播放進度存於同一 job 的 `ui-state.json`，刪除專案資料夾時會一起移除，不使用瀏覽器 `localStorage`。

## 安全邊界

首頁刻意只有觀察、搜尋、篩選、查看紀錄與播放功能。除了播放位置，新增、重試、取消、翻譯與刪除都由 Agent 或 Xeruca workflow 腳本執行。伺服器只允許預定路由，而且只綁定 localhost，不會把 `.agent-tools`、模型或任意工作區檔案公開出去。

## 啟動

```bash
plugins/xeruca-player/skills/watch-video/scripts/serve-library.sh <workspace> 8000
```

然後開啟 <http://127.0.0.1:8000/>。首頁依賴 `library_server.py`，不能使用一般靜態伺服器取代。
