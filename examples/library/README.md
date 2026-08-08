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

完整流程與狀態恢復規則請讀 [Xeruca watch-video skill](../../plugins/xeruca-player/skills/watch-video/SKILL.md)。
