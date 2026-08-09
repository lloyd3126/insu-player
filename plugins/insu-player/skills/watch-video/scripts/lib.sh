#!/usr/bin/env bash

CAPTION_SKILL_SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)

caption_die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

caption_note() {
  printf '%s\n' "$*"
}

caption_abs_path() {
  local input_path="$1"
  local parent_path
  local base_name

  case "$input_path" in
    /*) ;;
    *) input_path="$PWD/$input_path" ;;
  esac

  if [ -d "$input_path" ]; then
    (cd "$input_path" && pwd -P)
    return
  fi

  parent_path=$(dirname "$input_path")
  base_name=$(basename "$input_path")
  if [ -d "$parent_path" ]; then
    parent_path=$(cd "$parent_path" && pwd -P)
  fi
  printf '%s/%s\n' "${parent_path%/}" "$base_name"
}

caption_set_paths() {
  [ "$#" -eq 1 ] || caption_die "caption_set_paths requires one workspace path"

  if [ -z "${CAPTION_SYSTEM_HOME+x}" ]; then
    CAPTION_SYSTEM_HOME="${HOME:-}"
  fi
  CAPTION_WORKSPACE=$(caption_abs_path "$1")
  CAPTION_RUNTIME="$CAPTION_WORKSPACE/.agent-tools/insu-player"
  CAPTION_BIN="$CAPTION_RUNTIME/bin"
  CAPTION_VENV="$CAPTION_RUNTIME/.venv"
  CAPTION_MODELS="$CAPTION_RUNTIME/models"
  CAPTION_UV_CACHE="$CAPTION_RUNTIME/uv-cache"
  CAPTION_UV_PYTHON="$CAPTION_RUNTIME/python"
  CAPTION_DENO_CACHE="$CAPTION_RUNTIME/deno-cache"
  CAPTION_BUN_RUNTIME="$CAPTION_RUNTIME/bun-runtime"
  CAPTION_XDG_CACHE="$CAPTION_RUNTIME/xdg-cache"
  CAPTION_PYTHON_CACHE="$CAPTION_RUNTIME/python-cache"
  CAPTION_TORCH_CACHE="$CAPTION_RUNTIME/torch-cache"
  CAPTION_TIKTOKEN_CACHE="$CAPTION_RUNTIME/tiktoken-cache"
  CAPTION_HF_CACHE="$CAPTION_RUNTIME/huggingface-cache"
  CAPTION_YTDLP_CACHE="$CAPTION_RUNTIME/yt-dlp-cache"
  CAPTION_TEMP="$CAPTION_RUNTIME/tmp"
  CAPTION_LOCAL_HOME="$CAPTION_RUNTIME/home"
  CAPTION_XDG_CONFIG="$CAPTION_RUNTIME/xdg-config"
  CAPTION_XDG_DATA="$CAPTION_RUNTIME/xdg-data"
  CAPTION_XDG_STATE="$CAPTION_RUNTIME/xdg-state"
  CAPTION_STATE="$CAPTION_RUNTIME/install-state.env"
  CAPTION_UV="$CAPTION_BIN/uv"
  CAPTION_DENO="$CAPTION_BIN/deno"
  CAPTION_BUN="$CAPTION_BUN_RUNTIME/bin/bun"
  CAPTION_FFMPEG="$CAPTION_BIN/ffmpeg"
  CAPTION_PYTHON="$CAPTION_VENV/bin/python"
  CAPTION_YTDLP="$CAPTION_VENV/bin/yt-dlp"
  CAPTION_WHISPER="$CAPTION_VENV/bin/whisper"
  CAPTION_OPENAI_TRANSCRIBER="$CAPTION_SKILL_SCRIPT_DIR/../../transcribe-media/scripts/transcribe_media.py"
  CAPTION_JOBS="$CAPTION_WORKSPACE/jobs"
  CAPTION_JOB_STATE="$CAPTION_SKILL_SCRIPT_DIR/job_state.py"
  CAPTION_PROGRESS_RUNNER="$CAPTION_SKILL_SCRIPT_DIR/run_progress.py"
  CAPTION_LIBRARY_SERVER="$CAPTION_SKILL_SCRIPT_DIR/library_server.py"
  CAPTION_WEB_SERVER="$CAPTION_SKILL_SCRIPT_DIR/../assets/server/insu-player-server.js"
  CAPTION_WEB_MIGRATIONS="$CAPTION_SKILL_SCRIPT_DIR/../assets/server/drizzle"
  CAPTION_LIBRARY_APP="$CAPTION_SKILL_SCRIPT_DIR/../assets/library/app"
  CAPTION_ENVIRONMENT_SESSION="$CAPTION_SKILL_SCRIPT_DIR/environment_session.py"
  CAPTION_LIBRARY_PID="$CAPTION_WORKSPACE/.insu-player-server.pid"
  CAPTION_LIBRARY_DESCRIPTOR="$CAPTION_WORKSPACE/.insu-player-server.json"
  CAPTION_ENVIRONMENT_DESCRIPTOR="$CAPTION_WORKSPACE/.insu-environment-session.json"

  export UV_CACHE_DIR="$CAPTION_UV_CACHE"
  export UV_PYTHON_INSTALL_DIR="$CAPTION_UV_PYTHON"
  export UV_PYTHON_BIN_DIR="$CAPTION_BIN"
  export DENO_DIR="$CAPTION_DENO_CACHE"
  export XDG_CACHE_HOME="$CAPTION_XDG_CACHE"
  export PYTHONPYCACHEPREFIX="$CAPTION_PYTHON_CACHE"
  export TORCH_HOME="$CAPTION_TORCH_CACHE"
  export TIKTOKEN_CACHE_DIR="$CAPTION_TIKTOKEN_CACHE"
  export HF_HOME="$CAPTION_HF_CACHE"
  export IMAGEIO_FFMPEG_EXE="$CAPTION_FFMPEG"
  export HOME="$CAPTION_LOCAL_HOME"
  export XDG_CONFIG_HOME="$CAPTION_XDG_CONFIG"
  export XDG_DATA_HOME="$CAPTION_XDG_DATA"
  export XDG_STATE_HOME="$CAPTION_XDG_STATE"
  export TMPDIR="$CAPTION_TEMP"
}

caption_assert_safe_workspace() {
  [ -n "${CAPTION_WORKSPACE:-}" ] || caption_die "workspace is not initialized"
  [ "$CAPTION_WORKSPACE" != "/" ] || caption_die "refusing to use the filesystem root as workspace"
  if [ -n "${CAPTION_SYSTEM_HOME:-}" ] && [ "$CAPTION_WORKSPACE" = "$CAPTION_SYSTEM_HOME" ]; then
    caption_die "refusing to use the home directory as workspace; choose a dedicated child directory"
  fi
}

caption_require_runtime() {
  [ -x "$CAPTION_PYTHON" ] || caption_die "runtime is not installed: run setup-environment.sh first"
  [ -x "$CAPTION_YTDLP" ] || caption_die "yt-dlp is missing: run setup-environment.sh first"
  [ -x "$CAPTION_DENO" ] || caption_die "Deno is missing: run setup-environment.sh first"
  [ -x "$CAPTION_FFMPEG" ] || caption_die "workflow-local FFmpeg is missing: run setup-environment.sh first"
}

caption_configured_provider() {
  local provider
  provider=$(caption_state_value "$CAPTION_STATE" TRANSCRIPTION_PROVIDER)
  printf '%s\n' "${provider:-local}"
}

caption_require_provider() {
  local provider="$1"
  case "$provider" in
    local)
      [ -x "$CAPTION_WHISPER" ] || caption_die "local Whisper is missing: rerun setup-environment.sh --provider local"
      ;;
    openai)
      "$CAPTION_PYTHON" -c 'import openai' >/dev/null 2>&1 || caption_die "OpenAI SDK is missing: rerun setup-environment.sh --provider openai"
      if [ -z "${OPENAI_API_KEY:-}" ]; then
        [ -f "$CAPTION_ENVIRONMENT_SESSION" ] || caption_die "OPENAI_API_KEY is not set in the current process or INSU session"
        "$CAPTION_PYTHON" "$CAPTION_ENVIRONMENT_SESSION" --workspace "$CAPTION_WORKSPACE" --name OPENAI_API_KEY check >/dev/null 2>&1 || \
          caption_die "OPENAI_API_KEY is not set in the current process or INSU session"
      fi
      ;;
    *) caption_die "provider must be local or openai" ;;
  esac
}

caption_require_python() {
  [ -x "$CAPTION_PYTHON" ] || caption_die "workflow Python is missing: run setup-environment.sh first"
}

caption_job_state() {
  caption_require_python
  "$CAPTION_PYTHON" "$CAPTION_JOB_STATE" "$@"
}

caption_validate_video_id() {
  case "$1" in
    ''|*[!A-Za-z0-9_-]*) caption_die "invalid video ID: $1" ;;
  esac
}

caption_validate_language() {
  case "$1" in
    ''|*[!A-Za-z0-9_-]*) caption_die "invalid language code: $1" ;;
  esac
}

caption_require_file() {
  [ -f "$1" ] || caption_die "file not found: $1"
}

caption_require_command() {
  command -v "$1" >/dev/null 2>&1 || caption_die "required command not found: $1"
}

caption_validate_vtt() {
  local vtt_path="$1"
  caption_require_file "$vtt_path"
  grep -q '^WEBVTT' "$vtt_path" || caption_die "VTT header missing: $vtt_path"
  grep -q -- '-->' "$vtt_path" || caption_die "no VTT cues found: $vtt_path"
}

caption_state_value() {
  local state_path="$1"
  local state_key="$2"
  [ -f "$state_path" ] || return 0
  awk -F= -v wanted="$state_key" '$1 == wanted { value = substr($0, index($0, "=") + 1); print value; exit }' "$state_path"
}
