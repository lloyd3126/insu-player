#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
SKILL_DIR=$(cd "$SCRIPT_DIR/.." && pwd -P)
. "$SCRIPT_DIR/lib.sh"

if [ "$#" -eq 1 ] && { [ "$1" = "-h" ] || [ "$1" = "--help" ]; }; then
  printf 'usage: serve-library.sh <workspace> [port]\n'
  exit 0
fi
[ "$#" -ge 1 ] && [ "$#" -le 2 ] || caption_die "usage: serve-library.sh <workspace> [port]"

caption_set_paths "$1"
caption_assert_safe_workspace
port="${2:-8000}"
case "$port" in ''|*[!0-9]*) caption_die "port must be numeric" ;; esac
[ "$port" -ge 1 ] && [ "$port" -le 65535 ] || caption_die "port must be between 1 and 65535"

server_python=""
if [ -x "$CAPTION_PYTHON" ]; then
  server_python="$CAPTION_PYTHON"
elif command -v python3 >/dev/null 2>&1; then
  server_python=$(command -v python3)
else
  caption_die "Python 3 is required; run setup-environment.sh first"
fi

mkdir -p "$CAPTION_WORKSPACE/jobs"
caption_note "Library: http://127.0.0.1:$port/"
caption_note "Workspace: $CAPTION_WORKSPACE"
caption_note "Press Ctrl+C to stop."
exec "$server_python" "$CAPTION_LIBRARY_SERVER" \
  --workspace "$CAPTION_WORKSPACE" --host 127.0.0.1 --port "$port" \
  --pid-file "$CAPTION_LIBRARY_PID" \
  --library-template "$SKILL_DIR/assets/library" \
  --player-template "$SKILL_DIR/assets/player"
