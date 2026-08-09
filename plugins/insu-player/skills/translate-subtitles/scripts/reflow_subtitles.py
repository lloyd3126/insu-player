#!/usr/bin/env python3
"""Build complete-sentence translation manifests from model-timed source units."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 2
LEGACY_SCHEMA_VERSION = 1
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
    source_language: str
    target_language: str
    punctuation_policy: str
    segments: list[dict[str, object]]
    source_key: str
    target_key: str


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


def token_is_sentence_end(token: str) -> bool:
    lowered = token.casefold()
    if lowered in ABBREVIATIONS:
        return False
    if re.fullmatch(r"(?:[A-Za-z]\.){2,}", token):
        return False
    return bool(SENTENCE_END_PATTERN.search(token))


def model_transcript_units(path: Path) -> tuple[list[TimedUnit], str, str, str | None]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid model transcript: {path}") from error
    if not isinstance(payload, dict):
        raise ValueError("model transcript must be an object")
    provider = payload.get("provider")
    model = payload.get("model")
    if provider not in {"local", "openai"}:
        raise ValueError("model transcript provider must be local or openai")
    if not isinstance(model, str) or not model.strip():
        raise ValueError("model transcript has no model name")
    transcript_language = payload.get("language")
    if transcript_language is not None:
        transcript_language = validate_language(transcript_language, "transcript language")
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
    return units, provider, model.strip(), transcript_language


def sentence_segments(units: list[TimedUnit]) -> list[dict[str, object]]:
    unit_positions = {unit.identifier: index for index, unit in enumerate(units)}
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

    segments: list[dict[str, object]] = []
    for index, sentence_units in enumerate(grouped, start=1):
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
                "draftTargetText": "",
                "targetText": "",
                "requiredTerms": [],
            }
        )
    return segments


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
        raise ValueError("translation manifest must be an object")
    schema_version = payload.get("schemaVersion")
    if schema_version == SCHEMA_VERSION:
        source_language = validate_language(payload.get("sourceLanguage"), "sourceLanguage")
        target_language = validate_language(payload.get("targetLanguage"), "targetLanguage")
        output_profile = payload.get("outputProfile")
        punctuation_policy = "preserve"
        if isinstance(output_profile, dict):
            raw_policy = output_profile.get("punctuationPolicy", "preserve")
            if raw_policy not in {"preserve", "remove-commas-periods"}:
                raise ValueError("outputProfile.punctuationPolicy is unsupported")
            punctuation_policy = str(raw_policy)
        source_key = "sourceText"
        target_key = "targetText"
        translation_model = payload.get("translationModel")
        if not isinstance(translation_model, dict):
            raise ValueError("translationModel must be recorded before rendering")
        if translation_model.get("provider") not in {"local", "api"}:
            raise ValueError("translationModel.provider must be local or api")
        validate_content(translation_model.get("model"), "translationModel.model")
    elif schema_version == LEGACY_SCHEMA_VERSION:
        source_language = "en"
        target_language = "zh-TW"
        punctuation_policy = "remove-commas-periods"
        source_key = "english"
        target_key = "traditionalChinese"
    else:
        raise ValueError("unsupported translation manifest")

    raw_segments = payload.get("segments")
    if not isinstance(raw_segments, list) or not raw_segments:
        raise ValueError("translation manifest has no segments")
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
        validate_content(raw_segment.get(target_key), f"{identifier}.{target_key}")
        previous_end = end_ms
        segments.append(raw_segment)
    return ManifestView(
        source_language,
        target_language,
        punctuation_policy,
        segments,
        source_key,
        target_key,
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
    units, provider, model, transcript_language = model_transcript_units(args.source_transcript)
    source_language = validate_language(args.source_language or transcript_language, "source language")
    target_language = validate_language(args.target_language, "target language")
    segments = sentence_segments(units)
    payload: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "sourceFormat": "model-timed-units",
        "sourceProvider": provider,
        "sourceModel": model,
        "sourceLanguage": source_language,
        "targetLanguage": target_language,
        "sourceTranscript": str(args.source_transcript),
        "translationModel": None,
        "outputProfile": {"punctuationPolicy": args.punctuation_policy},
        "rules": {
            "translationUnit": "complete source sentence",
            "targetSegmentation": "owned by segment-subtitles",
        },
        "segments": segments,
    }
    atomic_write_text(args.manifest, json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    source_output = args.source_output or args.english_output
    if source_output is not None:
        atomic_write_text(
            source_output,
            render_vtt(segments, source_language, "sourceText", args.punctuation_policy),
        )
    print(f"Prepared {len(segments)} complete-sentence translation units: {args.manifest}")
    return 0


def record_translation_model(args: argparse.Namespace) -> int:
    payload = json.loads(args.manifest.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError("translation model metadata requires a schemaVersion 2 manifest")
    model = validate_content(args.model, "translation model")
    metadata: dict[str, str] = {
        "provider": args.provider,
        "model": model,
        "updatedAt": utc_now(),
    }
    if args.service:
        metadata["service"] = validate_content(args.service, "translation service")
    payload["translationModel"] = metadata
    atomic_write_text(args.manifest, json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print(f"Recorded {args.provider} translation model {model}: {args.manifest}")
    return 0


def render(args: argparse.Namespace) -> int:
    try:
        payload = json.loads(args.manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid translation manifest: {args.manifest}") from error
    view = manifest_view(payload)
    source_output = args.source_output or args.english_output
    target_output = args.target_output or args.traditional_chinese_output
    if source_output is None or target_output is None:
        raise ValueError("render requires --source-output and --target-output")
    atomic_write_text(
        source_output,
        render_vtt(view.segments, view.source_language, view.source_key, view.punctuation_policy),
    )
    atomic_write_text(
        target_output,
        render_vtt(view.segments, view.target_language, view.target_key, view.punctuation_policy),
    )
    validate_pair(source_output, target_output, view.punctuation_policy)
    print(
        f"Rendered {len(view.segments)} synchronized complete-sentence cues "
        f"for {view.source_language} -> {view.target_language}."
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--source-transcript", required=True, type=Path)
    prepare_parser.add_argument("--manifest", required=True, type=Path)
    prepare_parser.add_argument("--source-language")
    prepare_parser.add_argument("--target-language", required=True)
    prepare_parser.add_argument("--source-output", type=Path)
    prepare_parser.add_argument("--english-output", type=Path, help=argparse.SUPPRESS)
    prepare_parser.add_argument(
        "--punctuation-policy",
        choices=("preserve", "remove-commas-periods"),
        default="preserve",
    )
    prepare_parser.set_defaults(handler=prepare)

    model_parser = subparsers.add_parser("record-translation-model")
    model_parser.add_argument("--manifest", required=True, type=Path)
    model_parser.add_argument("--provider", required=True, choices=("local", "api"))
    model_parser.add_argument("--service")
    model_parser.add_argument("--model", required=True)
    model_parser.set_defaults(handler=record_translation_model)

    render_parser = subparsers.add_parser("render")
    render_parser.add_argument("--manifest", required=True, type=Path)
    render_parser.add_argument("--source-output", type=Path)
    render_parser.add_argument("--target-output", type=Path)
    render_parser.add_argument("--english-output", type=Path, help=argparse.SUPPRESS)
    render_parser.add_argument("--traditional-chinese-output", type=Path, help=argparse.SUPPRESS)
    render_parser.set_defaults(handler=render)

    validate_parser = subparsers.add_parser("validate-pair")
    validate_parser.add_argument("--source", type=Path)
    validate_parser.add_argument("--target", type=Path)
    validate_parser.add_argument("--english", type=Path, help=argparse.SUPPRESS)
    validate_parser.add_argument("--traditional-chinese", type=Path, help=argparse.SUPPRESS)
    validate_parser.add_argument(
        "--punctuation-policy",
        choices=("preserve", "remove-commas-periods"),
        default="preserve",
    )

    def validate_pair_command(args: argparse.Namespace) -> int:
        source = args.source or args.english
        target = args.target or args.traditional_chinese
        if source is None or target is None:
            raise ValueError("validate-pair requires --source and --target")
        count = validate_pair(source, target, args.punctuation_policy)
        print(f"Validated {count} synchronized bilingual cues.")
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
