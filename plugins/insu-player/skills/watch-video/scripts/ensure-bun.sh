#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

if [ "$#" -eq 1 ] && { [ "$1" = "-h" ] || [ "$1" = "--help" ]; }; then
  printf 'usage: ensure-bun.sh <workspace>\n'
  exit 0
fi
[ "$#" -eq 1 ] || caption_die "usage: ensure-bun.sh <workspace>"

caption_set_paths "$1"
caption_assert_safe_workspace
caption_require_command curl
caption_require_command unzip

bun_version="1.3.14"
if [ -x "$CAPTION_BUN" ] && [ "$("$CAPTION_BUN" --version 2>/dev/null || true)" = "$bun_version" ]; then
  caption_note "Workspace-local Bun $bun_version is ready."
  exit 0
fi

case "$(uname -s):$(uname -m)" in
  Darwin:arm64) bun_target="darwin-aarch64" ;;
  Darwin:x86_64) bun_target="darwin-x64" ;;
  Linux:aarch64|Linux:arm64) bun_target="linux-aarch64" ;;
  Linux:x86_64|Linux:amd64) bun_target="linux-x64" ;;
  *) caption_die "unsupported Bun platform: $(uname -s) $(uname -m)" ;;
esac

temp_dir=$(mktemp -d)
trap 'rm -rf -- "$temp_dir"' EXIT
archive_path="$temp_dir/bun.zip"
download_url="https://github.com/oven-sh/bun/releases/download/bun-v${bun_version}/bun-${bun_target}.zip"

caption_note "Installing workspace-local Bun $bun_version..."
curl -fL "$download_url" -o "$archive_path"
unzip -q "$archive_path" -d "$temp_dir/unpacked"
bun_source=$(find "$temp_dir/unpacked" -type f -name bun -print -quit)
[ -n "$bun_source" ] && [ -f "$bun_source" ] || caption_die "Bun archive did not contain the expected binary"
mkdir -p "$CAPTION_BUN_RUNTIME/bin"
install -m 0755 "$bun_source" "$CAPTION_BUN"
[ "$("$CAPTION_BUN" --version)" = "$bun_version" ] || caption_die "workspace-local Bun version check failed"
caption_note "Bun ready: $CAPTION_BUN"
