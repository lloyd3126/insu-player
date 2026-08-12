#!/usr/bin/env python3
"""Build complete-sentence subtitle revisions from model-timed source units."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 5
SEGMENT_ID_PATTERN = re.compile(r"^S[0-9]{4,}$")
LANGUAGE_PATTERN = re.compile(r"^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|und)$")
SENTENCE_END_PATTERN = re.compile(r"[.!?。！？؟։।॥](?:[\"'”’\)\]\}]+)?$")
SOUND_LABEL_PATTERN = re.compile(r"^(?:\[[^\]]+\]|\([^\)]+\))$")
FORBIDDEN_MARKER_PATTERN = re.compile(
    r"(?i)(?:_{2,}[A-Z0-9]*CUE[A-Z0-9_]*_{0,}|XQZCUE[A-Z0-9]*)"
)
REMOVED_PUNCTUATION_PATTERN = re.compile(r"[,\.，。]")
VTT_TIMING_PATTERN = re.compile(
    r"^(?P<start>(?:[0-9]{2}:)?[0-9]{2}:[0-9]{2}\.[0-9]{3})"
    r"\s+-->\s+"
    r"(?P<end>(?:[0-9]{2}:)?[0-9]{2}:[0-9]{2}\.[0-9]{3})"
    r"(?:\s+.*)?$"
)
ABBREVIATIONS = {
    "dr.",
    "e.g.",
    "etc.",
    "i.e.",
    "jr.",
    "mr.",
    "mrs.",
    "ms.",
    "prof.",
    "sr.",
    "st.",
    "vs.",
}


@dataclass(frozen=True)
class TimedUnit:
    identifier: str
    text: str
    start_ms: int
    fallback_end_ms: int
    kind: str


@dataclass(frozen=True)
class Cue:
    identifier: str
    start_ms: int
    end_ms: int
    text: str


@dataclass(frozen=True)
class ManifestView:
    mode: str
    source_language: str
    output_language: str
    punctuation_policy: str
    segments: list[dict[str, object]]
    source_key: str
    output_key: str


def validate_language(value: object, label: str) -> str:
    if not isinstance(value, str) or not LANGUAGE_PATTERN.fullmatch(value):
        raise ValueError(f"{label} must be a BCP 47 language code")
    return value


def parse_timestamp(value: str) -> int:
    parts = value.split(":")
    if len(parts) == 2:
        hours = 0
        minutes, seconds_and_milliseconds = parts
    elif len(parts) == 3:
        hours, minutes, seconds_and_milliseconds = parts
    else:
        raise ValueError(f"invalid VTT timestamp: {value}")
    seconds, milliseconds = seconds_and_milliseconds.split(".", 1)
    return (
        int(hours) * 3_600_000
        + int(minutes) * 60_000
        + int(seconds) * 1_000
        + int(milliseconds)
    )


def format_timestamp(milliseconds: int) -> str:
    if milliseconds < 0:
        raise ValueError("timestamp must not be negative")
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, fraction = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{fraction:03d}"


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError(f"output path must not be a symlink: {path}")
    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_name = handle.name
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def normalize_display_text(value: str, punctuation_policy: str) -> str:
    if punctuation_policy == "remove-commas-periods":
        value = REMOVED_PUNCTUATION_PATTERN.sub(" ", value)
    elif punctuation_policy != "preserve":
        raise ValueError(f"unsupported punctuation policy: {punctuation_policy}")
    return " ".join(value.split())


def validate_content(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must contain text")
    if FORBIDDEN_MARKER_PATTERN.search(value):
        raise ValueError(f"{label} contains an internal cue marker")
    return value.strip()


TIMING_PROCESSOR_CONTRACTS: dict[str, tuple[str, set[str] | None]] = {
    "local": ("openai-whisper", None),
    "openai": ("audio/transcriptions", {"whisper-1"}),
    "groq": ("audio/transcriptions", {"whisper-large-v3", "whisper-large-v3-turbo"}),
    "elevenlabs": ("speech-to-text", {"scribe_v2"}),
    "xai": ("v1/stt", set()),
    "openrouter": ("audio/transcriptions", {"openai/whisper-large-v3"}),
}


def processor_identity(
    value: object,
    label: str,
    *,
    timing_only: bool = False,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be recorded before rendering")
    unknown = set(value) - {"provider", "service", "model", "updatedAt"}
    if unknown:
        raise ValueError(f"{label} contains unsupported fields: {sorted(unknown)}")
    provider = value.get("provider")
    allowed = set(TIMING_PROCESSOR_CONTRACTS) if timing_only else {"agent"}
    if provider not in allowed:
        raise ValueError(f"{label}.provider is unsupported")
    service = value.get("service")
    model = value.get("model")
    if provider in TIMING_PROCESSOR_CONTRACTS:
        expected_service, allowed_models = TIMING_PROCESSOR_CONTRACTS[provider]
        if service != expected_service:
            raise ValueError(f"{label} must use {provider} / {expected_service}")
        if allowed_models is not None and model not in allowed_models:
            raise ValueError(f"{label}.model is unsupported")
        if allowed_models is None:
            validate_content(model, f"{label}.model")
            pattern = (
                r"^[A-Za-z0-9._-]+/[A-Za-z0-9._/-]+$"
                if provider == "openrouter"
                else r"^[A-Za-z0-9._-]+$"
            )
            if not re.fullmatch(pattern, str(model)):
                raise ValueError(f"{label}.model is invalid")
    if provider == "agent":
        if service != "codex" or model is not None:
            raise ValueError(f"{label} must use agent / codex")
    for field_value, field_name in ((service, "service"), (model, "model")):
        if field_value is not None and not isinstance(field_value, str):
            raise ValueError(f"{label}.{field_name} must be text")
    identity = {"provider": provider, "service": service, "model": model}
    if provider == "agent":
        identity.pop("model")
    if value.get("updatedAt") is not None:
        identity["updatedAt"] = str(value["updatedAt"])
    return identity


def token_is_sentence_end(token: str) -> bool:
    lowered = token.casefold()
    if lowered in ABBREVIATIONS:
        return False
    if re.fullmatch(r"(?:[A-Za-z]\.){2,}", token):
        return False
    return bool(SENTENCE_END_PATTERN.search(token))


def model_transcript_units(path: Path) -> tuple[list[TimedUnit], dict[str, Any], str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid model transcript: {path}") from error
    if not isinstance(payload, dict):
        raise ValueError("model transcript must be an object")
    if payload.get("schemaVersion") != 3:
        raise ValueError("model transcript must use schemaVersion 3")
    expected_fields = {
        "schemaVersion",
        "processor",
        "language",
        "engineLanguage",
        "timingUnitKind",
        "durationSeconds",
        "chunks",
        "segments",
        "words",
        "text",
    }
    if set(payload) != expected_fields:
        raise ValueError("model transcript fields do not match schemaVersion 3")
    processor = processor_identity(payload.get("processor"), "model transcript processor", timing_only=True)
    if payload.get("timingUnitKind") != "word":
        raise ValueError("model transcript must use word timing")
    transcript_language = payload.get("language")
    transcript_language = validate_language(transcript_language, "transcript language")
    if transcript_language == "und":
        raise ValueError("model transcript must contain the detected source language")
    engine_language = payload.get("engineLanguage")
    if not isinstance(engine_language, str) or not re.fullmatch(r"[a-z]{2,3}", engine_language):
        raise ValueError("model transcript must contain engineLanguage")
    raw_units = payload.get("words")
    if not isinstance(raw_units, list):
        raise ValueError("model transcript has no word or token timestamps")

    units: list[TimedUnit] = []
    for raw_unit in raw_units:
        if not isinstance(raw_unit, dict):
            continue
        raw_text = raw_unit.get("word") or raw_unit.get("text")
        start = raw_unit.get("start")
        end = raw_unit.get("end")
        if not isinstance(raw_text, str) or not raw_text.strip():
            continue
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or end <= start:
            continue
        start_ms = round(float(start) * 1000)
        end_ms = round(float(end) * 1000)
        raw_identifier = raw_unit.get("id")
        if isinstance(raw_identifier, int) and raw_identifier >= 0:
            identifier = f"U{raw_identifier + 1:06d}"
        elif isinstance(raw_identifier, str) and re.fullmatch(r"U[0-9]{6,}", raw_identifier):
            identifier = raw_identifier
        else:
            identifier = f"U{len(units) + 1:06d}"
        raw_kind = raw_unit.get("kind")
        kind = raw_kind if raw_kind in {"word", "token", "grapheme-group"} else "word"
        units.append(TimedUnit(identifier, raw_text.strip(), start_ms, max(end_ms, start_ms + 1), kind))

    if not units:
        raise ValueError("model transcript contains no usable timed units")
    identifiers = [unit.identifier for unit in units]
    if len(set(identifiers)) != len(identifiers):
        raise ValueError("model transcript timed unit IDs are not unique")
    for previous, current in zip(units, units[1:]):
        if current.start_ms < previous.start_ms:
            raise ValueError("model transcript timed units are not ordered")
    return units, processor, transcript_language


def segments_from_groups(groups: list[list[TimedUnit]], units: list[TimedUnit]) -> list[dict[str, object]]:
    unit_positions = {unit.identifier: index for index, unit in enumerate(units)}
    segments: list[dict[str, object]] = []
    for index, sentence_units in enumerate(groups, start=1):
        if not sentence_units:
            raise ValueError("complete-sentence group must not be empty")
        start_ms = sentence_units[0].start_ms
        last_unit = sentence_units[-1]
        end_ms = last_unit.fallback_end_ms
        last_position = unit_positions[last_unit.identifier]
        if last_position + 1 < len(units):
            end_ms = units[last_position + 1].start_ms
        end_ms = max(end_ms, start_ms + 1)
        segments.append(
            {
                "id": f"S{index:04d}",
                "start": format_timestamp(start_ms),
                "end": format_timestamp(end_ms),
                "sourceUnitStart": sentence_units[0].identifier,
                "sourceUnitEnd": sentence_units[-1].identifier,
                "sourceText": " ".join(unit.text for unit in sentence_units),
                "draftOutputText": "",
                "outputText": "",
                "requiredTerms": [],
            }
        )
    return segments


def segments_from_end_units(units: list[TimedUnit], end_unit_ids: list[str]) -> list[dict[str, object]]:
    positions = {unit.identifier: index for index, unit in enumerate(units)}
    if not end_unit_ids or end_unit_ids[-1] != units[-1].identifier:
        raise ValueError("sentence boundaries must end at the final timed unit")
    groups: list[list[TimedUnit]] = []
    start_position = 0
    for end_unit_id in end_unit_ids:
        if end_unit_id not in positions:
            raise ValueError(f"sentence boundary references an unknown timed unit: {end_unit_id}")
        end_position = positions[end_unit_id]
        if end_position < start_position:
            raise ValueError("sentence boundaries must be unique and chronological")
        groups.append(units[start_position : end_position + 1])
        start_position = end_position + 1
    if start_position != len(units):
        raise ValueError("sentence boundaries do not cover every timed unit")
    return segments_from_groups(groups, units)


def sentence_segments(units: list[TimedUnit]) -> list[dict[str, object]]:
    grouped: list[list[TimedUnit]] = []
    current: list[TimedUnit] = []
    for unit in units:
        if SOUND_LABEL_PATTERN.fullmatch(unit.text):
            if current:
                grouped.append(current)
                current = []
            grouped.append([unit])
            continue
        current.append(unit)
        if token_is_sentence_end(unit.text):
            grouped.append(current)
            current = []
    if current:
        grouped.append(current)

    return segments_from_groups(grouped, units)


def proofread_source_segments(
    path: Path,
    *,
    expected_language: str,
    expected_timing_artifact: str,
    units: list[TimedUnit],
) -> tuple[list[dict[str, object]], list[str], str, dict[str, str]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid proofread content manifest: {path}") from error
    if not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(
            f"proofread content manifest must use schemaVersion {SCHEMA_VERSION}"
        )
    if payload.get("mode") != "proofread":
        raise ValueError("translation content source must be a proofread manifest")
    if payload.get("sourceLanguage") != expected_language or payload.get("outputLanguage") != expected_language:
        raise ValueError("proofread content source language does not match the transcript")
    if payload.get("timingSourceArtifactId") != expected_timing_artifact:
        raise ValueError("proofread content source uses a different timing artifact")
    processor_identity(payload.get("contentProcessor"), "proofread contentProcessor")
    raw_segments = payload.get("segments")
    if not isinstance(raw_segments, list) or not raw_segments:
        raise ValueError("proofread content source has no reviewed sentences")
    review = sentence_review(payload.get("sentenceReview"))
    end_unit_ids = [
        str(raw_segment.get("sourceUnitEnd"))
        for raw_segment in raw_segments
        if isinstance(raw_segment, dict)
    ]
    if len(end_unit_ids) != len(raw_segments):
        raise ValueError("proofread content source contains an invalid sentence")
    transcript_segments = segments_from_end_units(units, end_unit_ids)
    translated_source: list[dict[str, object]] = []
    for transcript_segment, raw_segment in zip(
        transcript_segments, raw_segments, strict=True
    ):
        if not isinstance(raw_segment, dict):
            raise ValueError("proofread content source contains an invalid segment")
        identifier = transcript_segment["id"]
        for field in ("id", "sourceUnitStart", "sourceUnitEnd"):
            if raw_segment.get(field) != transcript_segment[field]:
                raise ValueError(
                    f"proofread content source changed {identifier}.{field}"
                )
        source_text = validate_content(
            raw_segment.get("outputText"), f"{identifier}.outputText"
        )
        required_terms = raw_segment.get("requiredTerms")
        if not isinstance(required_terms, list) or not all(
            isinstance(term, str) and term for term in required_terms
        ):
            raise ValueError(
                f"proofread content source has invalid {identifier}.requiredTerms"
            )
        translated_source.append(
            {
                **transcript_segment,
                "sourceText": source_text,
                "draftOutputText": "",
                "outputText": "",
                "requiredTerms": list(required_terms),
            }
        )
    references = payload.get("referenceArtifactIds")
    if not isinstance(references, list) or not all(
        isinstance(value, str) for value in references
    ):
        raise ValueError("proofread content source references are invalid")
    checksum = hashlib.sha256(path.read_bytes()).hexdigest()
    return translated_source, list(references), checksum, review


def sentence_review(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError("sentenceReview must be recorded by Agent before content work")
    if set(value) != {"provider", "service", "reviewedAt"}:
        raise ValueError("sentenceReview fields do not match the current contract")
    if value.get("provider") != "agent" or value.get("service") != "codex":
        raise ValueError("sentenceReview must use agent / codex")
    reviewed_at = value.get("reviewedAt")
    if not isinstance(reviewed_at, str) or not reviewed_at.endswith("Z"):
        raise ValueError("sentenceReview.reviewedAt is invalid")
    return {"provider": "agent", "service": "codex", "reviewedAt": reviewed_at}


def validate_sentence_partition(payload: dict[str, Any], segments: list[dict[str, object]]) -> None:
    source_transcript = payload.get("sourceTranscript")
    if not isinstance(source_transcript, str) or not source_transcript:
        raise ValueError("subtitle revision manifest has no source transcript")
    units, _, _ = model_transcript_units(Path(source_transcript))
    positions = {unit.identifier: index for index, unit in enumerate(units)}
    expected_start = 0
    for index, segment in enumerate(segments, start=1):
        identifier = str(segment.get("id"))
        if identifier != f"S{index:04d}":
            raise ValueError("complete-sentence IDs must be sequential")
        start_id = segment.get("sourceUnitStart")
        end_id = segment.get("sourceUnitEnd")
        if start_id not in positions or end_id not in positions:
            raise ValueError(f"{identifier} references an unknown timed unit")
        start_position = positions[str(start_id)]
        end_position = positions[str(end_id)]
        if start_position != expected_start or end_position < start_position:
            raise ValueError(f"{identifier} does not partition timed units continuously")
        unit_count = end_position - start_position + 1
        duration_ms = units[end_position].fallback_end_ms - units[start_position].start_ms
        if unit_count > 160 or duration_ms > 60_000:
            raise ValueError(
                f"SOURCE_SENTENCE_IMPLAUSIBLE: {identifier} spans {unit_count} units and {duration_ms} ms"
            )
        expected_start = end_position + 1
    if expected_start != len(units):
        raise ValueError("complete sentences do not cover every timed unit")


def render_vtt(
    segments: list[dict[str, object]],
    language: str,
    text_key: str,
    punctuation_policy: str,
) -> str:
    lines = ["WEBVTT", "Kind: captions", f"Language: {language}", ""]
    for segment in segments:
        identifier = str(segment["id"])
        text = normalize_display_text(
            validate_content(segment[text_key], f"{identifier}.{text_key}"),
            punctuation_policy,
        )
        if not text:
            raise ValueError(f"{identifier}.{text_key} is empty after display normalization")
        lines.extend([identifier, f"{segment['start']} --> {segment['end']}", text, ""])
    return "\n".join(lines)


def manifest_view(payload: object) -> ManifestView:
    if not isinstance(payload, dict):
        raise ValueError("subtitle revision manifest must be an object")
    schema_version = payload.get("schemaVersion")
    if schema_version == SCHEMA_VERSION:
        mode = payload.get("mode")
        if mode not in {"proofread", "translate"}:
            raise ValueError("mode must be proofread or translate")
        source_language = validate_language(payload.get("sourceLanguage"), "sourceLanguage")
        output_language = validate_language(payload.get("outputLanguage"), "outputLanguage")
        if mode == "proofread" and source_language != output_language:
            raise ValueError("proofread revisions must preserve the source language")
        if mode == "translate" and source_language == output_language:
            raise ValueError("translate revisions require different source and output languages")
        output_profile = payload.get("outputProfile")
        punctuation_policy = "preserve"
        if isinstance(output_profile, dict):
            raw_policy = output_profile.get("punctuationPolicy", "preserve")
            if raw_policy not in {"preserve", "remove-commas-periods"}:
                raise ValueError("outputProfile.punctuationPolicy is unsupported")
            punctuation_policy = str(raw_policy)
        source_key = "sourceText"
        output_key = "outputText"
        if "contentModel" in payload or "transcriptionModel" in payload:
            raise ValueError("subtitle revision manifest contains removed model fields")
        source_content_artifact = payload.get("sourceContentArtifactId")
        source_content_kind = payload.get("sourceContentKind")
        timing_source_artifact = payload.get("timingSourceArtifactId")
        if not isinstance(timing_source_artifact, str) or not timing_source_artifact:
            raise ValueError("subtitle revision manifest has no timing source artifact")
        if not isinstance(source_content_artifact, str) or not source_content_artifact:
            raise ValueError("subtitle revision manifest has no content source artifact")
        if source_content_kind not in {"model-transcript", "proofread"}:
            raise ValueError("subtitle revision manifest has an invalid content source kind")
        if mode == "proofread" and source_content_kind != "model-transcript":
            raise ValueError("proofread content must come from the model transcript")
        if mode == "translate" and source_content_kind != "proofread":
            raise ValueError("translation content must come from validated proofreading")
        if (
            source_content_kind == "model-transcript"
            and source_content_artifact != timing_source_artifact
        ):
            raise ValueError("model transcript content and timing sources must match")
        if source_content_kind == "proofread":
            if mode != "translate":
                raise ValueError("only translation accepts proofread content")
            source_manifest = payload.get("sourceContentManifest")
            source_checksum = payload.get("sourceContentChecksum")
            if not isinstance(source_manifest, str) or not source_manifest:
                raise ValueError("proofread content source manifest is missing")
            if not isinstance(source_checksum, str) or not re.fullmatch(
                r"[0-9a-f]{64}", source_checksum
            ):
                raise ValueError("proofread content source checksum is invalid")
            try:
                actual_source_checksum = hashlib.sha256(
                    Path(source_manifest).read_bytes()
                ).hexdigest()
            except OSError as error:
                raise ValueError("proofread content source manifest is unavailable") from error
            if actual_source_checksum != source_checksum:
                raise ValueError("proofread content source checksum changed")
        processor_identity(
            payload.get("timingProcessor"),
            "timingProcessor",
            timing_only=True,
        )
        processor_identity(payload.get("contentProcessor"), "contentProcessor")
        sentence_review(payload.get("sentenceReview"))
    else:
        raise ValueError(f"subtitle revision manifest must use schemaVersion {SCHEMA_VERSION}")

    raw_segments = payload.get("segments")
    if not isinstance(raw_segments, list) or not raw_segments:
        raise ValueError("subtitle revision manifest has no segments")
    segments: list[dict[str, object]] = []
    previous_end = -1
    for index, raw_segment in enumerate(raw_segments, start=1):
        if not isinstance(raw_segment, dict):
            raise ValueError(f"segment {index} must be an object")
        identifier = raw_segment.get("id")
        if not isinstance(identifier, str) or not SEGMENT_ID_PATTERN.fullmatch(identifier):
            raise ValueError(f"segment {index} has an invalid id")
        start = raw_segment.get("start")
        end = raw_segment.get("end")
        if not isinstance(start, str) or not isinstance(end, str):
            raise ValueError(f"{identifier} is missing timestamps")
        start_ms = parse_timestamp(start)
        end_ms = parse_timestamp(end)
        if start_ms < previous_end or end_ms <= start_ms:
            raise ValueError(f"{identifier} has overlapping or invalid timestamps")
        validate_content(raw_segment.get(source_key), f"{identifier}.{source_key}")
        validate_content(raw_segment.get(output_key), f"{identifier}.{output_key}")
        previous_end = end_ms
        segments.append(raw_segment)
    validate_sentence_partition(payload, segments)
    return ManifestView(
        str(mode),
        source_language,
        output_language,
        punctuation_policy,
        segments,
        source_key,
        output_key,
    )


def parse_vtt(path: Path) -> list[Cue]:
    try:
        content = path.read_text(encoding="utf-8-sig")
    except OSError as error:
        raise ValueError(f"unable to read VTT: {path}") from error
    if not content.startswith("WEBVTT"):
        raise ValueError(f"VTT header missing: {path}")
    cues: list[Cue] = []
    for block in re.split(r"\r?\n\s*\r?\n", content.strip()):
        lines = block.splitlines()
        timing_index = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if timing_index is None:
            continue
        match = VTT_TIMING_PATTERN.fullmatch(lines[timing_index].strip())
        if match is None:
            raise ValueError(f"invalid VTT timing line: {lines[timing_index]}")
        identifier = lines[timing_index - 1].strip() if timing_index > 0 else ""
        text = "\n".join(lines[timing_index + 1 :]).strip()
        cues.append(Cue(identifier, parse_timestamp(match.group("start")), parse_timestamp(match.group("end")), text))
    if not cues:
        raise ValueError(f"VTT has no cues: {path}")
    return cues


def validate_pair(source_path: Path, target_path: Path, punctuation_policy: str = "preserve") -> int:
    source_cues = parse_vtt(source_path)
    target_cues = parse_vtt(target_path)
    if len(source_cues) != len(target_cues):
        raise ValueError("paired VTT cue counts do not match")
    previous_end = -1
    for index, (source, target) in enumerate(zip(source_cues, target_cues), start=1):
        if source.identifier != target.identifier:
            raise ValueError(f"cue {index} identifiers do not match")
        if source.start_ms != target.start_ms or source.end_ms != target.end_ms:
            raise ValueError(f"cue {index} timestamps do not match")
        if source.start_ms < previous_end or source.end_ms <= source.start_ms:
            raise ValueError(f"cue {index} has overlapping or invalid timestamps")
        for label, cue in (("Source", source), ("Target", target)):
            validate_content(cue.text, f"{label} cue {index}")
            if "\n" in cue.text:
                raise ValueError(f"{label} cue {index} is split across lines")
            if punctuation_policy == "remove-commas-periods" and REMOVED_PUNCTUATION_PATTERN.search(cue.text):
                raise ValueError(f"{label} cue {index} still contains a comma or period")
        previous_end = source.end_ms
    return len(source_cues)


def prepare(args: argparse.Namespace) -> int:
    units, timing_processor, transcript_language = model_transcript_units(args.source_transcript)
    source_language = validate_language(args.source_language or transcript_language, "source language")
    output_language = validate_language(args.output_language, "output language")
    if args.mode == "proofread" and source_language != output_language:
        raise ValueError("proofread mode requires matching source and output languages")
    if args.mode == "translate" and source_language == output_language:
        raise ValueError("translate mode requires different source and output languages")
    if args.mode == "translate" and args.source_content_manifest is None:
        raise ValueError("translation requires a validated proofread content source")
    segments = sentence_segments(units)
    source_content_artifact = args.source_content_artifact or args.timing_source_artifact
    source_content_kind = "model-transcript"
    source_content_manifest: str | None = None
    source_content_checksum: str | None = None
    inherited_sentence_review: dict[str, str] | None = None
    references = list(args.reference_artifact)
    if (
        args.source_content_manifest is None
        and source_content_artifact != args.timing_source_artifact
    ):
        raise ValueError(
            "model transcript content and timing sources must use the same artifact"
        )
    if args.source_content_manifest is not None:
        if args.mode != "translate":
            raise ValueError("only translation accepts a proofread content source")
        if not args.source_content_artifact:
            raise ValueError(
                "translation from proofreading requires --source-content-artifact"
            )
        segments, references, source_content_checksum, inherited_sentence_review = proofread_source_segments(
            args.source_content_manifest,
            expected_language=source_language,
            expected_timing_artifact=args.timing_source_artifact,
            units=units,
        )
        source_content_kind = "proofread"
        source_content_manifest = str(args.source_content_manifest)
        if args.reference_artifact:
            raise ValueError(
                "translation inherits text references from its proofread content source"
            )
    payload: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "mode": args.mode,
        "sourceFormat": "model-timed-units",
        "sourceLanguage": source_language,
        "outputLanguage": output_language,
        "sourceTranscript": str(args.source_transcript),
        "timingSourceArtifactId": args.timing_source_artifact,
        "sourceContentArtifactId": source_content_artifact,
        "sourceContentKind": source_content_kind,
        "sourceContentManifest": source_content_manifest,
        "sourceContentChecksum": source_content_checksum,
        "referenceArtifactIds": references,
        "timingProcessor": timing_processor,
        "contentProcessor": None,
        "sentenceReview": inherited_sentence_review,
        "outputProfile": {"punctuationPolicy": args.punctuation_policy},
        "rules": {
            "contentUnit": "complete source sentence",
            "outputSegmentation": "owned by segment-subtitles",
        },
        "segments": segments,
    }
    atomic_write_text(args.manifest, json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    source_output = args.source_output
    if source_output is not None:
        atomic_write_text(
            source_output,
            render_vtt(segments, source_language, "sourceText", args.punctuation_policy),
        )
    print(f"Prepared {len(segments)} complete-sentence {args.mode} units: {args.manifest}")
    return 0


def record_content_processor(args: argparse.Namespace) -> int:
    payload = json.loads(args.manifest.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(f"content processor metadata requires a schemaVersion {SCHEMA_VERSION} manifest")
    sentence_review(payload.get("sentenceReview"))
    metadata: dict[str, str] = {
        "provider": "agent",
        "service": "codex",
        "updatedAt": utc_now(),
    }
    metadata = processor_identity(metadata, "contentProcessor")
    payload["contentProcessor"] = metadata
    atomic_write_text(args.manifest, json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print(f"Recorded agent content processor codex: {args.manifest}")
    return 0


def record_sentence_review(args: argparse.Namespace) -> int:
    payload = json.loads(args.manifest.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(
            f"sentence review requires a schemaVersion {SCHEMA_VERSION} manifest"
        )
    if payload.get("sourceContentKind") == "proofread":
        raise ValueError("translation inherits sentence review from proofreading")
    boundaries = json.loads(args.boundaries.read_text(encoding="utf-8"))
    if not isinstance(boundaries, dict) or set(boundaries) != {
        "schemaVersion",
        "boundaryAfterUnitIds",
    }:
        raise ValueError("sentence boundary file fields do not match the current contract")
    if boundaries.get("schemaVersion") != 1:
        raise ValueError("sentence boundary file must use schemaVersion 1")
    raw_ids = boundaries.get("boundaryAfterUnitIds")
    if not isinstance(raw_ids, list) or not all(isinstance(value, str) for value in raw_ids):
        raise ValueError("boundaryAfterUnitIds must be a list of timed-unit IDs")
    units, _, _ = model_transcript_units(Path(str(payload.get("sourceTranscript"))))
    existing_segments = payload.get("segments")
    if not isinstance(existing_segments, list) or any(
        not isinstance(segment, dict)
        or str(segment.get("draftOutputText", "")).strip()
        or str(segment.get("outputText", "")).strip()
        for segment in existing_segments
    ):
        raise ValueError("sentence boundaries must be reviewed before content text is written")
    payload["segments"] = segments_from_end_units(units, list(raw_ids))
    payload["sentenceReview"] = {
        "provider": "agent",
        "service": "codex",
        "reviewedAt": utc_now(),
    }
    atomic_write_text(
        args.manifest,
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )
    if args.source_output is not None:
        punctuation_policy = str(
            payload.get("outputProfile", {}).get("punctuationPolicy", "preserve")
        )
        atomic_write_text(
            args.source_output,
            render_vtt(
                payload["segments"],
                str(payload["sourceLanguage"]),
                "sourceText",
                punctuation_policy,
            ),
        )
    print(f"Recorded Agent-reviewed sentence boundaries: {args.manifest}")
    return 0


def render(args: argparse.Namespace) -> int:
    try:
        payload = json.loads(args.manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid subtitle revision manifest: {args.manifest}") from error
    view = manifest_view(payload)
    source_output = args.input_output
    output = args.output
    atomic_write_text(
        source_output,
        render_vtt(view.segments, view.source_language, view.source_key, view.punctuation_policy),
    )
    atomic_write_text(
        output,
        render_vtt(view.segments, view.output_language, view.output_key, view.punctuation_policy),
    )
    validate_pair(source_output, output, view.punctuation_policy)
    print(
        f"Rendered {len(view.segments)} synchronized complete-sentence cues "
        f"for {view.source_language} -> {view.output_language}."
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--source-transcript", required=True, type=Path)
    prepare_parser.add_argument("--manifest", required=True, type=Path)
    prepare_parser.add_argument("--mode", required=True, choices=("proofread", "translate"))
    prepare_parser.add_argument("--source-language")
    prepare_parser.add_argument("--output-language", required=True)
    prepare_parser.add_argument("--timing-source-artifact", required=True)
    prepare_parser.add_argument("--source-content-artifact")
    prepare_parser.add_argument("--source-content-manifest", type=Path)
    prepare_parser.add_argument("--reference-artifact", action="append", default=[])
    prepare_parser.add_argument("--source-output", type=Path)
    prepare_parser.add_argument(
        "--punctuation-policy",
        choices=("preserve", "remove-commas-periods"),
        default="preserve",
    )
    prepare_parser.set_defaults(handler=prepare)

    processor_parser = subparsers.add_parser("record-content-processor")
    processor_parser.add_argument("--manifest", required=True, type=Path)
    processor_parser.set_defaults(handler=record_content_processor)

    sentence_parser = subparsers.add_parser("record-sentence-review")
    sentence_parser.add_argument("--manifest", required=True, type=Path)
    sentence_parser.add_argument("--boundaries", required=True, type=Path)
    sentence_parser.add_argument("--source-output", type=Path)
    sentence_parser.set_defaults(handler=record_sentence_review)

    render_parser = subparsers.add_parser("render")
    render_parser.add_argument("--manifest", required=True, type=Path)
    render_parser.add_argument("--input-output", required=True, type=Path)
    render_parser.add_argument("--output", required=True, type=Path)
    render_parser.set_defaults(handler=render)

    manifest_parser = subparsers.add_parser("validate-manifest")
    manifest_parser.add_argument("--manifest", required=True, type=Path)

    def validate_manifest_command(args: argparse.Namespace) -> int:
        try:
            payload = json.loads(args.manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError(f"invalid subtitle revision manifest: {args.manifest}") from error
        view = manifest_view(payload)
        print(
            f"Validated {len(view.segments)} complete-sentence manifest units "
            f"for {view.source_language} -> {view.output_language}."
        )
        return 0

    manifest_parser.set_defaults(handler=validate_manifest_command)

    validate_parser = subparsers.add_parser("validate-pair")
    validate_parser.add_argument("--input", required=True, type=Path)
    validate_parser.add_argument("--output", required=True, type=Path)
    validate_parser.add_argument(
        "--punctuation-policy",
        choices=("preserve", "remove-commas-periods"),
        default="preserve",
    )

    def validate_pair_command(args: argparse.Namespace) -> int:
        count = validate_pair(args.input, args.output, args.punctuation_policy)
        print(f"Validated {count} synchronized subtitle cues.")
        return 0

    validate_parser.set_defaults(handler=validate_pair_command)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return int(args.handler(args))
    except ValueError as error:
        raise SystemExit(f"error: {error}") from error


if __name__ == "__main__":
    raise SystemExit(main())
