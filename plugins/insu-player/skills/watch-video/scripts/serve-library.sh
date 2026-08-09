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
auto_port=0
[ "$#" -eq 1 ] && auto_port=1
case "$port" in ''|*[!0-9]*) caption_die "port must be numeric" ;; esac
[ "$port" -ge 1 ] && [ "$port" -le 65535 ] || caption_die "port must be between 1 and 65535"

"$SCRIPT_DIR/ensure-bun.sh" "$CAPTION_WORKSPACE"
[ -x "$CAPTION_BUN" ] || caption_die "workspace-local Bun is unavailable"
[ -f "$CAPTION_WEB_SERVER" ] || caption_die "Hono server bundle is missing from this INSU Player package"
[ -f "$CAPTION_LIBRARY_APP/index.html" ] || caption_die "React library build is missing from this INSU Player package"
[ -f "$CAPTION_WEB_MIGRATIONS/meta/_journal.json" ] || caption_die "Drizzle migrations are missing from this INSU Player package"

mkdir -p "$CAPTION_WORKSPACE/jobs"
server_arguments=(
  --workspace "$CAPTION_WORKSPACE"
  --host 127.0.0.1
  --port "$port"
  --pid-file "$CAPTION_LIBRARY_PID"
  --library-template "$CAPTION_LIBRARY_APP"
  --player-template "$SKILL_DIR/assets/player"
  --migrations "$CAPTION_WEB_MIGRATIONS"
)
[ "$auto_port" -eq 0 ] || server_arguments+=(--auto-port)
exec "$CAPTION_BUN" "$CAPTION_WEB_SERVER" "${server_arguments[@]}"
