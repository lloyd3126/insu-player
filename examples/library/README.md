# 本機影片庫範例契約

Repository 不提交影片、字幕、模型或實際 job。完成一次處理後，workspace 會有：

```text
.local/insu-player/
├── .agent-tools/insu-player/
└── jobs/
    ├── VIDEO_A/
    │   ├── status.json
    │   ├── source/video.mp4
    │   ├── captions/en.vtt
    │   ├── captions/zh-TW.vtt
    │   └── logs/workflow.log
    └── VIDEO_B/
        ├── status.json              # 例如 needs_transcription
        ├── source/video.mp4
        └── logs/workflow.log
```

啟動：

```bash
plugins/insu-player/skills/watch-video/scripts/serve-library.sh .local/insu-player 8000
```

首頁會把 `VIDEO_A` 顯示為完成且可觀看，把 `VIDEO_B` 顯示為待轉錄但仍可先播放。加入第三、第四支影片時沿用同一個 workspace 和首頁。

首頁 navbar 提供使用說明、功能設定與影音中心。使用說明以分頁整合開始使用、我的提示與支援網站，內建使用情境提示位於「我的提示」建立卡下方；功能設定以分頁整合環境變數、本機模型與雲端模型。本機模型會顯示實際下載大小，雲端模型會顯示 API SDK 與 API Key 是否已設定；影音中心在頂部以「我的影音」與「詳細資訊」tabs 切換，前者只顯示全寬搜尋列和卡片，後者顯示摘要、篩選與列表。

支援網站會在搜尋列上方提供一張「詢問 Agent 是否支援」提示卡，整合 yt-dlp 更新與平台研究流程。

完整流程與狀態恢復規則請讀 [INSU watch-video skill](../../plugins/insu-player/skills/watch-video/SKILL.md)。
