#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: repair-transcription-cleanup.sh <workspace> <video-id>\n'
}

[ "$#" -ge 1 ] || { usage >&2; exit 1; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 0; fi
[ "$#" -eq 2 ] || { usage >&2; exit 1; }

workspace_input="$1"
video_id="$2"
caption_validate_video_id "$video_id"
caption_set_paths "$workspace_input"
caption_assert_safe_workspace
job_dir="$CAPTION_JOBS/$video_id"
[ -d "$job_dir" ] || caption_die "job not found: $job_dir"

caption_job_state transcription-retry --job-dir "$job_dir" >/dev/null
caption_note "Transcription state repaired: $video_id can be transcribed again."
