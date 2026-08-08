#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: uninstall.sh <workspace> [--include-generated] [--yes]\n'
}

[ "$#" -ge 1 ] || { usage >&2; exit 1; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  usage
  exit 0
fi

workspace_input="$1"
shift
include_generated=0
confirmed=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --include-generated) include_generated=1; shift ;;
    --yes) confirmed=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

caption_set_paths "$workspace_input"
caption_assert_safe_workspace

library_pid=""
library_running=0
if [ -f "$CAPTION_LIBRARY_PID" ]; then
  library_pid=$(sed -n '1p' "$CAPTION_LIBRARY_PID")
  case "$library_pid" in
    ''|*[!0-9]*) library_pid="" ;;
    *) if kill -0 "$library_pid" 2>/dev/null; then library_running=1; fi ;;
  esac
fi

active_job_count=0
if [ -x "$CAPTION_PYTHON" ] && [ -d "$CAPTION_JOBS" ]; then
  for status_file in "$CAPTION_JOBS"/*/status.json; do
    [ -f "$status_file" ] || continue
    job_dir=$(dirname "$status_file")
    job_state=$(caption_job_state show --job-dir "$job_dir" --field state 2>/dev/null || true)
    case "$job_state" in
      checking|downloading|transcribing|translating|preparing_player)
        job_pid=$(caption_job_state show --job-dir "$job_dir" --field process.pid 2>/dev/null || true)
        if [ -n "$job_pid" ] && kill -0 "$job_pid" 2>/dev/null; then active_job_count=$((active_job_count + 1)); fi
        ;;
    esac
  done
fi

printf 'Removal preview\n'
if [ "$library_running" -eq 1 ]; then
  printf '  library server: running (pid %s); stop it before removal\n' "$library_pid"
elif [ -f "$CAPTION_LIBRARY_PID" ]; then
  printf '  library server: stale pid file will be removed\n'
else
  printf '  library server: not running\n'
fi
printf '  active processing jobs: %s\n' "$active_job_count"
if [ -d "$CAPTION_RUNTIME" ]; then
  printf '  runtime: %s (%s)\n' "$CAPTION_RUNTIME" "$(du -sh "$CAPTION_RUNTIME" 2>/dev/null | awk '{print $1}')"
else
  printf '  runtime: not present\n'
fi

if [ "$include_generated" -eq 1 ]; then
  if [ -d "$CAPTION_WORKSPACE/jobs" ]; then
    printf '  generated jobs: %s (%s)\n' "$CAPTION_WORKSPACE/jobs" "$(du -sh "$CAPTION_WORKSPACE/jobs" 2>/dev/null | awk '{print $1}')"
  else
    printf '  generated jobs: not present\n'
  fi
else
  printf '  generated jobs: preserved\n'
fi

printf '  system packages: untouched; this workflow never installs them\n'

if [ "$confirmed" -ne 1 ]; then
  printf 'dry-run: nothing was removed; rerun with --yes after checking the paths above\n'
  exit 0
fi

[ "$library_running" -eq 0 ] || caption_die "library server is still running (pid $library_pid); stop it with Ctrl+C before removal"
[ "$active_job_count" -eq 0 ] || caption_die "$active_job_count processing job(s) are still running; stop them before removal"

if [ -d "$CAPTION_RUNTIME" ]; then
  rm -rf -- "$CAPTION_RUNTIME"
fi
rm -f -- "$CAPTION_LIBRARY_PID"

if [ "$include_generated" -eq 1 ] && [ -d "$CAPTION_WORKSPACE/jobs" ]; then
  rm -rf -- "$CAPTION_WORKSPACE/jobs"
fi

caption_note "Removal complete. No system package was changed. The repository folder and browser cache were not removed."
