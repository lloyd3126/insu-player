#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: download-video.sh <workspace> <youtube-url>\n'
}

if [ "$#" -eq 1 ] && { [ "$1" = "-h" ] || [ "$1" = "--help" ]; }; then usage; exit 0; fi
[ "$#" -eq 2 ] || { usage >&2; exit 1; }

caption_set_paths "$1"
caption_assert_safe_workspace
caption_require_runtime

video_url="$2"
mkdir -p "$CAPTION_YTDLP_CACHE"
common_args=(
  --ignore-config
  --js-runtimes "deno:$CAPTION_DENO"
  --ffmpeg-location "$CAPTION_BIN"
  --cache-dir "$CAPTION_YTDLP_CACHE"
  --no-playlist
  --newline
  --no-overwrites
)

caption_note "Resolving video metadata..."
metadata_json=$("$CAPTION_YTDLP" "${common_args[@]}" --skip-download --dump-single-json "$video_url")
video_id=$(printf '%s' "$metadata_json" | "$CAPTION_PYTHON" -c 'import json,sys; print(json.load(sys.stdin)["id"])')
video_title=$(printf '%s' "$metadata_json" | "$CAPTION_PYTHON" -c 'import json,sys; print(json.load(sys.stdin).get("title") or "")')
caption_validate_video_id "$video_id"

job_dir="$CAPTION_JOBS/$video_id"
source_dir="$job_dir/source"
youtube_caption_dir="$job_dir/youtube-captions"
caption_dir="$job_dir/captions"
mkdir -p "$source_dir" "$youtube_caption_dir" "$caption_dir" "$job_dir/logs"

caption_job_state init --job-dir "$job_dir" --video-id "$video_id" --source-url "$video_url" --title "$video_title" >/dev/null
caption_job_state update --job-dir "$job_dir" --state checking --stage subtitles --message "正在檢查 YouTube 字幕" --progress 0 --clear-error --record-history >/dev/null

fail_job() {
  local exit_code=$?
  trap - ERR
  caption_job_state update --job-dir "$job_dir" --state failed --stage download --message "下載流程失敗" --error "download-video.sh exited with status $exit_code" --record-history >/dev/null || true
  exit "$exit_code"
}
trap fail_job ERR

caption_note "Attempting to download available English and Traditional Chinese subtitles..."
if ! "$CAPTION_PYTHON" "$CAPTION_PROGRESS_RUNNER" \
  --job-dir "$job_dir" --state checking --stage subtitles --message "正在取得 YouTube 字幕" --success-message "字幕來源檢查完成" --allow-failure -- \
  "$CAPTION_YTDLP" "${common_args[@]}" --skip-download --write-subs --write-auto-subs \
  --sub-langs 'en.*,zh-Hant.*,zh-TW.*' --sub-format vtt --output "$youtube_caption_dir/%(id)s.%(ext)s" "$video_url"; then
  caption_note "warning: subtitle download was incomplete; media download will continue"
fi

find_track() {
  local expression="$1"
  find "$youtube_caption_dir" -maxdepth 1 -type f -name '*.vtt' -print | LC_ALL=C sort | awk -v expression="$expression" 'BEGIN { IGNORECASE=1 } $0 ~ expression { print; exit }'
}

zh_source=$(find_track '\.(zh-TW|zh-Hant)([-.][A-Za-z0-9_-]+)?\.vtt$')
en_source=$(find_track '\.en([-.][A-Za-z0-9_-]+)?\.vtt$')
if [ -n "$zh_source" ]; then
  cp "$zh_source" "$caption_dir/zh-TW.vtt"
  if grep -q '^WEBVTT' "$caption_dir/zh-TW.vtt" && grep -q -- '-->' "$caption_dir/zh-TW.vtt"; then
    caption_job_state subtitle --job-dir "$job_dir" --language zh-TW --path "$caption_dir/zh-TW.vtt" --source youtube --label "繁體中文" >/dev/null
  else
    rm -f -- "$caption_dir/zh-TW.vtt"
    caption_note "warning: downloaded Traditional Chinese subtitle was not a valid VTT"
  fi
fi
if [ -n "$en_source" ]; then
  cp "$en_source" "$caption_dir/en.vtt"
  if grep -q '^WEBVTT' "$caption_dir/en.vtt" && grep -q -- '-->' "$caption_dir/en.vtt"; then
    caption_job_state subtitle --job-dir "$job_dir" --language en --path "$caption_dir/en.vtt" --source youtube --label "English" >/dev/null
  else
    rm -f -- "$caption_dir/en.vtt"
    caption_note "warning: downloaded English subtitle was not a valid VTT"
  fi
fi

if [ ! -f "$source_dir/thumbnail.jpg" ]; then
  caption_note "Downloading a thumbnail..."
  if ! "$CAPTION_PYTHON" "$CAPTION_PROGRESS_RUNNER" \
    --job-dir "$job_dir" --state downloading --stage thumbnail --message "正在取得縮圖" --success-message "縮圖檢查完成" --allow-failure -- \
    "$CAPTION_YTDLP" "${common_args[@]}" --skip-download --write-thumbnail --convert-thumbnails jpg --output "$source_dir/thumbnail.%(ext)s" "$video_url"; then
    caption_note "warning: thumbnail was unavailable; continuing"
  fi
fi

caption_note "Downloading a browser-oriented MP4..."
"$CAPTION_PYTHON" "$CAPTION_PROGRESS_RUNNER" \
  --job-dir "$job_dir" --state downloading --stage video --message "正在下載影片" --success-message "影片下載完成" -- \
  "$CAPTION_YTDLP" "${common_args[@]}" \
  --format 'bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b' \
  --merge-output-format mp4 --recode-video mp4 --output "$source_dir/video.%(ext)s" "$video_url"

video_file="$source_dir/video.mp4"
caption_require_file "$video_file"
caption_job_state asset --job-dir "$job_dir" --name video --path "$video_file" >/dev/null

if [ -f "$source_dir/thumbnail.jpg" ]; then
  caption_job_state asset --job-dir "$job_dir" --name thumbnail --path "$source_dir/thumbnail.jpg" >/dev/null
fi

# Keep an audio copy only when there is no usable text track. Otherwise Whisper can
# extract it from video.mp4 later if the user asks for a fresh transcription.
if [ ! -f "$caption_dir/en.vtt" ] && [ ! -f "$caption_dir/zh-TW.vtt" ]; then
  caption_note "No text track found; downloading audio for Whisper..."
  "$CAPTION_PYTHON" "$CAPTION_PROGRESS_RUNNER" \
    --job-dir "$job_dir" --state downloading --stage audio --message "正在下載轉錄音訊" --success-message "轉錄音訊下載完成" -- \
    "$CAPTION_YTDLP" "${common_args[@]}" --format ba --extract-audio --audio-format m4a --audio-quality 0 \
    --output "$source_dir/audio.%(ext)s" "$video_url"
  caption_require_file "$source_dir/audio.m4a"
  caption_job_state asset --job-dir "$job_dir" --name audio --path "$source_dir/audio.m4a" >/dev/null
fi

"$CAPTION_FFMPEG" -nostdin -hide_banner -i "$video_file" 2> "$job_dir/media-info.txt" || true
caption_job_state asset --job-dir "$job_dir" --name mediaInfo --path "$job_dir/media-info.txt" >/dev/null

{
  printf 'video-id: %s\n' "$video_id"
  printf 'title: %s\n' "$video_title"
  printf 'source-url: %s\n' "$video_url"
  printf 'video-file: %s\n' "$video_file"
} > "$job_dir/manifest.txt"
caption_job_state asset --job-dir "$job_dir" --name manifest --path "$job_dir/manifest.txt" >/dev/null

if [ -f "$caption_dir/zh-TW.vtt" ]; then
  caption_job_state update --job-dir "$job_dir" --state ready --stage complete --message "影片與繁體中文字幕已可觀看" --progress 100 --clear-error --record-history >/dev/null
elif [ -f "$caption_dir/en.vtt" ]; then
  caption_job_state update --job-dir "$job_dir" --state needs_translation --stage translation --message "影片與英文字幕已就緒；等待繁中翻譯" --progress 0 --clear-error --record-history >/dev/null
else
  caption_job_state update --job-dir "$job_dir" --state needs_transcription --stage transcription --message "影片已就緒；沒有可用字幕，等待本機轉錄" --progress 0 --clear-error --record-history >/dev/null
fi

trap - ERR
caption_note "Download complete: $job_dir"
caption_note "Video ID: $video_id"
