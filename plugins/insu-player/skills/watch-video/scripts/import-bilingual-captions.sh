#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: import-bilingual-captions.sh <workspace> <video-id> <english-vtt> <zh-TW-vtt> [--source NAME] [--force]\n'
}

[ "$#" -ge 1 ] || { usage >&2; exit 1; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 0; fi
[ "$#" -ge 4 ] || { usage >&2; exit 1; }

workspace_input="$1"
video_id="$2"
english_source="$3"
chinese_source="$4"
shift 4
source_name="agent-sentence-reflow"
force=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) [ "$#" -ge 2 ] || caption_die "--source requires a value"; source_name="$2"; shift 2 ;;
    --force) force=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

caption_validate_video_id "$video_id"
caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_python
caption_validate_vtt "$english_source"
caption_validate_vtt "$chinese_source"

reflow_script="$SCRIPT_DIR/../../translate-subtitles/scripts/reflow_subtitles.py"
caption_require_file "$reflow_script"
"$CAPTION_PYTHON" "$reflow_script" validate-pair \
  --english "$english_source" \
  --traditional-chinese "$chinese_source" >/dev/null

job_dir="$CAPTION_JOBS/$video_id"
caption_dir="$job_dir/captions"
english_destination="$caption_dir/en.vtt"
chinese_destination="$caption_dir/zh-TW.vtt"
[ -d "$job_dir" ] || caption_die "job not found: $job_dir"
mkdir -p "$caption_dir"

workflow_source="legacy"
workflow_provider=""
case "$source_name" in
  local-model-*) workflow_source="model"; workflow_provider="local" ;;
  openai-model-*) workflow_source="model"; workflow_provider="openai" ;;
esac
workflow_args=(--job-dir "$job_dir" --translation requested --source "$workflow_source" --stage pair_validation)
if [ -n "$workflow_provider" ]; then workflow_args+=(--provider "$workflow_provider"); fi
caption_job_state subtitle-workflow "${workflow_args[@]}" >/dev/null

if [ "$force" -ne 1 ] && { [ -e "$english_destination" ] || [ -e "$chinese_destination" ]; }; then
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

backup_track "$english_destination" "$caption_dir/en.pre-reflow.vtt"
backup_track "$chinese_destination" "$caption_dir/zh-TW.pre-reflow.vtt"

english_temporary=$(mktemp "$caption_dir/.en.reflow.XXXXXX")
chinese_temporary=$(mktemp "$caption_dir/.zh-TW.reflow.XXXXXX")
trap 'rm -f -- "$english_temporary" "$chinese_temporary"' EXIT
cp "$english_source" "$english_temporary"
cp "$chinese_source" "$chinese_temporary"
"$CAPTION_PYTHON" "$reflow_script" validate-pair \
  --english "$english_temporary" \
  --traditional-chinese "$chinese_temporary" >/dev/null

mv -f "$english_temporary" "$english_destination"
mv -f "$chinese_temporary" "$chinese_destination"
trap - EXIT

caption_job_state subtitle --job-dir "$job_dir" --language en --path "$english_destination" --source "$source_name" --label "English" >/dev/null
caption_job_state subtitle --job-dir "$job_dir" --language zh-TW --path "$chinese_destination" --source "$source_name" --label "繁體中文" >/dev/null
workflow_args=(--job-dir "$job_dir" --translation requested --source "$workflow_source" --stage complete)
if [ -n "$workflow_provider" ]; then workflow_args+=(--provider "$workflow_provider"); fi
caption_job_state subtitle-workflow "${workflow_args[@]}" >/dev/null

if [ -f "$job_dir/source/video.mp4" ]; then
  caption_job_state update --job-dir "$job_dir" --state ready --stage complete --message "影片與句級對齊的雙語字幕已可觀看" --progress 100 --clear-error --record-history >/dev/null
fi

caption_note "Bilingual captions imported with shared sentence timing: $caption_dir"
