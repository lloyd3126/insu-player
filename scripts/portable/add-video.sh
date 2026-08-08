#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/common.sh"

[ "$#" -ge 1 ] || { printf 'usage: add-video.sh YOUTUBE_URL [process-video options]\n' >&2; exit 1; }
video_url="$1"
shift
exec "$PORTABLE_SKILL/scripts/process-video.sh" "$PORTABLE_WORKSPACE" "$video_url" "$@"
