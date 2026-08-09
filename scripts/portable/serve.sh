#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/common.sh"

[ "$#" -le 1 ] || { printf 'usage: serve.sh [PORT]\n' >&2; exit 1; }
if [ "$#" -eq 0 ]; then
  exec "$PORTABLE_SKILL/scripts/serve-library.sh" "$PORTABLE_WORKSPACE"
fi
exec "$PORTABLE_SKILL/scripts/serve-library.sh" "$PORTABLE_WORKSPACE" "$1"
