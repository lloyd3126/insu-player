#!/usr/bin/env bash
set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/common.sh"

exec "$PORTABLE_SKILL/scripts/doctor.sh" "$PORTABLE_WORKSPACE"
