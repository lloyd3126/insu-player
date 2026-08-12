#!/usr/bin/env bash
set -euo pipefail
trap 'exit 143' TERM INT

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: download-video.sh <workspace> <video-url> [--fallback-url URL]... [--download-only | --language SOURCE_BCP47 [--translate TARGET_BCP47 | --proofread]] [--allow-low-quality] [--resume-partial] [--library-source-url URL] [--source-kind page|embed|network-media] [--queue-item-id ID] [--referer URL] [--cookie-file PATH]\n'
}

if [ "$#" -eq 1 ] && { [ "$1" = "-h" ] || [ "$1" = "--help" ]; }; then usage; exit 0; fi
[ "$#" -ge 2 ] || { usage >&2; exit 1; }

workspace_input="$1"
video_url="$2"
shift 2
translation_mode=""
translation_target=""
source_language=""
allow_low_quality=0
resume_partial=0
download_only=0
library_source_url="$video_url"
source_kind="page"
referer_url=""
cookie_file=""
queue_item_id=""
print_video_id=0
fallback_urls=()
fallback_count=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --language)
      [ "$#" -ge 2 ] || caption_die "--language requires a language"
      source_language="$2"
      shift 2
      ;;
    --translate)
      [ "$#" -ge 2 ] || caption_die "--translate requires a language"
      [ -z "$translation_mode" ] || caption_die "choose only one translation mode"
      translation_mode="translate"
      translation_target="$2"
      shift 2
      ;;
    --proofread)
      [ -z "$translation_mode" ] || caption_die "choose only one translation mode"
      translation_mode="proofread"
      shift
      ;;
    --allow-low-quality)
      allow_low_quality=1
      shift
      ;;
    --resume-partial)
      resume_partial=1
      shift
      ;;
    --download-only)
      download_only=1
      shift
      ;;
    --library-source-url)
      [ "$#" -ge 2 ] || caption_die "--library-source-url requires a URL"
      library_source_url="$2"
      shift 2
      ;;
    --source-kind)
      [ "$#" -ge 2 ] || caption_die "--source-kind requires a value"
      source_kind="$2"
      shift 2
      ;;
    --queue-item-id)
      [ "$#" -ge 2 ] || caption_die "--queue-item-id requires a value"
      queue_item_id="$2"
      shift 2
      ;;
    --print-video-id)
      print_video_id=1
      shift
      ;;
    --referer)
      [ "$#" -ge 2 ] || caption_die "--referer requires a URL"
      referer_url="$2"
      shift 2
      ;;
    --cookie-file)
      [ "$#" -ge 2 ] || caption_die "--cookie-file requires a path"
      cookie_file="$2"
      shift 2
      ;;
    --fallback-url)
      [ "$#" -ge 2 ] || caption_die "--fallback-url requires a URL"
      fallback_urls[$fallback_count]="$2"
      fallback_count=$((fallback_count + 1))
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

if [ "$print_video_id" -eq 1 ]; then
  exec 3>&1
  exec 1>&2
fi

if [ "$download_only" -eq 1 ]; then
  [ -z "$source_language" ] || caption_die "--download-only cannot be combined with --language"
  [ -z "$translation_mode" ] || caption_die "--download-only cannot be combined with a subtitle mode"
  source_language="und"
  translation_mode="download-only"
else
  [ -n "$source_language" ] || caption_die "--language SOURCE_BCP47 is required after confirming the source language"
  caption_validate_language "$source_language"
  [ -n "$translation_mode" ] || caption_die "choose --translate TARGET_BCP47 or --proofread after asking the user"
  if [ "$translation_mode" = "translate" ]; then caption_validate_language "$translation_target"; fi
  if [ "$translation_mode" = "translate" ] && [ "$translation_target" = "$source_language" ]; then caption_die "translation target must differ from the source language"; fi
fi

caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_runtime
caption_require_command curl
case "$source_kind" in page|embed|network-media) ;; *) caption_die "invalid source kind: $source_kind" ;; esac
case "$library_source_url" in http://*|https://*) ;; *) caption_die "library source URL must use http or https" ;; esac
if [ -n "$referer_url" ]; then
  case "$referer_url" in http://*|https://*) ;; *) caption_die "referer URL must use http or https" ;; esac
fi
fallback_index=0
while [ "$fallback_index" -lt "$fallback_count" ]; do
  fallback_url="${fallback_urls[$fallback_index]}"
  case "$fallback_url" in http://*|https://*) ;; *) caption_die "fallback URL must use http or https" ;; esac
  fallback_index=$((fallback_index + 1))
done
if [ -n "$cookie_file" ]; then
  cookie_file=$(caption_abs_path "$cookie_file")
  case "$cookie_file" in
    "$CAPTION_TEMP"/cookie-sessions/*.txt) ;;
    *) caption_die "cookie file must stay inside the workspace cookie session directory" ;;
  esac
  [ -f "$cookie_file" ] || caption_die "cookie file is missing"
fi

preferred_max_height=1080
minimum_height=720
media_quality_script="$SCRIPT_DIR/media_quality.py"
[ -f "$media_quality_script" ] || caption_die "media quality helper is missing: $media_quality_script"
media_catalog_script="$SCRIPT_DIR/media_catalog.py"
[ -f "$media_catalog_script" ] || caption_die "media catalog helper is missing: $media_catalog_script"

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
if [ -n "$referer_url" ]; then common_args+=(--add-header "Referer:$referer_url"); fi
if [ -n "$cookie_file" ]; then common_args+=(--cookies "$cookie_file"); fi

candidate_urls=("$video_url")
fallback_index=0
while [ "$fallback_index" -lt "$fallback_count" ]; do
  candidate_urls+=("${fallback_urls[$fallback_index]}")
  fallback_index=$((fallback_index + 1))
done
progress_security_args=()
for candidate_url in "${candidate_urls[@]}"; do
  progress_security_args+=(--redact-value "$candidate_url")
done

metadata_is_safe() {
  printf '%s' "$1" | "$CAPTION_PYTHON" -c '
import json, sys
data = json.load(sys.stdin)
if data.get("is_live") or data.get("live_status") in {"is_live", "is_upcoming", "post_live"}:
    raise SystemExit("live streams are not supported")
if data.get("has_drm") is True or any(item.get("has_drm") is True for item in data.get("formats") or [] if isinstance(item, dict)):
    raise SystemExit("DRM-protected media is not supported")
' >/dev/null 2>&1
}

resolve_candidate_metadata() {
  local candidate_url="$1"
  local candidate_metadata
  if ! candidate_metadata=$("$CAPTION_YTDLP" "${common_args[@]}" --skip-download --dump-single-json "$candidate_url" 2>/dev/null); then
    return 1
  fi
  if ! metadata_is_safe "$candidate_metadata"; then
    return 1
  fi
  metadata_json="$candidate_metadata"
  video_url="$candidate_url"
  return 0
}

caption_note "Resolving video metadata..."
metadata_json=""
active_candidate_index=-1
for candidate_index in "${!candidate_urls[@]}"; do
  if resolve_candidate_metadata "${candidate_urls[$candidate_index]}"; then
    active_candidate_index="$candidate_index"
    break
  fi
done
[ "$active_candidate_index" -ge 0 ] || caption_die "yt-dlp could not resolve a safe page or detected fallback source"
video_id=$(printf '%s' "$metadata_json" | "$CAPTION_PYTHON" -c 'import json,sys; print(json.load(sys.stdin)["id"])')
video_title=$(printf '%s' "$metadata_json" | "$CAPTION_PYTHON" -c 'import json,sys; print(json.load(sys.stdin).get("title") or "")')
video_duration=$(printf '%s' "$metadata_json" | "$CAPTION_PYTHON" -c 'import json,math,sys; value=json.load(sys.stdin).get("duration"); print(value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0 else "")')
caption_validate_video_id "$video_id"

job_dir="$CAPTION_JOBS/$video_id"
source_dir="$job_dir/source"
youtube_caption_dir="$job_dir/youtube-captions"
mkdir -p "$source_dir" "$youtube_caption_dir" "$job_dir/logs"
diagnostic_log="$job_dir/logs/workflow.log"
if [ "$source_kind" = "network-media" ] || [ "$fallback_count" -gt 0 ] || [ -n "$cookie_file" ]; then
  diagnostic_log=/dev/null
fi

job_init_args=(--job-dir "$job_dir" "--video-id=$video_id" --source-url "$library_source_url" --source-kind "$source_kind" --title "$video_title")
if [ -n "$video_duration" ]; then
  job_init_args+=(--duration-seconds "$video_duration")
fi
caption_job_state init "${job_init_args[@]}" >/dev/null
if [ -n "$queue_item_id" ]; then
  caption_job_state link-download --job-dir "$job_dir" --queue-item-id "$queue_item_id" >/dev/null
fi
pipeline_output_language="$source_language"
if [ "$translation_mode" = "translate" ]; then pipeline_output_language="$translation_target"; fi
if [ "$download_only" -eq 1 ]; then
  caption_job_state update --job-dir "$job_dir" --state checking --stage source_resolution --message "正在確認影音來源" --progress 1 --clear-error --record-history >/dev/null
else
  caption_job_state subtitle-pipeline --job-dir "$job_dir" --mode "$translation_mode" --stage awaiting_model --source-language "$source_language" --output-language "$pipeline_output_language" >/dev/null
  caption_job_state update --job-dir "$job_dir" --state checking --stage manual_caption --message "正在檢查人工 CC 字幕，平台自動字幕不會下載" --progress 0 --clear-error --record-history >/dev/null
fi

fail_job() {
  local exit_code=$?
  trap - ERR
  caption_job_state update --job-dir "$job_dir" --state failed --stage media_download --message "下載流程失敗" --error "download-video.sh exited with status $exit_code" --record-history >/dev/null || true
  exit "$exit_code"
}
trap fail_job ERR

initial_run_dir="$job_dir/media-work/runs/initial"
mkdir -p "$initial_run_dir"
attempt_log="$initial_run_dir/attempts.jsonl"
media_selection_file="$initial_run_dir/selection.json"
media_discovery_file="$initial_run_dir/discovery.json"
media_catalog_file="$job_dir/media-work/catalog.json"
probe_result=""
probe_statuses=""

cleanup_attempt_dir() {
  local attempt_dir="$1"
  case "$attempt_dir" in
    "$source_dir"/.video-download-*) rm -rf -- "$attempt_dir" ;;
    *) caption_die "refusing to clean unexpected media attempt directory: $attempt_dir" ;;
  esac
}

record_media_attempt() {
  "$CAPTION_PYTHON" "$media_quality_script" record-attempt \
    --output "$attempt_log" \
    --height "$1" \
    --retry "$2" \
    --probe-result "$3" \
    --http-statuses "$4" \
    --download-result "$5"
}

probe_video_format() {
  local format_selector="$1"
  local stream_urls
  local stream_url
  local http_code
  local stream_count=0
  local all_available=1

  probe_result="unavailable"
  probe_statuses=""
  if ! stream_urls=$("$CAPTION_YTDLP" "${common_args[@]}" --get-url --format "$format_selector" "$video_url" 2>> "$diagnostic_log"); then
    return 1
  fi

  while IFS= read -r stream_url; do
    [ -n "$stream_url" ] || continue
    stream_count=$((stream_count + 1))
    http_code=$(curl -L --silent --show-error --range 0-1023 --max-time 20 -o /dev/null -w '%{http_code}' "$stream_url" 2>> "$diagnostic_log" || true)
    if [ -n "$probe_statuses" ]; then probe_statuses="$probe_statuses,$http_code"; else probe_statuses="$http_code"; fi
    case "$http_code" in 200|206) ;; *) all_available=0 ;; esac
  done <<EOF
$stream_urls
EOF

  if [ "$stream_count" -eq 0 ]; then return 1; fi
  if [ "$all_available" -ne 1 ]; then
    probe_result="http-failed"
    return 1
  fi
  probe_result="ok"
  return 0
}

find_track() {
  local expression="$1"
  local extension="$2"
  find "$youtube_caption_dir" -maxdepth 1 -type f -name "*.$extension" -print | LC_ALL=C sort | awk -v expression="$expression" 'BEGIN { IGNORECASE=1 } $0 ~ expression { print; exit }'
}

source_caption_ready=0
if [ "$download_only" -eq 0 ]; then
  caption_note "Checking for creator-provided $source_language CC; automatic captions are intentionally excluded..."
  if ! "$CAPTION_PYTHON" "$CAPTION_PROGRESS_RUNNER" \
    "${progress_security_args[@]}" \
    --job-dir "$job_dir" --state checking --stage manual_caption --message "正在取得人工 CC 字幕" --success-message "人工 CC 檢查完成" --allow-failure -- \
    "$CAPTION_YTDLP" "${common_args[@]}" --skip-download --write-subs \
    --sub-langs "$source_language.*" --sub-format vtt --output "$youtube_caption_dir/%(id)s.%(ext)s" "$video_url"; then
    caption_note "warning: manual CC download was incomplete; media download will continue"
  fi

  manual_source=$(find_track "\\.$source_language([-.][A-Za-z0-9_-]+)?\\.vtt$" vtt)
  if [ -n "$manual_source" ]; then
    caption_validate_vtt "$manual_source"
    "$SCRIPT_DIR/import-caption.sh" "$CAPTION_WORKSPACE" "$video_id" "$source_language" "$manual_source" --source-type manual-cc --processor-provider yt-dlp
    source_caption_ready=1
  fi
fi

if [ ! -f "$source_dir/thumbnail.jpg" ]; then
  caption_note "Downloading a thumbnail..."
  caption_job_state update --job-dir "$job_dir" --state downloading --stage thumbnail --message "正在取得縮圖" --progress 5 --clear-error >/dev/null
  if ! "$CAPTION_PYTHON" "$CAPTION_PROGRESS_RUNNER" \
    "${progress_security_args[@]}" \
    --job-dir "$job_dir" --state downloading --stage thumbnail --message "正在取得縮圖" --success-message "縮圖檢查完成" --progress-start 5 --progress-end 8 --allow-failure -- \
    "$CAPTION_YTDLP" "${common_args[@]}" --skip-download --write-thumbnail --convert-thumbnails jpg --output "$source_dir/thumbnail.%(ext)s" "$video_url"; then
    caption_note "warning: thumbnail was unavailable; continuing"
  fi
fi

caption_job_state update --job-dir "$job_dir" --state downloading --stage media_probe --message "正在確認最高可用畫質" --progress 8 --clear-error >/dev/null

video_file=""
selected_height=""
selected_info_file=""
selected_attempt_dir=""
best_available_height=""

video_file=$("$CAPTION_PYTHON" "$media_catalog_script" active-path \
  --job-dir "$job_dir" "--video-id=$video_id" 2>/dev/null || true)
if [ -n "$video_file" ]; then
  caption_note "Using the active verified media rendition."
else
  caption_note "Downloading the highest verified browser-oriented MP4 up to ${preferred_max_height}p..."
  lower_quality_available=0
  candidate_index="$active_candidate_index"
  while [ "$candidate_index" -lt "${#candidate_urls[@]}" ]; do
    if [ "$candidate_index" -ne "$active_candidate_index" ]; then
      caption_note "Trying detected fallback source $candidate_index..."
      if ! resolve_candidate_metadata "${candidate_urls[$candidate_index]}"; then
        candidate_index=$((candidate_index + 1))
        continue
      fi
    fi
    if ! quality_heights=$(printf '%s' "$metadata_json" | "$CAPTION_PYTHON" "$media_quality_script" plan --preferred-max-height "$preferred_max_height" 2>/dev/null); then
      candidate_index=$((candidate_index + 1))
      continue
    fi
    candidate_best_height=$(printf '%s\n' "$quality_heights" | sed -n '1p')
    [ -n "$candidate_best_height" ] || {
      candidate_index=$((candidate_index + 1))
      continue
    }
    printf '%s' "$metadata_json" | "$CAPTION_PYTHON" -c '
import json, sys
data = json.load(sys.stdin)
data["id"] = sys.argv[1]
json.dump(data, sys.stdout)
' "$video_id" | "$CAPTION_PYTHON" "$media_catalog_script" discover \
      --job-dir "$job_dir" "--video-id=$video_id" --output "$media_discovery_file" >/dev/null

    for height in $quality_heights; do
      case "$height" in ''|*[!0-9]*) caption_die "invalid planned media height: $height" ;; esac
      if [ "$height" -lt "$minimum_height" ] && [ "$allow_low_quality" -ne 1 ]; then
        lower_quality_available=1
        continue
      fi

      format_selector="bv*[ext=mp4][vcodec^=avc1][height=$height]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1][height=$height]/bv*[ext=mp4][height=$height]+ba[ext=m4a]/b[ext=mp4][height=$height]/bv*[height=$height]+ba/b[height=$height]"
      retry=1
      while [ "$retry" -le 2 ]; do
        attempt_dir="$source_dir/.video-download-${height}p-${retry}"
        if [ "$resume_partial" -ne 1 ]; then cleanup_attempt_dir "$attempt_dir"; fi
        mkdir -p "$attempt_dir"
        caption_note "Checking a fresh ${height}p stream URL (attempt ${retry}/2)..."
        if ! probe_video_format "$format_selector"; then
          record_media_attempt "$height" "$retry" "$probe_result" "$probe_statuses" "not-run"
          cleanup_attempt_dir "$attempt_dir"
          retry=$((retry + 1))
          continue
        fi

        if "$CAPTION_PYTHON" "$CAPTION_PROGRESS_RUNNER" \
          "${progress_security_args[@]}" \
          --job-dir "$job_dir" --state downloading --stage media_download --message "正在下載 ${height}p 影片" --success-message "${height}p 影片下載完成" --progress-start 10 --progress-end 90 --allow-failure -- \
          "$CAPTION_YTDLP" "${common_args[@]}" \
          --format "$format_selector" --merge-output-format mp4 --recode-video mp4 --write-info-json \
          --output "$attempt_dir/video.%(ext)s" "$video_url"; then
          candidate_file="$attempt_dir/video.mp4"
          if [ -f "$candidate_file" ]; then
            record_media_attempt "$height" "$retry" "ok" "$probe_statuses" "success"
            selected_height="$height"
            selected_info_file="$attempt_dir/video.info.json"
            selected_attempt_dir="$attempt_dir"
            best_available_height="$candidate_best_height"
            break
          fi
        fi
        record_media_attempt "$height" "$retry" "ok" "$probe_statuses" "failed"
        cleanup_attempt_dir "$attempt_dir"
        retry=$((retry + 1))
      done
      if [ -n "$selected_height" ]; then break; fi
    done
    if [ -n "$selected_height" ]; then break; fi
    candidate_index=$((candidate_index + 1))
  done

  if [ -z "$selected_height" ]; then
    if [ "$lower_quality_available" -eq 1 ] && [ "$allow_low_quality" -ne 1 ]; then
      caption_die "source metadata advertises formats below ${minimum_height}p, but low-quality fallback requires user confirmation; rerun with --allow-low-quality"
    fi
    caption_die "no verified browser-oriented MP4 could be downloaded after fresh URL retries"
  fi
fi

media_probe_file="$video_file"
if [ -n "$selected_attempt_dir" ]; then media_probe_file="$selected_attempt_dir/video.mp4"; fi
caption_job_state update --job-dir "$job_dir" --state downloading --stage media_validation --message "正在驗證影音畫質與格式" --progress 90 --clear-error >/dev/null
"$CAPTION_FFMPEG" -nostdin -hide_banner -i "$media_probe_file" 2> "$job_dir/media-info.txt" || true

if [ -n "$selected_height" ]; then
  finalize_args=(
    finalize
    --output "$media_selection_file"
    --media-info "$job_dir/media-info.txt"
    --attempt-log "$attempt_log"
    --selection-info "$selected_info_file"
    --preferred-max-height "$preferred_max_height"
    --minimum-height "$minimum_height"
    --best-available-height "$best_available_height"
    --selected-height "$selected_height"
  )
  if [ "$allow_low_quality" -eq 1 ]; then finalize_args+=(--allow-low-quality); fi
  "$CAPTION_PYTHON" "$media_quality_script" "${finalize_args[@]}" >/dev/null
  caption_job_state update --job-dir "$job_dir" --state downloading --stage media_publish --message "正在發佈已驗證影音" --progress 95 --clear-error >/dev/null
  "$CAPTION_PYTHON" "$media_catalog_script" publish \
    --job-dir "$job_dir" "--video-id=$video_id" \
    --source-file "$media_probe_file" --selection "$media_selection_file" \
    --discovery "$media_discovery_file" \
    --requested-height "$selected_height" --activate >/dev/null
  video_file=$("$CAPTION_PYTHON" "$media_catalog_script" active-path \
    --job-dir "$job_dir" "--video-id=$video_id")
  cleanup_attempt_dir "$selected_attempt_dir"
  if [ "$selected_height" -lt "$best_available_height" ]; then
    caption_note "warning: selected ${selected_height}p after fresh retries of higher-quality streams failed; see $media_selection_file"
  else
    caption_note "Selected and verified ${selected_height}p media."
  fi
fi

caption_require_file "$video_file"
caption_job_state asset --job-dir "$job_dir" --name video --path "$video_file" >/dev/null
caption_job_state asset --job-dir "$job_dir" --name mediaCatalog --path "$media_catalog_file" >/dev/null

if [ -f "$source_dir/thumbnail.jpg" ]; then
  caption_job_state asset --job-dir "$job_dir" --name thumbnail --path "$source_dir/thumbnail.jpg" >/dev/null
fi

caption_job_state asset --job-dir "$job_dir" --name mediaInfo --path "$job_dir/media-info.txt" >/dev/null

{
  printf 'video-id: %s\n' "$video_id"
  printf 'title: %s\n' "$video_title"
  printf 'source-url: %s\n' "$library_source_url"
  printf 'source-kind: %s\n' "$source_kind"
  printf 'video-file: %s\n' "$video_file"
  printf 'media-catalog-file: %s\n' "$media_catalog_file"
  printf 'subtitle-mode: %s\n' "$translation_mode"
  printf 'source-language: %s\n' "$source_language"
  printf 'output-language: %s\n' "$pipeline_output_language"
} > "$job_dir/manifest.txt"
caption_job_state asset --job-dir "$job_dir" --name manifest --path "$job_dir/manifest.txt" >/dev/null

if [ "$download_only" -eq 1 ]; then
  caption_job_state update --job-dir "$job_dir" --state downloaded --stage awaiting_subtitle_choice --message "影音已下載，等待選擇字幕處理方式" --progress 100 --clear-error --record-history >/dev/null
  trap - ERR
  caption_note "Download complete: $job_dir"
  caption_note "Video ID: $video_id"
  if [ "$print_video_id" -eq 1 ]; then printf '%s\n' "$video_id" >&3; fi
  exit 0
fi

# A model-generated fine-grained timing source is mandatory for proofreading,
# translation, and segmentation, even when creator CC is available as text evidence.
if [ ! -f "$source_dir/audio.m4a" ]; then
  caption_note "Extracting the model timing audio from the verified local media..."
  "$CAPTION_PYTHON" "$CAPTION_PROGRESS_RUNNER" \
    "${progress_security_args[@]}" \
    --job-dir "$job_dir" --state downloading --stage audio_preparation --message "正在從本機影音準備轉錄音訊" --success-message "轉錄音訊準備完成" -- \
    "$CAPTION_FFMPEG" -nostdin -hide_banner -loglevel warning -i "$video_file" \
    -vn -c:a aac -b:a 192k -movflags +faststart "$source_dir/audio.m4a"
  caption_require_file "$source_dir/audio.m4a"
  caption_job_state asset --job-dir "$job_dir" --name audio --path "$source_dir/audio.m4a" >/dev/null
fi

caption_job_state subtitle-pipeline --job-dir "$job_dir" --mode "$translation_mode" --stage awaiting_model --source-language "$source_language" --output-language "$pipeline_output_language" >/dev/null
if [ "$source_caption_ready" -eq 1 ]; then
  next_message="影音與人工 CC 已可觀看，仍需模型從音訊建立細粒度時間軸"
else
  next_message="影音與音訊已就緒，等待模型建立細粒度來源字幕"
fi
caption_job_state update --job-dir "$job_dir" --state needs_transcription --stage model_transcription --message "$next_message" --progress 0 --clear-error --record-history >/dev/null

trap - ERR
caption_note "Download complete: $job_dir"
caption_note "Video ID: $video_id"
if [ "$print_video_id" -eq 1 ]; then printf '%s\n' "$video_id" >&3; fi
