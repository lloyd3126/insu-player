#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: process-video.sh <workspace> <video-url> --language SOURCE_BCP47 [--translate TARGET_BCP47 | --proofread] --provider local|openai [--model NAME] [--device cpu|cuda] [--allow-api-upload] [--allow-low-quality] [--no-transcribe]\n'
}

[ "$#" -ge 1 ] || { usage >&2; exit 1; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 0; fi
[ "$#" -ge 2 ] || { usage >&2; exit 1; }

workspace_input="$1"; video_url="$2"; shift 2
provider_name=""; model_name=""; language_code=""; device_name="cpu"; allow_api_upload=0; allow_low_quality=0; no_transcribe=0
translation_mode=""; translation_target=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --translate)
      [ "$#" -ge 2 ] || caption_die "--translate requires a language"
      [ -z "$translation_mode" ] || caption_die "choose only one translation mode"
      translation_mode="translate"; translation_target="$2"; shift 2
      ;;
    --proofread)
      [ -z "$translation_mode" ] || caption_die "choose only one translation mode"
      translation_mode="proofread"; shift
      ;;
    --provider) [ "$#" -ge 2 ] || caption_die "--provider requires a value"; provider_name="$2"; shift 2 ;;
    --model) [ "$#" -ge 2 ] || caption_die "--model requires a value"; model_name="$2"; shift 2 ;;
    --language) [ "$#" -ge 2 ] || caption_die "--language requires a value"; language_code="$2"; shift 2 ;;
    --device) [ "$#" -ge 2 ] || caption_die "--device requires a value"; device_name="$2"; shift 2 ;;
    --allow-api-upload) allow_api_upload=1; shift ;;
    --allow-low-quality) allow_low_quality=1; shift ;;
    --no-transcribe) no_transcribe=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

[ -n "$translation_mode" ] || caption_die "choose --translate TARGET_BCP47 or --proofread after asking the user"
[ -n "$language_code" ] || caption_die "--language SOURCE_BCP47 is required"
caption_validate_language "$language_code"
[ -n "$provider_name" ] || caption_die "subtitle production requires an explicit --provider local or --provider openai after asking the user"
if [ "$translation_mode" = "translate" ]; then
  caption_validate_language "$translation_target"
  [ "$translation_target" != "$language_code" ] || caption_die "translation target must differ from the source language"
fi

caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_runtime

download_args=("$CAPTION_WORKSPACE" "$video_url" --language "$language_code")
if [ "$translation_mode" = "translate" ]; then
  download_args+=(--translate "$translation_target")
elif [ "$translation_mode" = "proofread" ]; then
  download_args+=(--proofread)
fi
if [ "$allow_low_quality" -eq 1 ]; then download_args+=(--allow-low-quality); fi
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
  transcribe_args=("$CAPTION_WORKSPACE" "$video_id" --mode "$translation_mode" --language "$language_code" --device "$device_name")
  if [ -n "$provider_name" ]; then transcribe_args+=(--provider "$provider_name"); fi
  if [ -n "$model_name" ]; then transcribe_args+=(--model "$model_name"); fi
  if [ "$translation_mode" = "translate" ]; then transcribe_args+=(--output-language "$translation_target"); else transcribe_args+=(--output-language "$language_code"); fi
  if [ "$allow_api_upload" -eq 1 ]; then transcribe_args+=(--allow-api-upload); fi
  "$SCRIPT_DIR/transcribe.sh" "${transcribe_args[@]}"
fi

current_state=$(caption_job_state show --job-dir "$CAPTION_JOBS/$video_id" --field state)
caption_note "Job: $video_id"
caption_note "State: $current_state"
case "$current_state" in
  ready) caption_note "The video is ready in the local library." ;;
  needs_translation)
    caption_note "Translate and polish the complete $translation_target text, then use segment-subtitles for target-first Source Alignment."
    ;;
  needs_proofreading) caption_note "Proofread the complete source-language text, then use segment-subtitles for target-first Source Alignment." ;;
  needs_segmentation) caption_note "The complete content is ready for target-first segmentation and Source Alignment." ;;
  needs_transcription) caption_note "Transcription is pending; rerun without --no-transcribe when ready." ;;
esac
