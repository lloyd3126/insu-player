#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/common.sh"

runtime_python="$PORTABLE_WORKSPACE/.agent-tools/xeruca-player/.venv/bin/python"
if [ -x "$runtime_python" ]; then
  exec "$runtime_python" "$PORTABLE_MANAGER" update --mode portable "$@"
fi
if command -v python3 >/dev/null 2>&1; then
  exec python3 "$PORTABLE_MANAGER" update --mode portable "$@"
fi
printf 'error: update requires the workflow runtime; run scripts/portable/setup.sh first\n' >&2
exit 1
