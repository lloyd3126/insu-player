# 進階使用與「我的提示」

首頁 navbar 的「進階使用」是唯讀提示庫。內建提示隨 INSU Player 發布，使用者自己的提示保存在 workspace 根目錄：

```text
<workspace>/prompts.json
```

瀏覽器只透過 `GET /api/prompts` 讀取與複製，不提供新增、修改或刪除端點。使用者把 modal 下方的管理指令貼給 Agent 後，Agent 使用 `prompt_library.py` 更新資料；不可直接以不完整 JSON 覆寫檔案。

## 列出提示

```bash
python3 plugins/xeruca-player/skills/watch-video/scripts/prompt_library.py \
  list <workspace>
```

## 新增提示

ID 只能使用小寫英數、連字號與底線，且不可重複：

```bash
python3 plugins/xeruca-player/skills/watch-video/scripts/prompt_library.py \
  add <workspace> \
  --id bilingual-review \
  --title '雙語複習' \
  --scenario '保留原文與繁中字幕，方便反覆切換。' \
  --prompt '請把這支影片加入 INSU Player，並保留原文與繁體中文字幕：VIDEO_URL'
```

## 修改提示

先執行 `list` 確認精確 ID，再只提供要改的欄位：

```bash
python3 plugins/xeruca-player/skills/watch-video/scripts/prompt_library.py \
  update <workspace> bilingual-review \
  --prompt '請把這支影片加入 INSU Player，保留原文字幕並準備繁中字幕：VIDEO_URL'
```

## 移除提示

只有使用者明確要求移除時才執行：

```bash
python3 plugins/xeruca-player/skills/watch-video/scripts/prompt_library.py \
  remove <workspace> bilingual-review
```

所有寫入均先驗證欄位、限制最多 100 則，再以暫存檔 atomic replace。首頁重新開啟「進階使用」modal 時會重新讀取，無需重啟服務。
