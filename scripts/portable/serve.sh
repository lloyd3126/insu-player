#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/common.sh"

port="${1:-8000}"
[ "$#" -le 1 ] || { printf 'usage: serve.sh [PORT]\n' >&2; exit 1; }
exec "$PORTABLE_SKILL/scripts/serve-library.sh" "$PORTABLE_WORKSPACE" "$port"
