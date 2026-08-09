#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd -P)
WORKSPACE="$REPO_ROOT/.local/insu-player"
ENSURE_BUN="$REPO_ROOT/plugins/insu-player/skills/watch-video/scripts/ensure-bun.sh"

if [ -n "${INSU_BUN:-}" ]; then
  bun_bin="$INSU_BUN"
elif command -v bun >/dev/null 2>&1; then
  bun_bin=$(command -v bun)
elif [ -x "$WORKSPACE/.agent-tools/insu-player/bun-runtime/bin/bun" ]; then
  bun_bin="$WORKSPACE/.agent-tools/insu-player/bun-runtime/bin/bun"
else
  "$ENSURE_BUN" "$WORKSPACE"
  bun_bin="$WORKSPACE/.agent-tools/insu-player/bun-runtime/bin/bun"
fi

[ -x "$bun_bin" ] || { printf 'error: Bun runtime is unavailable: %s\n' "$bun_bin" >&2; exit 1; }
export PATH="$(dirname "$bun_bin"):$PATH"

cd "$REPO_ROOT"
"$bun_bin" install --frozen-lockfile
"$bun_bin" run check
"$bun_bin" run build

printf 'web client: %s\n' "$REPO_ROOT/plugins/insu-player/skills/watch-video/assets/library/app/index.html"
printf 'web server: %s\n' "$REPO_ROOT/plugins/insu-player/skills/watch-video/assets/server/insu-player-server.js"
