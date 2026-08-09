#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: download-video.sh <workspace> <video-url> [--translate TARGET_BCP47 | --no-translate]\n'
}

if [ "$#" -eq 1 ] && { [ "$1" = "-h" ] || [ "$1" = "--help" ]; }; then usage; exit 0; fi
[ "$#" -ge 2 ] || { usage >&2; exit 1; }

workspace_input="$1"
video_url="$2"
shift 2
translation_mode="legacy"
translation_target=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --translate)
      [ "$#" -ge 2 ] || caption_die "--translate requires a language"
      [ "$translation_mode" = "legacy" ] || caption_die "choose only one translation mode"
      translation_mode="translate"
      translation_target="$2"
      shift 2
      ;;
    --no-translate)
      [ "$translation_mode" = "legacy" ] || caption_die "choose only one translation mode"
      translation_mode="none"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

if [ "$translation_mode" = "translate" ]; then caption_validate_language "$translation_target"; fi

caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_runtime

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
video_duration=$(printf '%s' "$metadata_json" | "$CAPTION_PYTHON" -c 'import json,math,sys; value=json.load(sys.stdin).get("duration"); print(value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0 else "")')
caption_validate_video_id "$video_id"

job_dir="$CAPTION_JOBS/$video_id"
source_dir="$job_dir/source"
youtube_caption_dir="$job_dir/youtube-captions"
caption_dir="$job_dir/captions"
mkdir -p "$source_dir" "$youtube_caption_dir" "$caption_dir" "$job_dir/logs"

job_init_args=(--job-dir "$job_dir" --video-id "$video_id" --source-url "$video_url" --title "$video_title")
if [ -n "$video_duration" ]; then
  job_init_args+=(--duration-seconds "$video_duration")
fi
caption_job_state init "${job_init_args[@]}" >/dev/null
if [ "$translation_mode" = "translate" ]; then
  existing_workflow_source=$(caption_job_state show --job-dir "$job_dir" --field subtitleWorkflow.source 2>/dev/null || true)
  existing_workflow_stage=$(caption_job_state show --job-dir "$job_dir" --field subtitleWorkflow.stage 2>/dev/null || true)
  existing_target_language=$(caption_job_state show --job-dir "$job_dir" --field subtitleWorkflow.targetLanguage 2>/dev/null || true)
  existing_source_language=$(caption_job_state show --job-dir "$job_dir" --field subtitleWorkflow.sourceLanguage 2>/dev/null || true)
  if [ "$existing_workflow_source" = "model" ] && [ "$existing_workflow_stage" = "complete" ] \
    && [ "$existing_target_language" = "$translation_target" ] && [ -f "$source_dir/video.mp4" ] \
    && [ -f "$caption_dir/$translation_target.vtt" ] \
    && { [ -z "$existing_source_language" ] || [ -f "$caption_dir/$existing_source_language.vtt" ]; }; then
    caption_note "Model-generated bilingual captions are already complete; no source subtitles were requested."
    caption_note "Download complete: $job_dir"
    caption_note "Video ID: $video_id"
    exit 0
  fi
  caption_job_state subtitle-workflow --job-dir "$job_dir" --translation requested --source model --stage awaiting_model --target-language "$translation_target" >/dev/null
  caption_job_state update --job-dir "$job_dir" --state checking --stage model_source --message "翻譯模式將使用模型音訊轉錄。不取得來源字幕" --progress 0 --clear-error --record-history >/dev/null
else
  caption_job_state update --job-dir "$job_dir" --state checking --stage subtitles --message "正在檢查來源字幕" --progress 0 --clear-error --record-history >/dev/null
fi

fail_job() {
  local exit_code=$?
  trap - ERR
  caption_job_state update --job-dir "$job_dir" --state failed --stage download --message "下載流程失敗" --error "download-video.sh exited with status $exit_code" --record-history >/dev/null || true
  exit "$exit_code"
}
trap fail_job ERR

find_track() {
  local expression="$1"
  local extension="$2"
  find "$youtube_caption_dir" -maxdepth 1 -type f -name "*.$extension" -print | LC_ALL=C sort | awk -v expression="$expression" 'BEGIN { IGNORECASE=1 } $0 ~ expression { print; exit }'
}

if [ "$translation_mode" = "translate" ]; then
  caption_note "Translation requested; skipping all source subtitles so a local or OpenAI model can transcribe the audio."
else
  if [ "$translation_mode" = "none" ]; then
    caption_note "No translation requested; downloading an English playback VTT..."
    subtitle_languages='en.*'
  else
    caption_note "Legacy call without a translation choice; downloading English and Traditional Chinese playback VTT tracks..."
    subtitle_languages='en.*,zh-Hant.*,zh-TW.*'
  fi
  if ! "$CAPTION_PYTHON" "$CAPTION_PROGRESS_RUNNER" \
    --job-dir "$job_dir" --state checking --stage subtitles --message "正在取得來源字幕" --success-message "字幕來源檢查完成" --allow-failure -- \
    "$CAPTION_YTDLP" "${common_args[@]}" --skip-download --write-subs --write-auto-subs \
    --sub-langs "$subtitle_languages" --sub-format vtt --output "$youtube_caption_dir/%(id)s.%(ext)s" "$video_url"; then
    caption_note "warning: subtitle download was incomplete; media download will continue"
  fi

  if [ "$translation_mode" = "legacy" ]; then
    zh_source=$(find_track '\.(zh-TW|zh-Hant)([-.][A-Za-z0-9_-]+)?\.vtt$' vtt)
    if [ -n "$zh_source" ]; then
      cp "$zh_source" "$caption_dir/zh-TW.vtt"
      if grep -q '^WEBVTT' "$caption_dir/zh-TW.vtt" && grep -q -- '-->' "$caption_dir/zh-TW.vtt"; then
        caption_job_state subtitle --job-dir "$job_dir" --language zh-TW --path "$caption_dir/zh-TW.vtt" --source youtube --label "繁體中文" >/dev/null
      else
        rm -f -- "$caption_dir/zh-TW.vtt"
        caption_note "warning: downloaded Traditional Chinese subtitle was not a valid VTT"
      fi
    fi
  fi
  en_source=$(find_track '\.en([-.][A-Za-z0-9_-]+)?\.vtt$' vtt)
  if [ -n "$en_source" ]; then
    cp "$en_source" "$caption_dir/en.vtt"
    if grep -q '^WEBVTT' "$caption_dir/en.vtt" && grep -q -- '-->' "$caption_dir/en.vtt"; then
      caption_job_state subtitle --job-dir "$job_dir" --language en --path "$caption_dir/en.vtt" --source youtube --label "English" >/dev/null
    else
      rm -f -- "$caption_dir/en.vtt"
      caption_note "warning: downloaded English subtitle was not a valid VTT"
    fi
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
if [ "$translation_mode" = "translate" ] || { [ ! -f "$caption_dir/en.vtt" ] && [ ! -f "$caption_dir/zh-TW.vtt" ]; }; then
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
  printf 'translation-target: %s\n' "${translation_target:-none}"
} > "$job_dir/manifest.txt"
caption_job_state asset --job-dir "$job_dir" --name manifest --path "$job_dir/manifest.txt" >/dev/null

if [ "$translation_mode" = "translate" ]; then
  caption_job_state subtitle-workflow --job-dir "$job_dir" --translation requested --source model --stage awaiting_model --target-language "$translation_target" >/dev/null
  caption_job_state update --job-dir "$job_dir" --state needs_transcription --stage model_transcription --message "影片與音訊已就緒。等待選定的本機或 OpenAI 模型產生詞級字幕" --progress 0 --clear-error --record-history >/dev/null
elif [ "$translation_mode" = "none" ] && [ -f "$caption_dir/en.vtt" ]; then
  caption_job_state subtitle-workflow --job-dir "$job_dir" --translation not-requested --source platform --stage source_caption >/dev/null
  caption_job_state update --job-dir "$job_dir" --state ready --stage complete --message "影片與英文字幕已可觀看。不需要翻譯" --progress 100 --clear-error --record-history >/dev/null
elif [ -f "$caption_dir/zh-TW.vtt" ]; then
  caption_job_state subtitle-workflow --job-dir "$job_dir" --translation not-requested --source legacy --stage source_caption >/dev/null
  caption_job_state update --job-dir "$job_dir" --state ready --stage complete --message "影片與繁體中文字幕已可觀看" --progress 100 --clear-error --record-history >/dev/null
elif [ -f "$caption_dir/en.vtt" ]; then
  caption_job_state update --job-dir "$job_dir" --state needs_translation --stage translation --message "影片與英文字幕已就緒。等待繁中翻譯" --progress 0 --clear-error --record-history >/dev/null
else
  caption_job_state subtitle-workflow --job-dir "$job_dir" --translation not-requested --source model --stage awaiting_model >/dev/null
  caption_job_state update --job-dir "$job_dir" --state needs_transcription --stage transcription --message "影片已就緒。沒有可用字幕，等待本機轉錄" --progress 0 --clear-error --record-history >/dev/null
fi

trap - ERR
caption_note "Download complete: $job_dir"
caption_note "Video ID: $video_id"
