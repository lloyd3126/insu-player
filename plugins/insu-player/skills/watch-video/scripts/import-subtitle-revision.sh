#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd -P)
. "$SCRIPT_DIR/lib.sh"

usage() {
  printf 'usage: import-subtitle-revision.sh <workspace> <video-id> <input-vtt> <output-vtt> --source-language BCP47 --output-language BCP47 --artifact-kind proofread|translation|segmentation --revision N --manifest JSON --timing-source-artifact ID [--content-source-artifact ID] [--text-reference-artifact ID ...] [--content-parent-artifact ID] [--warning-count N] [--hard-defect-count N]\n'
}

[ "$#" -ge 1 ] || { usage >&2; exit 1; }
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then usage; exit 0; fi
[ "$#" -ge 4 ] || { usage >&2; exit 1; }

workspace_input="$1"; video_id="$2"; input_track="$3"; output_track="$4"; shift 4
source_language=""; output_language=""; processor_provider="agent"; processor_service="codex"; processor_model=""
artifact_kind=""; artifact_revision=""; artifact_manifest=""; timing_source_artifact=""; content_source_artifact=""
content_parent_artifact=""; warning_count=0; hard_defect_count=0
text_reference_artifacts=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source-language) [ "$#" -ge 2 ] || caption_die "--source-language requires a value"; source_language="$2"; shift 2 ;;
    --output-language) [ "$#" -ge 2 ] || caption_die "--output-language requires a value"; output_language="$2"; shift 2 ;;
    --artifact-kind) [ "$#" -ge 2 ] || caption_die "--artifact-kind requires a value"; artifact_kind="$2"; shift 2 ;;
    --revision) [ "$#" -ge 2 ] || caption_die "--revision requires a value"; artifact_revision="$2"; shift 2 ;;
    --manifest) [ "$#" -ge 2 ] || caption_die "--manifest requires a value"; artifact_manifest="$2"; shift 2 ;;
    --timing-source-artifact) [ "$#" -ge 2 ] || caption_die "--timing-source-artifact requires a value"; timing_source_artifact="$2"; shift 2 ;;
    --content-source-artifact) [ "$#" -ge 2 ] || caption_die "--content-source-artifact requires a value"; content_source_artifact="$2"; shift 2 ;;
    --text-reference-artifact) [ "$#" -ge 2 ] || caption_die "--text-reference-artifact requires a value"; text_reference_artifacts+=("$2"); shift 2 ;;
    --content-parent-artifact) [ "$#" -ge 2 ] || caption_die "--content-parent-artifact requires a value"; content_parent_artifact="$2"; shift 2 ;;
    --warning-count) [ "$#" -ge 2 ] || caption_die "--warning-count requires a value"; warning_count="$2"; shift 2 ;;
    --hard-defect-count) [ "$#" -ge 2 ] || caption_die "--hard-defect-count requires a value"; hard_defect_count="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) caption_die "unknown option: $1" ;;
  esac
done

caption_validate_video_id "$video_id"
caption_validate_language "$source_language"
caption_validate_language "$output_language"
case "$artifact_kind" in proofread|translation|segmentation) ;; *) caption_die "--artifact-kind must be proofread, translation, or segmentation" ;; esac
if [ "$artifact_kind" = "proofread" ]; then
  [ "$source_language" = "$output_language" ] || caption_die "proofreading must preserve the source language"
elif [ "$artifact_kind" = "translation" ]; then
  [ "$source_language" != "$output_language" ] || caption_die "translation must use a different output language"
fi
case "$artifact_revision" in ''|*[!0-9]*) caption_die "--revision must be a positive integer" ;; esac
[ "$artifact_revision" -ge 1 ] || caption_die "--revision must be a positive integer"
[ -n "$artifact_manifest" ] || caption_die "--manifest is required"
[ -n "$timing_source_artifact" ] || caption_die "--timing-source-artifact is required"
case "$warning_count" in ''|*[!0-9]*) caption_die "--warning-count must be a non-negative integer" ;; esac
case "$hard_defect_count" in ''|*[!0-9]*) caption_die "--hard-defect-count must be a non-negative integer" ;; esac
if [ "$artifact_kind" = "segmentation" ]; then
  [ -n "$content_parent_artifact" ] || caption_die "segmentation requires --content-parent-artifact"
  [ -z "$content_source_artifact" ] || caption_die "segmentation inherits content through its parent"
  [ "${#text_reference_artifacts[@]}" -eq 0 ] || caption_die "segmentation inherits references through its content parent"
else
  [ -z "$content_parent_artifact" ] || caption_die "only segmentation accepts --content-parent-artifact"
  content_source_artifact="${content_source_artifact:-$timing_source_artifact}"
fi
if [ "$artifact_kind" = "translation" ] && [ "$content_source_artifact" = "$timing_source_artifact" ]; then
  caption_die "translation requires a validated proofread content source"
fi

caption_set_paths "$workspace_input"
caption_assert_safe_workspace
caption_require_python
caption_validate_vtt "$input_track"
caption_validate_vtt "$output_track"
caption_require_file "$artifact_manifest"
case "$artifact_manifest" in *.json) ;; *) caption_die "--manifest must be a JSON file" ;; esac

manifest_processor_value() {
  "$CAPTION_PYTHON" -c 'import json,sys; payload=json.load(open(sys.argv[1], encoding="utf-8")); value=payload.get(sys.argv[2]); value=value.get(sys.argv[3]) if isinstance(value, dict) else None; print(value if isinstance(value, str) else "")' "$artifact_manifest" "$1" "$2"
}

timing_processor_provider=$(manifest_processor_value timingProcessor provider)
timing_processor_service=$(manifest_processor_value timingProcessor service)
timing_processor_model=$(manifest_processor_value timingProcessor model)
if [ "$artifact_kind" = "segmentation" ]; then
  [ "$("$CAPTION_PYTHON" -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("schemaVersion", ""))' "$artifact_manifest")" = "4" ] || caption_die "segmentation manifest must use schemaVersion 4"
  content_processor_provider=$(manifest_processor_value contentProcessor provider)
  content_processor_service=$(manifest_processor_value contentProcessor service)
  content_processor_model=$(manifest_processor_value contentProcessor model)
  recorded_processor_key=segmentationProcessor
else
  [ "$("$CAPTION_PYTHON" -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("schemaVersion", ""))' "$artifact_manifest")" = "5" ] || caption_die "content manifest must use schemaVersion 5"
  [ "$("$CAPTION_PYTHON" -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("sourceContentArtifactId", ""))' "$artifact_manifest")" = "$content_source_artifact" ] || caption_die "content manifest source artifact does not match the import request"
  source_content_kind=$("$CAPTION_PYTHON" -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("sourceContentKind", ""))' "$artifact_manifest")
  case "$source_content_kind" in model-transcript|proofread) ;; *) caption_die "content manifest has an invalid source kind" ;; esac
  if [ "$artifact_kind" = "translation" ] && [ "$source_content_kind" != "proofread" ]; then
    caption_die "translation requires a validated proofread content source"
  fi
  if [ "$source_content_kind" = "proofread" ]; then
    [ "${#text_reference_artifacts[@]}" -eq 0 ] || caption_die "translation inherits text references from proofreading"
  else
    requested_references=$(IFS=,; printf '%s' "${text_reference_artifacts[*]-}")
    manifest_references=$("$CAPTION_PYTHON" -c 'import json,sys; value=json.load(open(sys.argv[1], encoding="utf-8")).get("referenceArtifactIds"); print(",".join(value) if isinstance(value, list) and all(isinstance(item, str) for item in value) else "__invalid__")' "$artifact_manifest")
    [ "$manifest_references" = "$requested_references" ] || caption_die "content manifest text references do not match the import request"
  fi
  content_processor_provider="$processor_provider"
  content_processor_service="$processor_service"
  content_processor_model="$processor_model"
  recorded_processor_key=contentProcessor
fi
[ "$(manifest_processor_value "$recorded_processor_key" provider)" = "$processor_provider" ] || caption_die "manifest processor provider does not match the import request"
[ "$(manifest_processor_value "$recorded_processor_key" service)" = "$processor_service" ] || caption_die "manifest processor service does not match the import request"
[ "$(manifest_processor_value "$recorded_processor_key" model)" = "$processor_model" ] || caption_die "manifest processor model does not match the import request"

reflow_script="$SCRIPT_DIR/../../translate-subtitles/scripts/reflow_subtitles.py"
caption_require_file "$reflow_script"
if [ "$artifact_kind" = "segmentation" ]; then
  segmentation_script="$SCRIPT_DIR/../../segment-subtitles/scripts/segment_subtitles.py"
  caption_require_file "$segmentation_script"
  "$CAPTION_PYTHON" "$segmentation_script" validate --plan "$artifact_manifest" >/dev/null
else
  "$CAPTION_PYTHON" "$reflow_script" validate-manifest --manifest "$artifact_manifest" >/dev/null
fi
"$CAPTION_PYTHON" "$reflow_script" validate-pair --input "$input_track" --output "$output_track" >/dev/null

job_dir="$CAPTION_JOBS/$video_id"
[ -d "$job_dir" ] || caption_die "job not found: $job_dir"
artifact_id="artifact-$video_id-$artifact_kind-$source_language-$output_language-r$artifact_revision"
artifact_dir="$job_dir/subtitle-work/artifacts/$artifact_id"
artifact_input="$artifact_dir/input.vtt"
artifact_output="$artifact_dir/output.vtt"
artifact_manifest_archive="$artifact_dir/manifest.json"

if [ -d "$artifact_dir" ]; then
  [ -f "$artifact_input" ] && cmp -s "$input_track" "$artifact_input" || caption_die "artifact revision has different input content: $artifact_id"
  [ -f "$artifact_output" ] && cmp -s "$output_track" "$artifact_output" || caption_die "artifact revision has different output content: $artifact_id"
  [ -f "$artifact_manifest_archive" ] && cmp -s "$artifact_manifest" "$artifact_manifest_archive" || caption_die "artifact revision has a different manifest: $artifact_id"
else
  mkdir -p "$artifact_dir"
  cp "$input_track" "$artifact_input"
  cp "$output_track" "$artifact_output"
  cp "$artifact_manifest" "$artifact_manifest_archive"
fi

artifact_args=(
  --job-dir "$job_dir"
  --id "$artifact_id"
  --kind "$artifact_kind"
  --revision "$artifact_revision"
  --lifecycle-state ready
  --validation-state valid
  --freshness-state current
  --source-language "$source_language"
  --output-language "$output_language"
  --processor-provider "$processor_provider"
  --manifest "$artifact_manifest_archive"
  --dependency timing-source "$timing_source_artifact"
  --warning-count "$warning_count"
  --hard-defect-count "$hard_defect_count"
)
if [ -n "$processor_service" ]; then artifact_args+=(--processor-service "$processor_service"); fi
if [ -n "$processor_model" ]; then artifact_args+=(--processor-model "$processor_model"); fi
if [ "$artifact_kind" = "segmentation" ]; then
  artifact_args+=(--target-frozen --dependency content-parent "$content_parent_artifact")
  artifact_args+=(--track "$source_language" input_segmented "$artifact_input")
  artifact_args+=(--track "$output_language" output_segmented "$artifact_output")
else
  artifact_args+=(--dependency content-source "$content_source_artifact")
  if [ "${#text_reference_artifacts[@]}" -gt 0 ]; then
    for reference_artifact in "${text_reference_artifacts[@]}"; do
      artifact_args+=(--dependency text-reference "$reference_artifact")
    done
  fi
  artifact_args+=(--track "$source_language" input_sentence "$artifact_input")
  artifact_args+=(--track "$output_language" output_sentence "$artifact_output")
fi
caption_job_state subtitle-artifact "${artifact_args[@]}" >/dev/null

existing_pipeline_mode=$(caption_job_state show --job-dir "$job_dir" | "$CAPTION_PYTHON" -c 'import json,sys; value=json.load(sys.stdin).get("subtitlePipeline") or {}; print(value.get("mode", ""))')
existing_pipeline_output=$(caption_job_state show --job-dir "$job_dir" | "$CAPTION_PYTHON" -c 'import json,sys; value=json.load(sys.stdin).get("subtitlePipeline") or {}; print(value.get("outputLanguage", ""))')
pipeline_mode="$artifact_kind"
pipeline_output_language="$output_language"
if [ "$artifact_kind" = "translation" ]; then pipeline_mode="translate"; fi
if [ "$artifact_kind" = "proofread" ] && [ "$existing_pipeline_mode" = "translate" ]; then
  pipeline_mode="translate"
  pipeline_output_language="$existing_pipeline_output"
fi
if [ "$artifact_kind" = "segmentation" ]; then
  pipeline_mode=$("$CAPTION_PYTHON" -c 'import json,sys; value=json.load(open(sys.argv[1], encoding="utf-8")).get("contentMode"); print(value if value in {"proofread", "translate"} else "")' "$artifact_manifest_archive")
  [ -n "$pipeline_mode" ] || caption_die "segmentation manifest must record contentMode"
fi
pipeline_stage="content_complete"
if [ "$artifact_kind" = "segmentation" ]; then pipeline_stage="complete"; fi
pipeline_args=(
  --job-dir "$job_dir"
  --mode "$pipeline_mode"
  --stage "$pipeline_stage"
  --source-language "$source_language"
  --output-language "$pipeline_output_language"
)
if [ -n "$timing_processor_provider" ]; then pipeline_args+=(--timing-processor-provider "$timing_processor_provider"); fi
if [ -n "$timing_processor_service" ]; then pipeline_args+=(--timing-processor-service "$timing_processor_service"); fi
if [ -n "$timing_processor_model" ]; then pipeline_args+=(--timing-processor-model "$timing_processor_model"); fi
if [ -n "$content_processor_provider" ]; then pipeline_args+=(--content-processor-provider "$content_processor_provider"); fi
if [ -n "$content_processor_service" ]; then pipeline_args+=(--content-processor-service "$content_processor_service"); fi
if [ -n "$content_processor_model" ]; then pipeline_args+=(--content-processor-model "$content_processor_model"); fi
if [ "$artifact_kind" = "segmentation" ]; then
  pipeline_args+=(--segmentation-processor-provider "$processor_provider")
  if [ -n "$processor_service" ]; then pipeline_args+=(--segmentation-processor-service "$processor_service"); fi
  if [ -n "$processor_model" ]; then pipeline_args+=(--segmentation-processor-model "$processor_model"); fi
fi
if [ "${#text_reference_artifacts[@]}" -gt 0 ]; then
  for reference_artifact in "${text_reference_artifacts[@]}"; do
    pipeline_args+=(--manual-reference-artifact "$reference_artifact")
  done
fi
caption_job_state subtitle-pipeline "${pipeline_args[@]}" >/dev/null

if [ "$artifact_kind" = "segmentation" ]; then
  caption_job_state update --job-dir "$job_dir" --state ready --stage complete --message "影音與切分字幕已可觀看" --progress 100 --clear-error --record-history >/dev/null
elif [ "$artifact_kind" = "proofread" ] && [ "$pipeline_mode" = "translate" ]; then
  caption_job_state update --job-dir "$job_dir" --state needs_translation --stage content_revision --message "原語校正已完成，等待 Agent 翻譯成 $pipeline_output_language" --progress 0 --clear-error --record-history >/dev/null
else
  caption_job_state update --job-dir "$job_dir" --state needs_segmentation --stage target_segmentation --message "完整句字幕已完成，等待 target-first 切分與來源時間對齊" --progress 0 --clear-error --record-history >/dev/null
fi

caption_note "Subtitle artifact imported: $artifact_id"
