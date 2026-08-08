#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: import-caption.sh <workspace> <video-id> <language> <vtt-file> [--source NAME] [--label TEXT] [--force]\n'
}

[ "$#" -ge 1 ] || { usage >&2; exit 1; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 0; fi
[ "$#" -ge 4 ] || { usage >&2; exit 1; }

workspace_input="$1"; video_id="$2"; language_code="$3"; source_file="$4"; shift 4
source_name="agent-import"; track_label=""; force=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) [ "$#" -ge 2 ] || caption_die "--source requires a value"; source_name="$2"; shift 2 ;;
    --label) [ "$#" -ge 2 ] || caption_die "--label requires a value"; track_label="$2"; shift 2 ;;
    --force) force=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

caption_validate_video_id "$video_id"
caption_validate_language "$language_code"
caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_python
caption_validate_vtt "$source_file"

job_dir="$CAPTION_JOBS/$video_id"
caption_dir="$job_dir/captions"
destination="$caption_dir/$language_code.vtt"
[ -d "$job_dir" ] || caption_die "job not found: $job_dir"
mkdir -p "$caption_dir"

source_absolute=$(caption_abs_path "$source_file")
destination_absolute=$(caption_abs_path "$destination")
if [ "$source_absolute" != "$destination_absolute" ]; then
  if [ -e "$destination" ] && [ "$force" -ne 1 ]; then caption_die "caption already exists; use --force to replace: $destination"; fi
  temporary=$(mktemp "$caption_dir/.${language_code}.XXXXXX")
  trap 'rm -f -- "$temporary"' EXIT
  cp "$source_file" "$temporary"
  mv -f "$temporary" "$destination"
  trap - EXIT
fi

caption_validate_vtt "$destination"
if [ -z "$track_label" ]; then track_label="$language_code"; fi
caption_job_state subtitle --job-dir "$job_dir" --language "$language_code" --path "$destination" --source "$source_name" --label "$track_label" >/dev/null

if [ -f "$job_dir/source/video.mp4" ] && { [ -f "$caption_dir/zh-TW.vtt" ] || [ -f "$caption_dir/zh-Hant.vtt" ]; }; then
  caption_job_state update --job-dir "$job_dir" --state ready --stage complete --message "影片與繁體中文字幕已可觀看" --progress 100 --clear-error --record-history >/dev/null
elif [ -f "$job_dir/source/video.mp4" ]; then
  caption_job_state update --job-dir "$job_dir" --state needs_translation --stage translation --message "字幕已匯入；等待繁中翻譯" --progress 0 --clear-error --record-history >/dev/null
fi
caption_note "Caption imported: $destination"
