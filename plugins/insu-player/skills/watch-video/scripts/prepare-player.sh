#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
SKILL_DIR=$(cd "$SCRIPT_DIR/.." && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: prepare-player.sh --video FILE --zh FILE --en FILE --output DIRECTORY [--template DIRECTORY] [--ffmpeg FILE] [--force]\n'
}

video_file=""
zh_file=""
en_file=""
output_dir=""
template_dir="$SKILL_DIR/assets/player"
force=0
ffmpeg_file=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --video) [ "$#" -ge 2 ] || caption_die "--video requires a value"; video_file="$2"; shift 2 ;;
    --zh) [ "$#" -ge 2 ] || caption_die "--zh requires a value"; zh_file="$2"; shift 2 ;;
    --en) [ "$#" -ge 2 ] || caption_die "--en requires a value"; en_file="$2"; shift 2 ;;
    --output) [ "$#" -ge 2 ] || caption_die "--output requires a value"; output_dir="$2"; shift 2 ;;
    --template) [ "$#" -ge 2 ] || caption_die "--template requires a value"; template_dir="$2"; shift 2 ;;
    --ffmpeg) [ "$#" -ge 2 ] || caption_die "--ffmpeg requires a value"; ffmpeg_file="$2"; shift 2 ;;
    --force) force=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

[ -n "$video_file" ] && [ -n "$zh_file" ] && [ -n "$en_file" ] && [ -n "$output_dir" ] || { usage >&2; exit 1; }
case "/$output_dir/" in
  *'/../'*) caption_die "player output may not contain a parent-directory segment (..)" ;;
esac

output_dir=$(caption_abs_path "$output_dir")
[ "$output_dir" != "/" ] || caption_die "refusing to use the filesystem root as player output"
if [ -n "${HOME:-}" ] && [ "$output_dir" = "$HOME" ]; then
  caption_die "refusing to use the home directory as player output; choose a dedicated child directory"
fi

caption_require_file "$video_file"
caption_validate_vtt "$zh_file"
caption_validate_vtt "$en_file"
caption_require_file "$template_dir/index.html"
caption_require_file "$template_dir/config.js"
if [ -n "$ffmpeg_file" ]; then
  [ -x "$ffmpeg_file" ] || caption_die "FFmpeg is not executable: $ffmpeg_file"
fi

if [ -d "$output_dir" ] && find "$output_dir" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  [ "$force" -eq 1 ] || caption_die "output directory is not empty; use --force to replace the known player files: $output_dir"
fi

mkdir -p "$output_dir"
cp "$template_dir/index.html" "$output_dir/index.html"
cp "$template_dir/config.js" "$output_dir/config.js"
cp "$video_file" "$output_dir/video.mp4"
cp "$zh_file" "$output_dir/captions.zh-TW.vtt"
cp "$en_file" "$output_dir/captions.en.vtt"

if [ -n "$ffmpeg_file" ]; then
  "$ffmpeg_file" -nostdin -hide_banner -i "$output_dir/video.mp4" 2> "$output_dir/media-info.txt" || true
else
  printf 'media copied without codec probe; pass --ffmpeg <workflow-local-binary> to record details\n' > "$output_dir/media-info.txt"
fi

caption_note "Standalone player export prepared: $output_dir"
caption_note "Start it with serve-player.sh; do not open index.html through file://"
