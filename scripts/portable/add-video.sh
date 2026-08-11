#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/common.sh"

[ "$#" -ge 1 ] || { printf 'usage: add-video.sh VIDEO_URL [process-video options]\n' >&2; exit 1; }
video_url="$1"
shift
content_choice=0
for argument in "$@"; do
  case "$argument" in
    --translate|--proofread) content_choice=1 ;;
  esac
done
[ "$content_choice" -eq 1 ] || {
  printf 'error: ask the user whether to proofread the source language or translate it, then pass --proofread or --translate TARGET_BCP47\n' >&2
  exit 1
}
exec "$PORTABLE_SKILL/scripts/process-video.sh" "$PORTABLE_WORKSPACE" "$video_url" "$@"
