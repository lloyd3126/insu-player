#!/usr/bin/env bash

PORTABLE_SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
PORTABLE_ROOT=$(cd "$PORTABLE_SCRIPT_DIR/../.." && pwd -P)
PORTABLE_WORKSPACE="$PORTABLE_ROOT/.local/insu-player"
PORTABLE_SKILL="$PORTABLE_ROOT/plugins/insu-player/skills/watch-video"
PORTABLE_MANAGER="$PORTABLE_ROOT/plugins/insu-player/skills/player-manager/scripts/manage.py"
PORTABLE_LEGACY_SLUG="xe""ruca-player"

portable_migrate_workspace() {
  legacy_workspace="$PORTABLE_ROOT/.local/$PORTABLE_LEGACY_SLUG"
  if [ ! -e "$PORTABLE_WORKSPACE" ] && [ -d "$legacy_workspace" ]; then
    mv -- "$legacy_workspace" "$PORTABLE_WORKSPACE"
  fi

  legacy_runtime="$PORTABLE_WORKSPACE/.agent-tools/$PORTABLE_LEGACY_SLUG"
  current_runtime="$PORTABLE_WORKSPACE/.agent-tools/insu-player"
  if [ ! -e "$current_runtime" ] && [ -d "$legacy_runtime" ]; then
    mv -- "$legacy_runtime" "$current_runtime"
  fi
}

portable_require_layout() {
  [ -f "$PORTABLE_ROOT/VERSION" ] || { printf 'error: VERSION is missing from %s\n' "$PORTABLE_ROOT" >&2; exit 1; }
  [ -f "$PORTABLE_SKILL/SKILL.md" ] || { printf 'error: INSU watch-video skill is missing\n' >&2; exit 1; }
  [ -f "$PORTABLE_MANAGER" ] || { printf 'error: INSU player manager is missing\n' >&2; exit 1; }
  case "$PORTABLE_WORKSPACE/" in
    "$PORTABLE_ROOT"/.local/*) ;;
    *) printf 'error: portable workspace escaped the repository root\n' >&2; exit 1 ;;
  esac
}

portable_require_layout
portable_migrate_workspace
