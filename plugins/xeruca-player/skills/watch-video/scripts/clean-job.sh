#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: clean-job.sh <workspace> <video-id> [--all] [--yes]\n'
}

[ "$#" -ge 1 ] || { usage >&2; exit 1; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 0; fi
[ "$#" -ge 2 ] || { usage >&2; exit 1; }
workspace_input="$1"; video_id="$2"; shift 2
remove_all=0; confirmed=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --all) remove_all=1; shift ;;
    --yes) confirmed=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

caption_validate_video_id "$video_id"
caption_set_paths "$workspace_input"
caption_assert_safe_workspace
job_dir="$CAPTION_JOBS/$video_id"
[ -d "$job_dir" ] || caption_die "job not found: $job_dir"

if [ -f "$job_dir/status.json" ] && [ -x "$CAPTION_PYTHON" ]; then
  current_state=$(caption_job_state show --job-dir "$job_dir" --field state)
  case "$current_state" in
    checking|downloading|transcribing|translating|preparing_player)
      process_pid=$(caption_job_state show --job-dir "$job_dir" --field process.pid 2>/dev/null || true)
      if [ -n "$process_pid" ] && kill -0 "$process_pid" 2>/dev/null; then
        caption_die "job is active ($current_state, pid $process_pid); stop it before cleaning"
      fi
      caption_job_state update --job-dir "$job_dir" --state interrupted --stage "$current_state" --message "工作程序已停止；清理前標記為中斷" --record-history >/dev/null
      ;;
  esac
fi

printf 'Removal preview\n'
if [ "$remove_all" -eq 1 ]; then
  printf '  complete job: %s\n' "$job_dir"
else
  printf '  intermediate audio: %s\n' "$job_dir/source/audio.m4a"
  printf '  raw YouTube captions: %s\n' "$job_dir/youtube-captions"
  printf '  Whisper working files: %s\n' "$job_dir/whisper"
  printf '  preserved: video.mp4, normalized captions, status, logs, thumbnail\n'
fi
[ "$confirmed" -eq 1 ] || { printf 'dry-run: nothing was removed; rerun with --yes after checking these exact paths\n'; exit 0; }

if [ "$remove_all" -eq 1 ]; then
  rm -rf -- "$job_dir"
  caption_note "Removed complete job: $job_dir"
  exit 0
fi

rm -f -- "$job_dir/source/audio.m4a"
rm -rf -- "$job_dir/youtube-captions" "$job_dir/whisper"
if [ -x "$CAPTION_PYTHON" ] && [ -f "$job_dir/status.json" ]; then
  caption_job_state asset --job-dir "$job_dir" --name audio --remove >/dev/null
  current_state=$(caption_job_state show --job-dir "$job_dir" --field state)
  caption_job_state update --job-dir "$job_dir" --state "$current_state" --stage cleanup --message "已移除可重建的中間檔" --record-history >/dev/null
fi
caption_note "Intermediate files removed; playable library assets were preserved."
