#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
XERUCA_SKILL_DIR=$(cd "$SCRIPT_DIR/.." && pwd -P)
. "$SCRIPT_DIR/lib.sh"

if [ "$#" -eq 1 ] && { [ "$1" = "-h" ] || [ "$1" = "--help" ]; }; then
  printf 'usage: update-environment.sh <workspace> [--provider local|openai|both]\n'
  exit 0
fi
if [ "$#" -lt 1 ] || [ "$#" -gt 3 ]; then caption_die "usage: update-environment.sh <workspace> [--provider local|openai|both]"; fi

workspace_input="$1"
shift
caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_runtime
caption_require_command curl
provider_name=$(caption_configured_provider)
model_name=$(caption_state_value "$CAPTION_STATE" DEFAULT_MODEL)
model_name="${model_name:-turbo}"
if [ "$#" -gt 0 ]; then
  [ "$1" = "--provider" ] && [ "$#" -eq 2 ] || caption_die "usage: update-environment.sh <workspace> [--provider local|openai|both]"
  provider_name="$2"
fi
case "$provider_name" in local|openai|both) ;; *) caption_die "provider must be local, openai, or both" ;; esac

caption_note "Updating workflow-local uv..."
curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$CAPTION_BIN" sh

caption_note "Updating workflow-local Deno..."
"$CAPTION_DENO" upgrade

caption_note "Updating Python packages..."
"$CAPTION_UV" python install 3.11
"$CAPTION_UV" pip install --python "$CAPTION_PYTHON" --upgrade -r "$XERUCA_SKILL_DIR/requirements-core.txt"
if [ "$provider_name" = "local" ] || [ "$provider_name" = "both" ]; then
  "$CAPTION_UV" pip install --python "$CAPTION_PYTHON" --upgrade -r "$XERUCA_SKILL_DIR/requirements-local.txt"
fi
if [ "$provider_name" = "openai" ] || [ "$provider_name" = "both" ]; then
  "$CAPTION_UV" pip install --python "$CAPTION_PYTHON" --upgrade -r "$XERUCA_SKILL_DIR/requirements-openai.txt"
fi
"$CAPTION_UV" pip freeze --python "$CAPTION_PYTHON" > "$CAPTION_RUNTIME/requirements.lock.txt"
ffmpeg_source=$(IMAGEIO_FFMPEG_EXE= "$CAPTION_PYTHON" -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')
install -m 0755 "$ffmpeg_source" "$CAPTION_FFMPEG"
{
  printf 'INSTALL_SCOPE=workspace-only\n'
  printf 'PYTHON_SERIES=3.11\n'
  printf 'DEFAULT_MODEL=%s\n' "$model_name"
  printf 'TRANSCRIPTION_PROVIDER=%s\n' "$provider_name"
  printf 'FFMPEG_PATH=%s\n' "$CAPTION_FFMPEG"
} > "$CAPTION_STATE"

caption_note "Update complete. Run doctor.sh and test with a known short video."
