# 我的提示

首頁 navbar 的「我的提示」會開啟獨立的唯讀提示庫。內建提示顯示在建立提示卡下方，使用者自己的提示保存在 workspace 根目錄：

```text
<workspace>/prompts.json
```

瀏覽器只透過 `GET /api/prompts` 讀取與複製，不提供新增、修改或刪除端點。使用者把 modal 下方的管理提示貼給 Agent 後，Agent 使用 `prompt_library.py` 更新資料。不可直接以不完整 JSON 覆寫檔案。

## 列出提示

```bash
python3 plugins/insu-player/skills/watch-video/scripts/prompt_library.py \
  list <workspace>
```

## 新增提示

ID 只能使用小寫英數、連字號與底線，且不可重複：

```bash
python3 plugins/insu-player/skills/watch-video/scripts/prompt_library.py \
  add <workspace> \
  --id bilingual-review \
  --title '雙語複習' \
  --scenario '保留原文與繁中字幕，方便反覆切換。' \
  --prompt '使用 $watch-video 協助我加入一支影音。先開啟首頁，再請我貼上單支影音網址。只用白話確認我想要的字幕結果，其餘技術選項由你檢查後提出建議。'
```

## 修改提示

先執行 `list` 確認精確 ID，再只提供要改的欄位：

```bash
python3 plugins/insu-player/skills/watch-video/scripts/prompt_library.py \
  update <workspace> bilingual-review \
  --prompt '使用 $watch-video 協助我加入一支影音。先開啟首頁，再請我貼上單支影音網址。來源語言由音訊偵測，翻譯時只問我想要哪種語言。'
```

## 移除提示

只有使用者明確要求移除時才執行：

```bash
python3 plugins/insu-player/skills/watch-video/scripts/prompt_library.py \
  remove <workspace> bilingual-review
```

所有寫入均先驗證欄位、限制最多 100 則，再以暫存檔 atomic replace。首頁重新開啟「我的提示」分頁時會重新讀取，無需重啟服務。
