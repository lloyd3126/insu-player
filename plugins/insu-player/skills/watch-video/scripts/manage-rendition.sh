#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: manage-rendition.sh <workspace> <video-id> discover | download HEIGHT [--run-id ID]\n'
}

[ "$#" -ge 3 ] || { usage >&2; exit 1; }
workspace_input="$1"
video_id="$2"
command="$3"
shift 3

requested_height=""
run_id=""
case "$command" in
  discover)
    [ "$#" -eq 0 ] || caption_die "discover does not accept additional arguments"
    ;;
  download)
    [ "$#" -ge 1 ] || caption_die "download requires an exact height"
    requested_height="$1"
    shift
    case "$requested_height" in ''|*[!0-9]*) caption_die "height must be a positive integer" ;; esac
    [ "$requested_height" -gt 0 ] || caption_die "height must be a positive integer"
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --run-id)
          [ "$#" -ge 2 ] || caption_die "--run-id requires a value"
          run_id="$2"
          shift 2
          ;;
        *) caption_die "unknown option: $1" ;;
      esac
    done
    if [ -z "$run_id" ]; then run_id="quality-${requested_height}p-$(date -u +%Y%m%dT%H%M%SZ)-$$"; fi
    case "$run_id" in ''|*[!A-Za-z0-9._-]*) caption_die "run ID contains unsupported characters" ;; esac
    ;;
  *) caption_die "command must be discover or download" ;;
esac

caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_runtime
caption_require_command curl
caption_validate_video_id "$video_id"

job_dir="$CAPTION_JOBS/$video_id"
[ -d "$job_dir" ] || caption_die "job is unavailable: $video_id"
media_catalog_script="$SCRIPT_DIR/media_catalog.py"
media_quality_script="$SCRIPT_DIR/media_quality.py"
progress_script="$SCRIPT_DIR/run_media_progress.py"
for helper in "$media_catalog_script" "$media_quality_script" "$progress_script"; do
  [ -f "$helper" ] || caption_die "media helper is unavailable: $helper"
done

source_url=$(caption_job_state show --job-dir "$job_dir" --field sourceUrl)
[ -n "$source_url" ] || caption_die "job source URL is unavailable"

mkdir -p "$CAPTION_YTDLP_CACHE" "$job_dir/media-work/runs"
common_args=(
  --ignore-config
  --js-runtimes "deno:$CAPTION_DENO"
  --ffmpeg-location "$CAPTION_BIN"
  --cache-dir "$CAPTION_YTDLP_CACHE"
  --no-playlist
  --newline
  --no-overwrites
)

discover() {
  local metadata
  metadata=$("$CAPTION_YTDLP" "${common_args[@]}" --skip-download --dump-single-json "$source_url")
  printf '%s' "$metadata" | "$CAPTION_PYTHON" "$media_catalog_script" discover \
    --job-dir "$job_dir" "--video-id=$video_id" >/dev/null
}

if [ "$command" = "discover" ]; then
  discover
  caption_note "Available media quality metadata refreshed for $video_id."
  exit 0
fi

lock_directory="$job_dir/media-work/.download.lock"
lock_pid_file="$lock_directory/pid"
acquire_lock() {
  local existing_pid=""
  local attempt=1
  while [ "$attempt" -le 3 ]; do
    if mkdir "$lock_directory" 2>/dev/null; then
      printf '%s\n' "$$" > "$lock_pid_file"
      return 0
    fi
    if [ -f "$lock_pid_file" ]; then existing_pid=$(sed -n '1p' "$lock_pid_file"); fi
    case "$existing_pid" in
      ''|*[!0-9]*) ;;
      *)
        if kill -0 "$existing_pid" 2>/dev/null; then
          caption_die "another media quality operation is already active for $video_id"
        fi
        ;;
    esac
    rm -f -- "$lock_pid_file"
    rmdir "$lock_directory" 2>/dev/null || true
    attempt=$((attempt + 1))
  done
  caption_die "could not acquire the media quality lock for $video_id"
}
release_lock() {
  local owner=""
  if [ -f "$lock_pid_file" ]; then owner=$(sed -n '1p' "$lock_pid_file"); fi
  if [ "$owner" = "$$" ]; then
    rm -f -- "$lock_pid_file"
    rmdir "$lock_directory" 2>/dev/null || true
  fi
}
acquire_lock
run_directory="$job_dir/media-work/runs/$run_id"
[ ! -e "$run_directory" ] || { release_lock; caption_die "media run ID already exists: $run_id"; }
mkdir "$run_directory"

update_run() {
  local arguments=(
    run-update
    --job-dir "$job_dir"
    "--video-id=$video_id"
    --run-id "$run_id"
    --requested-height "$requested_height"
    --state "$1"
    --stage "$2"
    --progress "$3"
    --message "$4"
  )
  if [ -n "${5:-}" ]; then arguments+=(--error "$5"); fi
  "$CAPTION_PYTHON" "$media_catalog_script" "${arguments[@]}" >/dev/null
}

failure() {
  local exit_code=$?
  trap - ERR
  update_run failed download 0 "${requested_height}p 畫質下載失敗" "manage-rendition.sh exited with status $exit_code" || true
  release_lock
  exit "$exit_code"
}
trap failure ERR
trap release_lock EXIT

update_run discovering discovering 0 "正在檢查來源畫質"
discover

"$CAPTION_PYTHON" - "$job_dir/media-work/catalog.json" "$requested_height" <<'PY'
import json,shutil,sys
payload=json.load(open(sys.argv[1],encoding="utf-8"))
height=int(sys.argv[2])
if any(item.get("height") == height for item in payload.get("renditions",[])):
    raise SystemExit(f"a verified {height}p rendition already exists")
selected=next((item for item in payload.get("availability",{}).get("formats",[]) if item.get("height") == height),None)
if selected is None:
    raise SystemExit(f"the source does not advertise a browser-oriented {height}p MP4")
estimate=selected.get("estimatedBytes")
if isinstance(estimate,(int,float)) and not isinstance(estimate,bool) and estimate > 0:
    required=int(estimate * 1.25) + 256 * 1024 * 1024
    available=shutil.disk_usage(sys.argv[1]).free
    if available < required:
        raise SystemExit(
            f"not enough workspace disk space for {height}p: "
            f"requires about {required} bytes including reserve, {available} available"
        )
PY

format_selector="bv*[ext=mp4][vcodec^=avc1][height=$requested_height]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc1][height=$requested_height]/bv*[ext=mp4][height=$requested_height]+ba[ext=m4a]/b[ext=mp4][height=$requested_height]"
attempt_log="$run_directory/attempts.jsonl"
selected_attempt_dir=""
selected_info_file=""
probe_statuses=""
probe_result=""

cleanup_attempt_dir() {
  case "$1" in
    "$run_directory"/attempt-*) rm -rf -- "$1" ;;
    *) caption_die "refusing to clean unexpected rendition attempt directory: $1" ;;
  esac
}

probe_format() {
  local stream_urls stream_url http_code stream_count=0 all_available=1
  probe_result="unavailable"
  probe_statuses=""
  if ! stream_urls=$("$CAPTION_YTDLP" "${common_args[@]}" --get-url --format "$format_selector" "$source_url" 2>> "$run_directory/workflow.log"); then
    return 1
  fi
  while IFS= read -r stream_url; do
    [ -n "$stream_url" ] || continue
    stream_count=$((stream_count + 1))
    http_code=$(curl -L --silent --show-error --range 0-1023 --max-time 20 -o /dev/null -w '%{http_code}' "$stream_url" 2>> "$run_directory/workflow.log" || true)
    if [ -n "$probe_statuses" ]; then probe_statuses="$probe_statuses,$http_code"; else probe_statuses="$http_code"; fi
    case "$http_code" in 200|206) ;; *) all_available=0 ;; esac
  done <<EOF
$stream_urls
EOF
  [ "$stream_count" -gt 0 ] || return 1
  if [ "$all_available" -ne 1 ]; then probe_result="http-failed"; return 1; fi
  probe_result="ok"
}

retry=1
while [ "$retry" -le 2 ]; do
  attempt_dir="$run_directory/attempt-$retry"
  cleanup_attempt_dir "$attempt_dir"
  mkdir -p "$attempt_dir"
  update_run probing probing 0 "正在驗證新的 ${requested_height}p 串流（$retry/2）"
  if ! probe_format; then
    "$CAPTION_PYTHON" "$media_quality_script" record-attempt --output "$attempt_log" \
      --height "$requested_height" --retry "$retry" --probe-result "$probe_result" \
      --http-statuses "$probe_statuses" --download-result not-run
    cleanup_attempt_dir "$attempt_dir"
    retry=$((retry + 1))
    continue
  fi
  if "$CAPTION_PYTHON" "$progress_script" \
    --job-dir "$job_dir" "--video-id=$video_id" --run-id "$run_id" \
    --requested-height "$requested_height" --catalog-script "$media_catalog_script" \
    --message "正在下載 ${requested_height}p 畫質" \
    --success-message "${requested_height}p 下載完成，正在驗證" -- \
    "$CAPTION_YTDLP" "${common_args[@]}" --format "$format_selector" \
    --merge-output-format mp4 --recode-video mp4 --write-info-json \
    --output "$attempt_dir/video.%(ext)s" "$source_url"; then
    if [ -f "$attempt_dir/video.mp4" ]; then
      "$CAPTION_PYTHON" "$media_quality_script" record-attempt --output "$attempt_log" \
        --height "$requested_height" --retry "$retry" --probe-result ok \
        --http-statuses "$probe_statuses" --download-result success
      selected_attempt_dir="$attempt_dir"
      selected_info_file="$attempt_dir/video.info.json"
      break
    fi
  fi
  "$CAPTION_PYTHON" "$media_quality_script" record-attempt --output "$attempt_log" \
    --height "$requested_height" --retry "$retry" --probe-result ok \
    --http-statuses "$probe_statuses" --download-result failed
  cleanup_attempt_dir "$attempt_dir"
  retry=$((retry + 1))
done

[ -n "$selected_attempt_dir" ] || caption_die "${requested_height}p could not be downloaded after two fresh URL attempts"
selection_file="$run_directory/selection.json"
media_info_file="$run_directory/media-info.txt"
"$CAPTION_FFMPEG" -nostdin -hide_banner -i "$selected_attempt_dir/video.mp4" 2> "$media_info_file" || true
"$CAPTION_PYTHON" "$media_quality_script" finalize \
  --output "$selection_file" --media-info "$media_info_file" --attempt-log "$attempt_log" \
  --selection-info "$selected_info_file" --preferred-max-height "$requested_height" \
  --minimum-height 1 --best-available-height "$requested_height" \
  --selected-height "$requested_height" --allow-low-quality >/dev/null
"$CAPTION_PYTHON" "$media_catalog_script" publish \
  --job-dir "$job_dir" "--video-id=$video_id" \
  --source-file "$selected_attempt_dir/video.mp4" --selection "$selection_file" \
  --requested-height "$requested_height" --run-id "$run_id" >/dev/null
cleanup_attempt_dir "$selected_attempt_dir"
trap - ERR
release_lock
trap - EXIT
caption_note "Verified ${requested_height}p rendition added to $video_id."
