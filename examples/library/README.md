# 本機影片庫範例契約

Repository 不提交影片、字幕、模型或實際 job。完成一次處理後，workspace 會有：

```text
work/xeruca-player/
├── .agent-tools/xeruca-player/
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
plugins/xeruca-player/skills/watch-video/scripts/serve-library.sh work/xeruca-player 8000
```

首頁會把 `VIDEO_A` 顯示為完成且可觀看，把 `VIDEO_B` 顯示為待轉錄但仍可先播放。加入第三、第四支影片時沿用同一個 workspace 和首頁。

首頁 navbar 提供開始使用、進階使用、支援網站、介面設定、環境變數、模型列表與影片列表。模型列表會顯示實際下載的本機模型大小，以及 API SDK 與 API Key 是否已設定；影片列表則顯示 job 狀態並在同頁 modal 內播放。

完整流程與狀態恢復規則請讀 [INSU watch-video skill](../../plugins/xeruca-player/skills/watch-video/SKILL.md)。
