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

for ignored_command in ffmpeg ffprobe python3 yt-dlp deno uv bun; do
  if command -v "$ignored_command" >/dev/null 2>&1; then
    printf 'system-%s: %s (detected, not used by workflow)\n' "$ignored_command" "$(command -v "$ignored_command")"
  else
    printf 'system-%s: absent (not required)\n' "$ignored_command"
  fi
done

if [ -x "$CAPTION_BUN" ]; then
  printf 'bun: %s\n' "$("$CAPTION_BUN" --version 2>/dev/null || printf installed-but-unreadable)"
else
  printf 'bun: not-installed-by-workflow\n'
  missing=1
fi

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

if [ -x "$CAPTION_WHISPER" ]; then
  whisper_version=$($CAPTION_PYTHON -c 'import importlib.metadata; print(importlib.metadata.version("openai-whisper"))' 2>/dev/null || printf installed)
  printf 'whisper: %s\n' "$whisper_version"
else
  printf 'whisper: not-installed-by-workflow\n'
  missing=1
fi

for provider_spec in 'openai:openai:OPENAI_API_KEY' 'groq:groq:GROQ_API_KEY' 'elevenlabs:elevenlabs:ELEVENLABS_API_KEY' 'xai:httpx:XAI_API_KEY' 'openrouter:openai:OPENROUTER_API_KEY'; do
  IFS=: read -r provider_module python_module key_name <<EOF
$provider_spec
EOF
  if [ -x "$CAPTION_PYTHON" ] && "$CAPTION_PYTHON" -c "import $python_module" >/dev/null 2>&1; then
    printf '%s-sdk: installed\n' "$provider_module"
  else
    printf '%s-sdk: not-installed-by-workflow\n' "$provider_module"
    missing=1
  fi
  key_value="${!key_name:-}"
  if [ -n "$key_value" ]; then
    printf '%s-api-key: present-in-process-environment\n' "$provider_module"
  else
    printf '%s-api-key: not-set\n' "$provider_module"
  fi
done

if [ -d "$CAPTION_MODELS" ]; then
  model_count=$(find "$CAPTION_MODELS" -maxdepth 1 -type f | wc -l | tr -d ' ')
  printf 'whisper-model-files: %s\n' "$model_count"
else
  printf 'whisper-model-files: 0\n'
fi

printf 'install-scope: %s\n' "$CAPTION_RUNTIME"
printf 'generated-scope: %s\n' "$CAPTION_JOBS"
printf 'external-package-manager-changes: none\n'

if [ -f "$CAPTION_LIBRARY_APP/index.html" ] && [ -f "$CAPTION_WEB_SERVER" ] && [ -f "$CAPTION_DATABASE_SCHEMA" ]; then
  printf 'library-template: react-vite\n'
  printf 'library-server: hono-drizzle-bun-sqlite\n'
else
  printf 'library-template: missing\n'
  missing=1
fi

if [ -d "$CAPTION_JOBS" ]; then
  job_count=$(find "$CAPTION_JOBS" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
  printf 'library-jobs: %s\n' "$job_count"
  if [ -f "$CAPTION_WORKSPACE/app.db" ]; then
    record_count=$("$CAPTION_PYTHON" - "$CAPTION_WORKSPACE/app.db" <<'PY'
import sqlite3,sys
with sqlite3.connect(sys.argv[1]) as db:
    print(db.execute("SELECT COUNT(*) FROM media_items").fetchone()[0])
PY
)
  else
    record_count=0
  fi
  printf 'library-database-records: %s\n' "$record_count"
else
  printf 'library-jobs: 0\n'
  printf 'library-database-records: 0\n'
fi

if [ "$missing" -eq 0 ]; then
  printf 'status: ready\n'
  exit 0
fi

printf 'status: setup-required\n'
exit 1
