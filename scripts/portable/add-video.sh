#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/common.sh"

[ "$#" -ge 1 ] || { printf 'usage: add-video.sh VIDEO_URL [process-video options]\n' >&2; exit 1; }
video_url="$1"
shift
translation_choice=0
translation_requested=0
provider_choice=0
for argument in "$@"; do
  case "$argument" in
    --translate) translation_choice=1; translation_requested=1 ;;
    --no-translate) translation_choice=1 ;;
    --provider) provider_choice=1 ;;
  esac
done
[ "$translation_choice" -eq 1 ] || {
  printf 'error: ask the user whether translation is wanted and which target BCP 47 language to use, then pass --translate TARGET or --no-translate\n' >&2
  exit 1
}
if [ "$translation_requested" -eq 1 ] && [ "$provider_choice" -ne 1 ]; then
  printf 'error: translation requires asking the user to choose --provider local or --provider openai\n' >&2
  exit 1
fi
exec "$PORTABLE_SKILL/scripts/process-video.sh" "$PORTABLE_WORKSPACE" "$video_url" "$@"
