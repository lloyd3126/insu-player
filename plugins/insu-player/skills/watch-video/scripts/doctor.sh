#!/usr/bin/env bash
set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
SKILL_DIR=$(cd "$SCRIPT_DIR/.." && pwd -P)
. "$SCRIPT_DIR/lib.sh"

if [ "$#" -eq 1 ] && { [ "$1" = "-h" ] || [ "$1" = "--help" ]; }; then
  printf 'usage: doctor.sh <workspace>\n'
  exit 0
fi
if [ "$#" -ne 1 ]; then
  caption_die "usage: doctor.sh <workspace>"
fi

caption_set_paths "$1"
caption_assert_safe_workspace

printf 'workflow: insu-player\n'
printf 'workspace: %s\n' "$CAPTION_WORKSPACE"
printf 'platform: %s\n' "$(uname -s 2>/dev/null || printf unknown)"
printf 'architecture: %s\n' "$(uname -m 2>/dev/null || printf unknown)"

disk_target="$CAPTION_WORKSPACE"
while [ ! -e "$disk_target" ] && [ "$disk_target" != "/" ]; do
  disk_target=$(dirname "$disk_target")
done
if [ -e "$disk_target" ]; then
  available_kb=$(df -Pk "$disk_target" 2>/dev/null | awk 'NR == 2 { print $4 }')
  if [ -n "$available_kb" ]; then
    printf 'available-disk-kb: %s\n' "$available_kb"
  fi
fi

missing=0
for command_name in curl unzip; do
  if command -v "$command_name" >/dev/null 2>&1; then
    command_path=$(command -v "$command_name")
    printf 'command-%s: %s\n' "$command_name" "$command_path"
  else
    printf 'command-%s: missing\n' "$command_name"
    missing=1
  fi
done

for ignored_command in ffmpeg ffprobe python3 yt-dlp deno uv; do
  if command -v "$ignored_command" >/dev/null 2>&1; then
    printf 'system-%s: %s (detected, not used by workflow)\n' "$ignored_command" "$(command -v "$ignored_command")"
  else
    printf 'system-%s: absent (not required)\n' "$ignored_command"
  fi
done

if [ -x "$CAPTION_UV" ]; then
  printf 'uv: %s\n' "$($CAPTION_UV --version 2>/dev/null || printf installed-but-unreadable)"
else
  printf 'uv: not-installed-by-workflow\n'
  missing=1
fi

if [ -x "$CAPTION_DENO" ]; then
  printf 'deno: %s\n' "$($CAPTION_DENO --version 2>/dev/null | sed -n '1p')"
else
  printf 'deno: not-installed-by-workflow\n'
  missing=1
fi

if [ -x "$CAPTION_FFMPEG" ]; then
  printf 'ffmpeg: %s\n' "$($CAPTION_FFMPEG -version 2>/dev/null | sed -n '1p')"
else
  printf 'ffmpeg: not-installed-by-workflow\n'
  missing=1
fi

if [ -x "$CAPTION_PYTHON" ]; then
  printf 'python: %s\n' "$($CAPTION_PYTHON --version 2>&1)"
else
  printf 'python: not-installed-by-workflow\n'
  missing=1
fi

if [ -x "$CAPTION_YTDLP" ]; then
  printf 'yt-dlp: %s\n' "$($CAPTION_YTDLP --version 2>/dev/null)"
else
  printf 'yt-dlp: not-installed-by-workflow\n'
  missing=1
fi

provider_name=$(caption_configured_provider)
printf 'transcription-provider: %s\n' "$provider_name"
if [ -x "$CAPTION_WHISPER" ]; then
  whisper_version=$($CAPTION_PYTHON -c 'import importlib.metadata; print(importlib.metadata.version("openai-whisper"))' 2>/dev/null || printf installed)
  printf 'whisper: %s\n' "$whisper_version"
else
  printf 'whisper: not-installed-by-workflow\n'
  if [ "$provider_name" = "local" ] || [ "$provider_name" = "both" ]; then missing=1; fi
fi

if [ -x "$CAPTION_PYTHON" ] && "$CAPTION_PYTHON" -c 'import openai' >/dev/null 2>&1; then
  printf 'openai-sdk: installed\n'
else
  printf 'openai-sdk: not-installed-by-workflow\n'
  if [ "$provider_name" = "openai" ] || [ "$provider_name" = "both" ]; then missing=1; fi
fi
if [ -n "${OPENAI_API_KEY:-}" ]; then
  printf 'openai-api-key: present-in-process-environment\n'
else
  printf 'openai-api-key: not-set\n'
fi

if [ -d "$CAPTION_MODELS" ]; then
  model_count=$(find "$CAPTION_MODELS" -maxdepth 1 -type f | wc -l | tr -d ' ')
  printf 'whisper-model-files: %s\n' "$model_count"
else
  printf 'whisper-model-files: 0\n'
fi

printf 'install-scope: %s\n' "$CAPTION_RUNTIME"
printf 'generated-scope: %s\n' "$CAPTION_JOBS"
printf 'external-package-manager-changes: none\n'

if [ -f "$SKILL_DIR/assets/library/index.html" ] && [ -f "$CAPTION_LIBRARY_SERVER" ]; then
  printf 'library-template: available\n'
else
  printf 'library-template: missing\n'
  missing=1
fi

if [ -d "$CAPTION_JOBS" ]; then
  job_count=$(find "$CAPTION_JOBS" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
  status_count=$(find "$CAPTION_JOBS" -mindepth 2 -maxdepth 2 -type f -name status.json | wc -l | tr -d ' ')
  printf 'library-jobs: %s\n' "$job_count"
  printf 'library-status-files: %s\n' "$status_count"
else
  printf 'library-jobs: 0\n'
  printf 'library-status-files: 0\n'
fi

if [ "$missing" -eq 0 ]; then
  printf 'status: ready\n'
  exit 0
fi

printf 'status: setup-required\n'
exit 1
