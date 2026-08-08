#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
INSU_SKILL_DIR=$(cd "$SCRIPT_DIR/.." && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: setup-environment.sh <workspace> [--provider local|openai|both] [--model NAME] [--skip-model]\n'
}

[ "$#" -ge 1 ] || { usage >&2; exit 1; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  usage
  exit 0
fi

workspace_input="$1"
shift
model_name="medium"
provider_name="local"
skip_model=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --provider)
      [ "$#" -ge 2 ] || caption_die "--provider requires a value"
      provider_name="$2"
      shift 2
      ;;
    --model)
      [ "$#" -ge 2 ] || caption_die "--model requires a value"
      model_name="$2"
      shift 2
      ;;
    --skip-model)
      skip_model=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      caption_die "unknown option: $1"
      ;;
  esac
done

case "$provider_name" in
  local|openai|both) ;;
  *) caption_die "provider must be local, openai, or both" ;;
esac

case "$model_name" in
  ''|*[!A-Za-z0-9._-]*) caption_die "model name contains unsupported characters: $model_name" ;;
esac

caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_command curl
caption_require_command unzip

mkdir -p \
  "$CAPTION_WORKSPACE" "$CAPTION_BIN" "$CAPTION_MODELS" "$CAPTION_UV_CACHE" \
  "$CAPTION_UV_PYTHON" "$CAPTION_DENO_CACHE" "$CAPTION_XDG_CACHE" \
  "$CAPTION_PYTHON_CACHE" "$CAPTION_TORCH_CACHE" "$CAPTION_TIKTOKEN_CACHE" \
  "$CAPTION_HF_CACHE" "$CAPTION_YTDLP_CACHE" "$CAPTION_TEMP" "$CAPTION_LOCAL_HOME" \
  "$CAPTION_XDG_CONFIG" "$CAPTION_XDG_DATA" "$CAPTION_XDG_STATE"

write_install_state() {
  {
    printf 'INSTALL_SCOPE=workspace-only\n'
    printf 'PYTHON_SERIES=3.11\n'
    printf 'DEFAULT_MODEL=%s\n' "$model_name"
    printf 'TRANSCRIPTION_PROVIDER=%s\n' "$provider_name"
    printf 'FFMPEG_PATH=%s\n' "$CAPTION_FFMPEG"
  } > "$CAPTION_STATE"
}

caption_note "Installing workflow-local uv..."
curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$CAPTION_BIN" sh
[ -x "$CAPTION_UV" ] || caption_die "uv installation did not produce $CAPTION_UV"

install_deno_binary() {
  local deno_target
  local temp_dir
  local archive_path

  case "$(uname -s):$(uname -m)" in
    Darwin:arm64) deno_target="aarch64-apple-darwin" ;;
    Darwin:x86_64) deno_target="x86_64-apple-darwin" ;;
    Linux:aarch64|Linux:arm64) deno_target="aarch64-unknown-linux-gnu" ;;
    Linux:x86_64|Linux:amd64) deno_target="x86_64-unknown-linux-gnu" ;;
    *) caption_die "unsupported Deno platform: $(uname -s) $(uname -m)" ;;
  esac

  temp_dir=$(mktemp -d)
  archive_path="$temp_dir/deno.zip"
  trap "rm -rf -- '$temp_dir'" EXIT
  curl -fL "https://github.com/denoland/deno/releases/latest/download/deno-${deno_target}.zip" -o "$archive_path"
  unzip -q "$archive_path" -d "$temp_dir"
  install -m 0755 "$temp_dir/deno" "$CAPTION_DENO"
  rm -rf -- "$temp_dir"
  trap - EXIT
}

if [ ! -x "$CAPTION_DENO" ]; then
  caption_note "Installing workflow-local Deno..."
  install_deno_binary
fi

caption_note "Installing Python 3.11 and creating the isolated environment..."
"$CAPTION_UV" python install 3.11
if [ ! -x "$CAPTION_PYTHON" ]; then
  "$CAPTION_UV" venv --python 3.11 "$CAPTION_VENV"
fi

caption_note "Installing core Python packages..."
"$CAPTION_UV" pip install --python "$CAPTION_PYTHON" --upgrade -r "$INSU_SKILL_DIR/requirements-core.txt"
if [ "$provider_name" = "local" ] || [ "$provider_name" = "both" ]; then
  caption_note "Installing local Whisper provider..."
  "$CAPTION_UV" pip install --python "$CAPTION_PYTHON" --upgrade -r "$INSU_SKILL_DIR/requirements-local.txt"
fi
if [ "$provider_name" = "openai" ] || [ "$provider_name" = "both" ]; then
  caption_note "Installing OpenAI API provider..."
  "$CAPTION_UV" pip install --python "$CAPTION_PYTHON" --upgrade -r "$INSU_SKILL_DIR/requirements-openai.txt"
fi
"$CAPTION_UV" pip freeze --python "$CAPTION_PYTHON" > "$CAPTION_RUNTIME/requirements.lock.txt"

caption_note "Installing the workflow-local FFmpeg binary..."
ffmpeg_source=$(IMAGEIO_FFMPEG_EXE= "$CAPTION_PYTHON" -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')
[ -f "$ffmpeg_source" ] || caption_die "imageio-ffmpeg did not provide a binary for this platform"
install -m 0755 "$ffmpeg_source" "$CAPTION_FFMPEG"
"$CAPTION_FFMPEG" -version >/dev/null 2>&1 || caption_die "workflow-local FFmpeg failed its version check"

if { [ "$provider_name" = "local" ] || [ "$provider_name" = "both" ]; } && [ "$skip_model" -eq 0 ]; then
  caption_note "Downloading Whisper model: $model_name"
  "$CAPTION_PYTHON" -c 'import sys, whisper; whisper.load_model(sys.argv[1], download_root=sys.argv[2]); print("model ready:", sys.argv[1])' "$model_name" "$CAPTION_MODELS"
fi

if [ "$provider_name" = "openai" ] || [ "$provider_name" = "both" ]; then
  caption_note "OpenAI API support is installed. Set OPENAI_API_KEY only in the terminal when you authorize an upload."
fi

write_install_state

caption_note "Setup complete. Run: $SCRIPT_DIR/doctor.sh $CAPTION_WORKSPACE"
