#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: transcribe.sh <workspace> <video-id> [--provider local|openai] [--model NAME] [--language SOURCE_BCP47] [--target-language TARGET_BCP47] [--track CODE] [--device cpu|cuda] [--allow-api-upload] [--no-translate]\n'
}

[ "$#" -ge 1 ] || { usage >&2; exit 1; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 0; fi
[ "$#" -ge 2 ] || { usage >&2; exit 1; }

workspace_input="$1"
video_id="$2"
shift 2
provider_name=""
model_name=""
language_code=""
track_code=""
target_language=""
device_name="cpu"
allow_api_upload=0
no_translate=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --provider) [ "$#" -ge 2 ] || caption_die "--provider requires a value"; provider_name="$2"; shift 2 ;;
    --model) [ "$#" -ge 2 ] || caption_die "--model requires a value"; model_name="$2"; shift 2 ;;
    --language) [ "$#" -ge 2 ] || caption_die "--language requires a value"; language_code="$2"; shift 2 ;;
    --target-language) [ "$#" -ge 2 ] || caption_die "--target-language requires a value"; target_language="$2"; shift 2 ;;
    --track) [ "$#" -ge 2 ] || caption_die "--track requires a value"; track_code="$2"; shift 2 ;;
    --device) [ "$#" -ge 2 ] || caption_die "--device requires a value"; device_name="$2"; shift 2 ;;
    --allow-api-upload) allow_api_upload=1; shift ;;
    --no-translate) no_translate=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

caption_validate_video_id "$video_id"
[ "$device_name" = "cpu" ] || [ "$device_name" = "cuda" ] || caption_die "device must be cpu or cuda"
if [ -n "$language_code" ]; then caption_validate_language "$language_code"; fi
if [ "$no_translate" -eq 1 ]; then
  if [ -z "$track_code" ]; then track_code="${language_code:-und}"; fi
  caption_validate_language "$track_code"
else
  [ -n "$target_language" ] || caption_die "translation requires --target-language after asking the user"
  caption_validate_language "$target_language"
fi

caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_runtime
if [ -z "$provider_name" ]; then
  configured_provider=$(caption_configured_provider)
  if [ "$configured_provider" = "both" ]; then provider_name="local"; else provider_name="$configured_provider"; fi
fi
case "$provider_name" in local|openai) ;; *) caption_die "provider must be local or openai" ;; esac
if [ -z "$model_name" ]; then
  if [ "$provider_name" = "openai" ]; then
    model_name="whisper-1"
  else
    model_name=$(caption_state_value "$CAPTION_STATE" DEFAULT_MODEL)
    model_name="${model_name:-medium}"
  fi
fi
case "$model_name" in ''|*[!A-Za-z0-9._-]*) caption_die "invalid model name: $model_name" ;; esac
caption_require_provider "$provider_name"
[ -f "$CAPTION_OPENAI_TRANSCRIBER" ] || caption_die "transcribe-media skill script is missing: $CAPTION_OPENAI_TRANSCRIBER"
if [ "$provider_name" = "openai" ] && [ "$allow_api_upload" -ne 1 ]; then
  caption_die "OpenAI transcription uploads audio externally; rerun with --allow-api-upload only after the user authorizes it"
fi

job_dir="$CAPTION_JOBS/$video_id"
source_dir="$job_dir/source"
whisper_dir="$job_dir/whisper"
caption_dir="$job_dir/captions"
audio_file="$source_dir/audio.m4a"
video_file="$source_dir/video.mp4"
[ -d "$job_dir" ] || caption_die "job not found: $job_dir"
caption_require_file "$video_file"
mkdir -p "$whisper_dir" "$caption_dir" "$CAPTION_MODELS" "$job_dir/logs"

fail_job() {
  local exit_code=$?
  trap - ERR
  caption_job_state update --job-dir "$job_dir" --state failed --stage transcription --message "轉錄失敗" --error "transcribe.sh exited with status $exit_code" --record-history >/dev/null || true
  exit "$exit_code"
}
trap fail_job ERR

if [ ! -f "$audio_file" ]; then
  caption_note "Extracting an audio copy from video.mp4..."
  "$CAPTION_PYTHON" "$CAPTION_PROGRESS_RUNNER" \
    --job-dir "$job_dir" --state transcribing --stage extracting_audio --message "正在從影片擷取音訊" --success-message "音訊擷取完成" -- \
    "$CAPTION_FFMPEG" -nostdin -hide_banner -y -i "$video_file" -vn -c:a aac -b:a 192k "$audio_file"
  caption_job_state asset --job-dir "$job_dir" --name audio --path "$audio_file" >/dev/null
fi

provider_output="$whisper_dir/$provider_name"
transcribe_args=(
  "$CAPTION_OPENAI_TRANSCRIBER" "$audio_file"
  --output-dir "$provider_output"
  --provider "$provider_name"
  --model "$model_name"
  --device "$device_name"
  --ffmpeg "$CAPTION_FFMPEG"
  --whisper-cli "$CAPTION_WHISPER"
  --model-dir "$CAPTION_MODELS"
)
if [ -n "$language_code" ]; then transcribe_args+=(--language "$language_code"); fi
if [ "$provider_name" = "openai" ]; then transcribe_args+=(--consent-to-upload); fi

caption_job_state transcription --job-dir "$job_dir" --provider "$provider_name" --model "$model_name" >/dev/null
if [ "$no_translate" -eq 1 ]; then
  caption_job_state subtitle-workflow --job-dir "$job_dir" --translation not-requested --source model --stage model_transcription --provider "$provider_name" --model "$model_name" >/dev/null
else
  workflow_args=(--job-dir "$job_dir" --translation requested --source model --stage model_transcription --provider "$provider_name" --model "$model_name" --target-language "$target_language")
  if [ -n "$language_code" ]; then workflow_args+=(--source-language "$language_code"); fi
  caption_job_state subtitle-workflow "${workflow_args[@]}" >/dev/null
fi
caption_note "Transcribing with provider=$provider_name model=$model_name device=$device_name..."
transcribe_command=("$CAPTION_PYTHON" "${transcribe_args[@]}")
if [ "$provider_name" = "openai" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
  transcribe_command=(
    "$CAPTION_PYTHON" "$CAPTION_ENVIRONMENT_SESSION"
    --workspace "$CAPTION_WORKSPACE" --name OPENAI_API_KEY run --
    "${transcribe_command[@]}"
  )
fi
"$CAPTION_PYTHON" "$CAPTION_PROGRESS_RUNNER" \
  --job-dir "$job_dir" --state transcribing --stage "$provider_name" --message "$provider_name 正在轉錄" --success-message "$provider_name 轉錄完成" -- \
  "${transcribe_command[@]}"

vtt_file="$provider_output/transcript.vtt"
caption_validate_vtt "$vtt_file"

if [ "$no_translate" -eq 1 ]; then
  cp "$vtt_file" "$caption_dir/$track_code.vtt"
  caption_validate_vtt "$caption_dir/$track_code.vtt"
  caption_job_state subtitle --job-dir "$job_dir" --language "$track_code" --path "$caption_dir/$track_code.vtt" --source "$provider_name" --label "$track_code" >/dev/null
  caption_job_state subtitle-workflow --job-dir "$job_dir" --translation not-requested --source model --stage complete --provider "$provider_name" --model "$model_name" >/dev/null
  caption_job_state update --job-dir "$job_dir" --state ready --stage complete --message "影片與轉錄字幕已可觀看。不需要翻譯" --progress 100 --clear-error --record-history >/dev/null
else
  transcript_json="$provider_output/transcript.json"
  subtitle_work_dir="$job_dir/subtitle-work"
  subtitle_manifest="$subtitle_work_dir/bilingual-sentences.json"
  source_sentence_vtt="$subtitle_work_dir/source.sentence.vtt"
  reflow_script="$SCRIPT_DIR/../../translate-subtitles/scripts/reflow_subtitles.py"
  caption_require_file "$transcript_json"
  caption_require_file "$reflow_script"
  mkdir -p "$subtitle_work_dir"
  prepare_args=(
    "$reflow_script" prepare
    --source-transcript "$transcript_json" \
    --target-language "$target_language" \
    --manifest "$subtitle_manifest" \
    --source-output "$source_sentence_vtt"
  )
  if [ -n "$language_code" ]; then prepare_args+=(--source-language "$language_code"); fi
  case "$target_language" in zh|zh-*) prepare_args+=(--punctuation-policy remove-commas-periods) ;; esac
  "$CAPTION_PYTHON" "${prepare_args[@]}"
  source_language=$("$CAPTION_PYTHON" -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["sourceLanguage"])' "$subtitle_manifest")
  caption_validate_language "$source_language"
  source_named_vtt="$subtitle_work_dir/$source_language.sentence.vtt"
  mv "$source_sentence_vtt" "$source_named_vtt"
  caption_validate_vtt "$source_named_vtt"
  cp "$source_named_vtt" "$caption_dir/$source_language.vtt"
  caption_validate_vtt "$caption_dir/$source_language.vtt"
  caption_job_state subtitle --job-dir "$job_dir" --language "$source_language" --path "$caption_dir/$source_language.vtt" --source "${provider_name}-model-sentence-reflow" --label "$source_language" >/dev/null
  caption_job_state asset --job-dir "$job_dir" --name wordTranscript --path "$transcript_json" >/dev/null
  caption_job_state asset --job-dir "$job_dir" --name translationPlan --path "$subtitle_manifest" >/dev/null
  caption_job_state subtitle-workflow --job-dir "$job_dir" --translation requested --source model --stage draft_translation --provider "$provider_name" --model "$model_name" --source-language "$source_language" --target-language "$target_language" >/dev/null
  caption_job_state update --job-dir "$job_dir" --state needs_translation --stage draft_translation --message "模型時間單位與完整句時間軸已完成。等待 $target_language 完整句翻譯" --progress 0 --clear-error --record-history >/dev/null
fi

trap - ERR
caption_note "Transcription complete: $provider_output/transcript.json"
