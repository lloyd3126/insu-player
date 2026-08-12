#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: clean-job.sh <workspace> <video-id> [--all] [--plan-digest SHA256] [--yes]\n'
}

[ "$#" -ge 1 ] || { usage >&2; exit 1; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 0; fi
[ "$#" -ge 2 ] || { usage >&2; exit 1; }
workspace_input="$1"; video_id="$2"; shift 2
remove_all=0; confirmed=0; plan_digest=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --all) remove_all=1; shift ;;
    --plan-digest) [ "$#" -ge 2 ] || caption_die "--plan-digest requires a value"; plan_digest="$2"; shift 2 ;;
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

if [ "$remove_all" -eq 1 ]; then
  remover="$SCRIPT_DIR/../../video-library/scripts/remove_library_item.py"
  [ -f "$remover" ] || caption_die "resource removal script not found: $remover"
  [ -x "$CAPTION_PYTHON" ] || caption_die "workflow Python is required for complete removal"
  if [ "$confirmed" -eq 0 ]; then
    exec "$CAPTION_PYTHON" "$remover" preview "$CAPTION_WORKSPACE" --kind video "--video-id=$video_id"
  fi
  [ -n "$plan_digest" ] || caption_die "complete removal requires the confirmed --plan-digest from a current preview"
  exec "$CAPTION_PYTHON" "$remover" execute "$CAPTION_WORKSPACE" --kind video "--video-id=$video_id" --plan-digest "$plan_digest" --yes
fi

if [ -f "$CAPTION_WORKSPACE/app.db" ] && [ -x "$CAPTION_PYTHON" ]; then
  current_state=$(caption_job_state show --job-dir "$job_dir" --field state)
  current_stage=$(caption_job_state show --job-dir "$job_dir" --field stage)
  case "$current_state" in
    checking|downloading|transcribing|translating|preparing_player)
      process_pid=$(caption_job_state show --job-dir "$job_dir" --field process.pid 2>/dev/null || true)
      if [ -n "$process_pid" ] && kill -0 "$process_pid" 2>/dev/null; then
        caption_die "job is active ($current_state, pid $process_pid); stop it before cleaning"
      fi
      caption_job_state update --job-dir "$job_dir" --state interrupted --stage "$current_stage" --message "工作程序已停止。清理前標記為中斷" --record-history >/dev/null
      current_state=interrupted
      ;;
  esac
fi

printf 'Removal preview\n'
printf '  intermediate audio: %s\n' "$job_dir/source/audio.m4a"
printf '  raw YouTube captions: %s\n' "$job_dir/youtube-captions"
printf '  Whisper working files: %s\n' "$job_dir/whisper"
printf '  preserved: media renditions, normalized captions, database records, logs, thumbnail\n'
[ "$confirmed" -eq 1 ] || { printf 'dry-run: nothing was removed; rerun with --yes after checking these exact paths\n'; exit 0; }

rm -f -- "$job_dir/source/audio.m4a"
rm -rf -- "$job_dir/youtube-captions" "$job_dir/whisper"
if [ -x "$CAPTION_PYTHON" ] && [ -f "$CAPTION_WORKSPACE/app.db" ]; then
  caption_job_state asset --job-dir "$job_dir" --name audio --remove >/dev/null
  current_state=$(caption_job_state show --job-dir "$job_dir" --field state)
  current_stage=$(caption_job_state show --job-dir "$job_dir" --field stage)
  if { [ "$current_state" = "failed" ] || [ "$current_state" = "interrupted" ]; } && [ "$current_stage" = "model_transcription" ]; then
    caption_job_state transcription-retry --job-dir "$job_dir" >/dev/null
  else
    caption_job_state update --job-dir "$job_dir" --state "$current_state" --stage "$current_stage" --message "已移除可重建的中間檔" --record-history >/dev/null
  fi
fi
caption_note "Intermediate files removed; playable library assets were preserved."
