#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: import-caption.sh <workspace> <video-id> <language> <vtt-file> --source-type manual-cc|model-transcript --provider yt-dlp|local|openai [--model NAME] [--timing-unit-kind cue|word|token|grapheme-group] [--revision N]\n'
}

[ "$#" -ge 1 ] || { usage >&2; exit 1; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 0; fi
[ "$#" -ge 6 ] || { usage >&2; exit 1; }

workspace_input="$1"; video_id="$2"; language_code="$3"; source_file="$4"; shift 4
source_type=""; provider_name=""; model_name=""; timing_unit_kind=""; artifact_revision=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source-type) [ "$#" -ge 2 ] || caption_die "--source-type requires a value"; source_type="$2"; shift 2 ;;
    --provider) [ "$#" -ge 2 ] || caption_die "--provider requires a value"; provider_name="$2"; shift 2 ;;
    --model) [ "$#" -ge 2 ] || caption_die "--model requires a value"; model_name="$2"; shift 2 ;;
    --timing-unit-kind) [ "$#" -ge 2 ] || caption_die "--timing-unit-kind requires a value"; timing_unit_kind="$2"; shift 2 ;;
    --revision) [ "$#" -ge 2 ] || caption_die "--revision requires a value"; artifact_revision="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

caption_validate_video_id "$video_id"
caption_validate_language "$language_code"
case "$source_type" in manual-cc|model-transcript) ;; *) caption_die "--source-type must be manual-cc or model-transcript" ;; esac
if [ "$source_type" = "manual-cc" ]; then
  [ "$provider_name" = "yt-dlp" ] || caption_die "manual CC requires --provider yt-dlp"
  [ -z "$model_name" ] || caption_die "manual CC cannot record a model"
  timing_unit_kind="${timing_unit_kind:-cue}"
  [ "$timing_unit_kind" = "cue" ] || caption_die "manual CC must use cue timing"
else
  case "$provider_name" in local|openai) ;; *) caption_die "model transcripts require --provider local or openai" ;; esac
  [ -n "$model_name" ] || caption_die "model transcripts require --model"
  timing_unit_kind="${timing_unit_kind:-word}"
  case "$timing_unit_kind" in word|token|grapheme-group) ;; *) caption_die "model transcripts require word, token, or grapheme-group timing" ;; esac
fi
case "$artifact_revision" in ''|*[!0-9]*) caption_die "--revision must be a positive integer" ;; esac
[ "$artifact_revision" -ge 1 ] || caption_die "--revision must be a positive integer"
case "$model_name" in *[!A-Za-z0-9._-]*) caption_die "invalid model name" ;; esac

caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_python
caption_validate_vtt "$source_file"

job_dir="$CAPTION_JOBS/$video_id"
[ -d "$job_dir" ] || caption_die "job not found: $job_dir"
artifact_id="$video_id-source-$source_type-$language_code-r$artifact_revision"
artifact_dir="$job_dir/subtitle-work/artifacts/$artifact_id"
destination="$artifact_dir/source.vtt"
if [ -d "$artifact_dir" ]; then
  [ -f "$destination" ] && cmp -s "$source_file" "$destination" || caption_die "subtitle artifact revision already exists with different content: $artifact_id"
else
  mkdir -p "$artifact_dir"
  temporary=$(mktemp "$artifact_dir/.track.XXXXXX")
  trap 'rm -f -- "$temporary"' EXIT
  cp "$source_file" "$temporary"
  mv "$temporary" "$destination"
  trap - EXIT
fi
caption_validate_vtt "$destination"

artifact_args=(
  --job-dir "$job_dir"
  --id "$artifact_id"
  --kind source
  --revision "$artifact_revision"
  --lifecycle-state ready
  --validation-state valid
  --freshness-state current
  --source-language "$language_code"
  --source-type "$source_type"
  --provider "$provider_name"
  --timing-unit-kind "$timing_unit_kind"
  --track "$language_code" source_raw "$destination"
)
if [ -n "$model_name" ]; then artifact_args+=(--model "$model_name"); fi
caption_job_state subtitle-artifact "${artifact_args[@]}" >/dev/null

caption_note "Source subtitle artifact imported: $artifact_id"
