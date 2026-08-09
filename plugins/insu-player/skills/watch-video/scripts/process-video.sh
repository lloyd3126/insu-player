#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: process-video.sh <workspace> <video-url> [--translate TARGET_BCP47 | --no-translate] [--provider local|openai] [--model NAME] [--language SOURCE_BCP47] [--track CODE] [--device cpu|cuda] [--allow-api-upload] [--no-transcribe]\n'
}

[ "$#" -ge 1 ] || { usage >&2; exit 1; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 0; fi
[ "$#" -ge 2 ] || { usage >&2; exit 1; }

workspace_input="$1"; video_url="$2"; shift 2
provider_name=""; model_name=""; language_code=""; track_code=""; device_name="cpu"; allow_api_upload=0; no_transcribe=0
translation_mode="legacy"; translation_target=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --translate)
      [ "$#" -ge 2 ] || caption_die "--translate requires a language"
      [ "$translation_mode" = "legacy" ] || caption_die "choose only one translation mode"
      translation_mode="translate"; translation_target="$2"; shift 2
      ;;
    --no-translate)
      [ "$translation_mode" = "legacy" ] || caption_die "choose only one translation mode"
      translation_mode="none"; shift
      ;;
    --provider) [ "$#" -ge 2 ] || caption_die "--provider requires a value"; provider_name="$2"; shift 2 ;;
    --model) [ "$#" -ge 2 ] || caption_die "--model requires a value"; model_name="$2"; shift 2 ;;
    --language) [ "$#" -ge 2 ] || caption_die "--language requires a value"; language_code="$2"; shift 2 ;;
    --track) [ "$#" -ge 2 ] || caption_die "--track requires a value"; track_code="$2"; shift 2 ;;
    --device) [ "$#" -ge 2 ] || caption_die "--device requires a value"; device_name="$2"; shift 2 ;;
    --allow-api-upload) allow_api_upload=1; shift ;;
    --no-transcribe) no_transcribe=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

if [ "$translation_mode" = "translate" ]; then
  [ -n "$provider_name" ] || caption_die "translation requires an explicit --provider local or --provider openai after asking the user"
  caption_validate_language "$translation_target"
fi

caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_runtime

download_args=("$CAPTION_WORKSPACE" "$video_url")
if [ "$translation_mode" = "translate" ]; then
  download_args+=(--translate "$translation_target")
elif [ "$translation_mode" = "none" ]; then
  download_args+=(--no-translate)
fi
"$SCRIPT_DIR/download-video.sh" "${download_args[@]}"

video_id=""
for status_file in "$CAPTION_JOBS"/*/status.json; do
  [ -f "$status_file" ] || continue
  candidate_dir=$(dirname "$status_file")
  candidate_url=$(caption_job_state show --job-dir "$candidate_dir" --field sourceUrl 2>/dev/null || true)
  if [ "$candidate_url" = "$video_url" ]; then video_id=$(basename "$candidate_dir"); break; fi
done
[ -n "$video_id" ] || caption_die "download completed but its job record could not be found"

current_state=$(caption_job_state show --job-dir "$CAPTION_JOBS/$video_id" --field state)
if [ "$current_state" = "needs_transcription" ] && [ "$no_transcribe" -eq 0 ]; then
  transcribe_args=("$CAPTION_WORKSPACE" "$video_id" --device "$device_name")
  if [ -n "$provider_name" ]; then transcribe_args+=(--provider "$provider_name"); fi
  if [ -n "$model_name" ]; then transcribe_args+=(--model "$model_name"); fi
  if [ -n "$language_code" ]; then transcribe_args+=(--language "$language_code"); fi
  if [ -n "$track_code" ]; then transcribe_args+=(--track "$track_code"); fi
  if [ "$translation_mode" = "translate" ]; then transcribe_args+=(--target-language "$translation_target"); fi
  if [ "$allow_api_upload" -eq 1 ]; then transcribe_args+=(--allow-api-upload); fi
  if [ "$translation_mode" = "none" ]; then transcribe_args+=(--no-translate); fi
  "$SCRIPT_DIR/transcribe.sh" "${transcribe_args[@]}"
fi

current_state=$(caption_job_state show --job-dir "$CAPTION_JOBS/$video_id" --field state)
caption_note "Job: $video_id"
caption_note "State: $current_state"
case "$current_state" in
  ready) caption_note "The video is ready in the local library." ;;
  needs_translation)
    if [ "$translation_mode" = "translate" ]; then
      caption_note "Polish the complete $translation_target translation, then use segment-subtitles for target-first Source Alignment."
    else
      caption_note "Translate the source subtitle into the requested target language."
    fi
    ;;
  needs_transcription) caption_note "Transcription is pending; rerun without --no-transcribe when ready." ;;
esac
