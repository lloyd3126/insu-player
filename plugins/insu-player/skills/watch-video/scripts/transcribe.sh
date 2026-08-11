#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: transcribe.sh <workspace> <video-id> --mode proofread|translate --language SOURCE_BCP47 --output-language BCP47 [--device cpu|cuda] [--consent-to-audio-upload]\n'
}

[ "$#" -ge 1 ] || { usage >&2; exit 1; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 0; fi
[ "$#" -ge 2 ] || { usage >&2; exit 1; }

workspace_input="$1"
video_id="$2"
shift 2
language_code=""
output_language=""
content_mode=""
device_name="cpu"
consent_to_audio_upload=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode) [ "$#" -ge 2 ] || caption_die "--mode requires a value"; content_mode="$2"; shift 2 ;;
    --language) [ "$#" -ge 2 ] || caption_die "--language requires a value"; language_code="$2"; shift 2 ;;
    --output-language) [ "$#" -ge 2 ] || caption_die "--output-language requires a value"; output_language="$2"; shift 2 ;;
    --device) [ "$#" -ge 2 ] || caption_die "--device requires a value"; device_name="$2"; shift 2 ;;
    --consent-to-audio-upload) consent_to_audio_upload=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

caption_validate_video_id "$video_id"
[ "$device_name" = "cpu" ] || [ "$device_name" = "cuda" ] || caption_die "device must be cpu or cuda"
case "$content_mode" in proofread|translate) ;; *) caption_die "--mode must be proofread or translate" ;; esac
[ -n "$language_code" ] || caption_die "--language SOURCE_BCP47 is required"
[ -n "$output_language" ] || caption_die "--output-language BCP47 is required"
caption_validate_language "$language_code"
caption_validate_language "$output_language"
if [ "$content_mode" = "proofread" ]; then
  [ "$language_code" = "$output_language" ] || caption_die "proofreading must preserve the source language"
else
  [ "$language_code" != "$output_language" ] || caption_die "translation output must differ from the source language"
  [ "$output_language" != "und" ] || caption_die "translation output language cannot be und"
fi

caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_runtime
settings_resolver="$SCRIPT_DIR/resolve-transcription-settings.py"
caption_require_file "$settings_resolver"
IFS=$'\t' read -r provider_name provider_service model_name < <(
  "$CAPTION_PYTHON" "$settings_resolver" --workspace "$CAPTION_WORKSPACE" --format tsv
)
[ -n "$provider_name" ] || caption_die "transcription settings did not provide a provider"
[ -n "$provider_service" ] || caption_die "transcription settings did not provide a service"
caption_require_provider "$provider_name"
[ -f "$CAPTION_OPENAI_TRANSCRIBER" ] || caption_die "transcribe-media skill script is missing: $CAPTION_OPENAI_TRANSCRIBER"
if [ "$provider_name" != "local" ] && [ "$consent_to_audio_upload" -ne 1 ]; then
  caption_die "$provider_name transcription uploads audio externally; rerun with --consent-to-audio-upload only after the user authorizes audio transcription"
fi

job_dir="$CAPTION_JOBS/$video_id"
source_dir="$job_dir/source"
whisper_dir="$job_dir/whisper"
audio_file="$source_dir/audio.m4a"
[ -d "$job_dir" ] || caption_die "job not found: $job_dir"
media_catalog_script="$SCRIPT_DIR/media_catalog.py"
[ -f "$media_catalog_script" ] || caption_die "media catalog helper is missing: $media_catalog_script"
video_file=$("$CAPTION_PYTHON" "$media_catalog_script" active-path \
  --job-dir "$job_dir" --video-id "$video_id" 2>/dev/null || true)
caption_require_file "$video_file"
mkdir -p "$whisper_dir" "$CAPTION_MODELS" "$job_dir/logs"

fail_job() {
  local exit_code=$?
  trap - ERR
  caption_job_state update --job-dir "$job_dir" --state failed --stage model_transcription --message "轉錄失敗" --error "transcribe.sh exited with status $exit_code" --record-history >/dev/null || true
  exit "$exit_code"
}
trap fail_job ERR

caption_job_state transcription-clear --job-dir "$job_dir" >/dev/null

if [ ! -f "$audio_file" ]; then
  caption_note "Extracting an audio copy from the active media rendition..."
  "$CAPTION_PYTHON" "$CAPTION_PROGRESS_RUNNER" \
    --job-dir "$job_dir" --state transcribing --stage audio_preparation --message "正在從影片擷取音訊" --success-message "音訊擷取完成" -- \
    "$CAPTION_FFMPEG" -nostdin -hide_banner -y -i "$video_file" -vn -c:a aac -b:a 192k "$audio_file"
  caption_job_state asset --job-dir "$job_dir" --name audio --path "$audio_file" >/dev/null
fi

provider_output="$whisper_dir/$provider_name"
transcribe_args=(
  "$CAPTION_OPENAI_TRANSCRIBER" "$audio_file"
  --output-dir "$provider_output"
  --provider "$provider_name"
  --device "$device_name"
  --ffmpeg "$CAPTION_FFMPEG"
  --whisper-cli "$CAPTION_WHISPER"
  --model-dir "$CAPTION_MODELS"
)
if [ -n "$model_name" ]; then transcribe_args+=(--model "$model_name"); fi
if [ -n "$language_code" ]; then transcribe_args+=(--language "$language_code"); fi
if [ "$provider_name" != "local" ]; then transcribe_args+=(--consent-to-audio-upload); fi

pipeline_timing_args=(--timing-processor-provider "$provider_name" --timing-processor-service "$provider_service")
if [ -n "$model_name" ]; then pipeline_timing_args+=(--timing-processor-model "$model_name"); fi
caption_job_state subtitle-pipeline --job-dir "$job_dir" --mode "$content_mode" --stage model_transcription --source-language "$language_code" --output-language "$output_language" "${pipeline_timing_args[@]}" >/dev/null
case "$provider_name" in
  local) provider_label="本機 Whisper" ;;
  openai) provider_label="OpenAI API" ;;
  groq) provider_label="Groq API" ;;
  elevenlabs) provider_label="ElevenLabs API" ;;
  xai) provider_label="xAI API" ;;
  openrouter) provider_label="OpenRouter API" ;;
esac
caption_note "Transcribing with provider=$provider_name service=$provider_service model=${model_name:-none} device=$device_name..."
transcribe_command=("$CAPTION_PYTHON" "${transcribe_args[@]}")
if [ "$provider_name" != "local" ]; then
  provider_key=$(caption_provider_api_key "$provider_name")
fi
if [ "$provider_name" != "local" ] && [ -z "${!provider_key:-}" ]; then
  transcribe_command=(
    "$CAPTION_PYTHON" "$CAPTION_PROVIDER_CREDENTIAL_SESSION"
    --workspace "$CAPTION_WORKSPACE" --provider "$provider_name" run --
    "${transcribe_command[@]}"
  )
fi
"$CAPTION_PYTHON" "$CAPTION_PROGRESS_RUNNER" \
  --job-dir "$job_dir" --state transcribing --stage model_transcription --message "$provider_label 正在轉錄" --success-message "$provider_label 轉錄完成" -- \
  "${transcribe_command[@]}"

vtt_file="$provider_output/transcript.vtt"
caption_validate_vtt "$vtt_file"

transcript_json="$provider_output/transcript.json"
subtitle_work_dir="$job_dir/subtitle-work"
subtitle_manifest="$subtitle_work_dir/content-manifest.json"
source_sentence_vtt="$subtitle_work_dir/input.sentence.vtt"
reflow_script="$SCRIPT_DIR/../../translate-subtitles/scripts/reflow_subtitles.py"
caption_require_file "$transcript_json"
caption_require_file "$reflow_script"
mkdir -p "$subtitle_work_dir"

IFS=$'\t' read -r language_code engine_language < <(
  "$CAPTION_PYTHON" -c 'import json,sys; payload=json.load(open(sys.argv[1], encoding="utf-8")); assert payload.get("schemaVersion") == 3; print("{}\t{}".format(payload["language"], payload["engineLanguage"]))' "$transcript_json"
)
[ -n "$language_code" ] || caption_die "transcript did not resolve a source language"
[ -n "$engine_language" ] || caption_die "transcript did not record the model language parameter"
if [ "$content_mode" = "proofread" ]; then output_language="$language_code"; fi
transcription_args=(--job-dir "$job_dir" --provider "$provider_name" --service "$provider_service" --language-tag "$language_code" --engine-language "$engine_language")
if [ -n "$model_name" ]; then transcription_args+=(--model "$model_name"); fi
caption_job_state transcription "${transcription_args[@]}" >/dev/null

import_args=("$CAPTION_WORKSPACE" "$video_id" "$language_code" "$vtt_file" --source-type model-transcript --processor-provider "$provider_name" --processor-service "$provider_service" --timing-unit-kind word)
if [ -n "$model_name" ]; then import_args+=(--processor-model "$model_name"); fi
"$SCRIPT_DIR/import-caption.sh" "${import_args[@]}"
timing_source_artifact="$video_id-source-model-transcript-$language_code-r1"
manual_reference_artifacts=()
manual_reference_count=0
while IFS= read -r reference_artifact; do
  if [ -n "$reference_artifact" ]; then
    manual_reference_artifacts+=("$reference_artifact")
    manual_reference_count=$((manual_reference_count + 1))
  fi
done < <(
  caption_job_state show --job-dir "$job_dir" |
    "$CAPTION_PYTHON" -c 'import json,sys; data=json.load(sys.stdin); print("\n".join(str(item["id"]) for item in data["subtitleArtifacts"] if item.get("kind") == "source" and item.get("sourceType") == "manual-cc" and item.get("sourceLanguage") == sys.argv[1]))' "$language_code"
)

prepare_args=(
  "$reflow_script" prepare
  --source-transcript "$transcript_json"
  --manifest "$subtitle_manifest"
  --mode "$content_mode"
  --source-language "$language_code"
  --output-language "$output_language"
  --timing-source-artifact "$timing_source_artifact"
  --source-output "$source_sentence_vtt"
)
if [ "$manual_reference_count" -gt 0 ]; then
  for reference_artifact in "${manual_reference_artifacts[@]}"; do
    prepare_args+=(--reference-artifact "$reference_artifact")
  done
fi
case "$output_language" in zh|zh-*) prepare_args+=(--punctuation-policy remove-commas-periods) ;; esac
"$CAPTION_PYTHON" "${prepare_args[@]}"
caption_validate_vtt "$source_sentence_vtt"
caption_job_state asset --job-dir "$job_dir" --name wordTranscript --path "$transcript_json" >/dev/null
caption_job_state asset --job-dir "$job_dir" --name contentPlan --path "$subtitle_manifest" >/dev/null
pipeline_args=(--job-dir "$job_dir" --mode "$content_mode" --stage content_revision --source-language "$language_code" --output-language "$output_language" "${pipeline_timing_args[@]}")
if [ "$manual_reference_count" -gt 0 ]; then
  for reference_artifact in "${manual_reference_artifacts[@]}"; do
    pipeline_args+=(--manual-reference-artifact "$reference_artifact")
  done
fi
caption_job_state subtitle-pipeline "${pipeline_args[@]}" >/dev/null
if [ "$content_mode" = "proofread" ]; then
  caption_job_state update --job-dir "$job_dir" --state needs_proofreading --stage content_revision --message "模型時間軸已完成，等待 Agent 重建完整句並校正" --progress 0 --clear-error --record-history >/dev/null
else
  caption_job_state update --job-dir "$job_dir" --state needs_translation --stage content_revision --message "模型時間軸已完成，等待 Agent 重建完整句並翻譯成 $output_language" --progress 0 --clear-error --record-history >/dev/null
fi

trap - ERR
caption_note "Transcription complete: $provider_output/transcript.json"
