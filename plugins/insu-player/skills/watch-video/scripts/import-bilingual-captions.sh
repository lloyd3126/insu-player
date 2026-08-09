#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: import-bilingual-captions.sh <workspace> <video-id> <source-vtt> <target-vtt> [--source-language BCP47] [--target-language BCP47] [--source NAME] [--force]\n'
}

[ "$#" -ge 1 ] || { usage >&2; exit 1; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 0; fi
[ "$#" -ge 4 ] || { usage >&2; exit 1; }

workspace_input="$1"
video_id="$2"
source_track="$3"
target_track="$4"
shift 4
source_name="agent-sentence-reflow"
source_language="en"
target_language="zh-TW"
force=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source-language) [ "$#" -ge 2 ] || caption_die "--source-language requires a value"; source_language="$2"; shift 2 ;;
    --target-language) [ "$#" -ge 2 ] || caption_die "--target-language requires a value"; target_language="$2"; shift 2 ;;
    --source) [ "$#" -ge 2 ] || caption_die "--source requires a value"; source_name="$2"; shift 2 ;;
    --force) force=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

caption_validate_video_id "$video_id"
caption_validate_language "$source_language"
caption_validate_language "$target_language"
[ "$source_language" != "$target_language" ] || caption_die "source and target languages must differ"
caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_python
caption_validate_vtt "$source_track"
caption_validate_vtt "$target_track"

reflow_script="$SCRIPT_DIR/../../translate-subtitles/scripts/reflow_subtitles.py"
caption_require_file "$reflow_script"
"$CAPTION_PYTHON" "$reflow_script" validate-pair \
  --source "$source_track" \
  --target "$target_track" >/dev/null

job_dir="$CAPTION_JOBS/$video_id"
caption_dir="$job_dir/captions"
source_destination="$caption_dir/$source_language.vtt"
target_destination="$caption_dir/$target_language.vtt"
[ -d "$job_dir" ] || caption_die "job not found: $job_dir"
mkdir -p "$caption_dir"

workflow_source="legacy"
workflow_provider=""
case "$source_name" in
  local-model-*) workflow_source="model"; workflow_provider="local" ;;
  openai-model-*) workflow_source="model"; workflow_provider="openai" ;;
esac
workflow_args=(--job-dir "$job_dir" --translation requested --source "$workflow_source" --stage pair_validation --source-language "$source_language" --target-language "$target_language")
if [ -n "$workflow_provider" ]; then workflow_args+=(--provider "$workflow_provider"); fi
caption_job_state subtitle-workflow "${workflow_args[@]}" >/dev/null

if [ "$force" -ne 1 ] && { [ -e "$source_destination" ] || [ -e "$target_destination" ]; }; then
  caption_die "bilingual caption destination exists; use --force after validating both tracks"
fi

backup_track() {
  local source_path="$1"
  local backup_path="$2"
  local temporary_backup
  [ -f "$source_path" ] || return 0
  [ ! -e "$backup_path" ] || return 0
  temporary_backup=$(mktemp "$caption_dir/.backup.XXXXXX")
  cp "$source_path" "$temporary_backup"
  mv "$temporary_backup" "$backup_path"
}

backup_track "$source_destination" "$caption_dir/$source_language.pre-reflow.vtt"
backup_track "$target_destination" "$caption_dir/$target_language.pre-reflow.vtt"

source_temporary=$(mktemp "$caption_dir/.$source_language.reflow.XXXXXX")
target_temporary=$(mktemp "$caption_dir/.$target_language.reflow.XXXXXX")
trap 'rm -f -- "$source_temporary" "$target_temporary"' EXIT
cp "$source_track" "$source_temporary"
cp "$target_track" "$target_temporary"
"$CAPTION_PYTHON" "$reflow_script" validate-pair \
  --source "$source_temporary" \
  --target "$target_temporary" >/dev/null

mv -f "$source_temporary" "$source_destination"
mv -f "$target_temporary" "$target_destination"
trap - EXIT

caption_job_state subtitle --job-dir "$job_dir" --language "$source_language" --path "$source_destination" --source "$source_name" --label "$source_language" >/dev/null
caption_job_state subtitle --job-dir "$job_dir" --language "$target_language" --path "$target_destination" --source "$source_name" --label "$target_language" >/dev/null
workflow_args=(--job-dir "$job_dir" --translation requested --source "$workflow_source" --stage complete --source-language "$source_language" --target-language "$target_language")
if [ -n "$workflow_provider" ]; then workflow_args+=(--provider "$workflow_provider"); fi
caption_job_state subtitle-workflow "${workflow_args[@]}" >/dev/null

if [ -f "$job_dir/source/video.mp4" ]; then
  caption_job_state update --job-dir "$job_dir" --state ready --stage complete --message "影片與句級對齊的雙語字幕已可觀看" --progress 100 --clear-error --record-history >/dev/null
fi

caption_note "Bilingual captions imported with shared sentence timing: $caption_dir"
