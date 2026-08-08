#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: transcribe.sh <workspace> <video-id> [--provider local|openai] [--model NAME] [--language CODE] [--track CODE] [--device cpu|cuda] [--allow-api-upload]\n'
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
device_name="cpu"
allow_api_upload=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --provider) [ "$#" -ge 2 ] || caption_die "--provider requires a value"; provider_name="$2"; shift 2 ;;
    --model) [ "$#" -ge 2 ] || caption_die "--model requires a value"; model_name="$2"; shift 2 ;;
    --language) [ "$#" -ge 2 ] || caption_die "--language requires a value"; language_code="$2"; shift 2 ;;
    --track) [ "$#" -ge 2 ] || caption_die "--track requires a value"; track_code="$2"; shift 2 ;;
    --device) [ "$#" -ge 2 ] || caption_die "--device requires a value"; device_name="$2"; shift 2 ;;
    --allow-api-upload) allow_api_upload=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

caption_validate_video_id "$video_id"
[ "$device_name" = "cpu" ] || [ "$device_name" = "cuda" ] || caption_die "device must be cpu or cuda"
if [ -n "$language_code" ]; then caption_validate_language "$language_code"; fi
if [ -z "$track_code" ]; then track_code="${language_code:-source}"; fi
caption_validate_language "$track_code"

caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_runtime
if [ -z "$provider_name" ]; then
  configured_provider=$(caption_configured_provider)
  if [ "$configured_provider" = "both" ]; then provider_name="local"; else provider_name="$configured_provider"; fi
fi
case "$provider_name" in local|openai) ;; *) caption_die "provider must be local or openai" ;; esac
if [ -z "$model_name" ]; then
  if [ "$provider_name" = "openai" ]; then model_name="whisper-1"; else model_name="turbo"; fi
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
caption_note "Transcribing with provider=$provider_name model=$model_name device=$device_name..."
"$CAPTION_PYTHON" "$CAPTION_PROGRESS_RUNNER" \
  --job-dir "$job_dir" --state transcribing --stage "$provider_name" --message "$provider_name 正在轉錄" --success-message "$provider_name 轉錄完成" -- \
  "$CAPTION_PYTHON" "${transcribe_args[@]}"

vtt_file="$provider_output/transcript.vtt"
caption_validate_vtt "$vtt_file"
cp "$vtt_file" "$caption_dir/$track_code.vtt"
caption_validate_vtt "$caption_dir/$track_code.vtt"
caption_job_state subtitle --job-dir "$job_dir" --language "$track_code" --path "$caption_dir/$track_code.vtt" --source "$provider_name" --label "$track_code" >/dev/null

if [ -f "$caption_dir/zh-TW.vtt" ]; then
  caption_job_state update --job-dir "$job_dir" --state ready --stage complete --message "影片與繁體中文字幕已可觀看" --progress 100 --clear-error --record-history >/dev/null
else
  caption_job_state update --job-dir "$job_dir" --state needs_translation --stage translation --message "轉錄已完成；等待繁中翻譯" --progress 0 --clear-error --record-history >/dev/null
fi

trap - ERR
caption_note "Transcription complete: $caption_dir/$track_code.vtt"
