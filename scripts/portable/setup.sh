#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/common.sh"

mkdir -p "$PORTABLE_WORKSPACE"
exec "$PORTABLE_SKILL/scripts/setup-environment.sh" "$PORTABLE_WORKSPACE" "$@"
