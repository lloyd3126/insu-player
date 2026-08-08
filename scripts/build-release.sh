#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd -P)
version=$(sed -n '1p' "$REPO_ROOT/VERSION")
output_dir="${1:-$REPO_ROOT/dist}"

case "$version" in
  ''|*[!0-9A-Za-z.-]*) printf 'error: invalid VERSION: %s\n' "$version" >&2; exit 1 ;;
esac

for command_name in tar zip find sort; do
  command -v "$command_name" >/dev/null 2>&1 || { printf 'error: required command not found: %s\n' "$command_name" >&2; exit 1; }
done
if command -v shasum >/dev/null 2>&1; then
  checksum_command=(shasum -a 256)
elif command -v sha256sum >/dev/null 2>&1; then
  checksum_command=(sha256sum)
else
  printf 'error: shasum or sha256sum is required\n' >&2
  exit 1
fi

output_dir=$(mkdir -p "$output_dir" && cd "$output_dir" && pwd -P)
archive_name="xeruca-player-v${version}-portable.zip"
archive_path="$output_dir/$archive_name"
checksum_path="$archive_path.sha256"
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
package_name="xeruca-player-v${version}"
package_dir="$stage/$package_name"
mkdir -p "$package_dir"

if [ "${XERUCA_RELEASE_SOURCE:-commit}" = "commit" ] && git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$REPO_ROOT" archive --format=tar HEAD | tar -xf - -C "$package_dir"
else
  tar \
    --exclude='./.git' \
    --exclude='./.local' \
    --exclude='./dist' \
    --exclude='./.DS_Store' \
    --exclude='*/__pycache__' \
    --exclude='*.pyc' \
    --exclude='*.pyo' \
    --exclude='./.env' \
    --exclude='./.env.*' \
    -cf - -C "$REPO_ROOT" . | tar -xf - -C "$package_dir"
fi

(
  cd "$package_dir"
  find . -type f ! -name MANIFEST.sha256 -print | LC_ALL=C sort | while IFS= read -r path; do
    "${checksum_command[@]}" "$path"
  done > MANIFEST.sha256
)

(
  cd "$stage"
  zip -qr "$archive_path" "$package_name" -x '*/.DS_Store' '*/__pycache__/*' '*.pyc' '*.pyo'
)

(
  cd "$output_dir"
  "${checksum_command[@]}" "$archive_name" > "$(basename "$checksum_path")"
)

printf 'archive: %s\n' "$archive_path"
printf 'checksum: %s\n' "$checksum_path"
