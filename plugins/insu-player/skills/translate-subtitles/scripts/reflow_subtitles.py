#!/usr/bin/env python3
"""Build sentence-aligned bilingual WebVTT tracks from model word timing."""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
SENTENCE_ID_PATTERN = re.compile(r"^S[0-9]{4,}$")
SENTENCE_END_PATTERN = re.compile(r"[.!?。！？](?:[\"'”’\)\]]+)?$")
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
class Word:
    text: str
    start_ms: int
    fallback_end_ms: int


@dataclass(frozen=True)
class Cue:
    identifier: str
    start_ms: int
    end_ms: int
    text: str


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


def normalize_display_text(value: str) -> str:
    normalized = REMOVED_PUNCTUATION_PATTERN.sub(" ", value)
    return " ".join(normalized.split())


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


def model_transcript_words(path: Path) -> tuple[list[Word], str, str]:
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
    raw_words = payload.get("words")
    if not isinstance(raw_words, list):
        raise ValueError("model transcript has no word timestamps")

    words: list[Word] = []
    for raw_word in raw_words:
        if not isinstance(raw_word, dict):
            continue
        raw_text = raw_word.get("word") or raw_word.get("text")
        start = raw_word.get("start")
        end = raw_word.get("end")
        if not isinstance(raw_text, str) or not raw_text.strip():
            continue
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or end <= start:
            continue
        start_ms = round(float(start) * 1000)
        end_ms = round(float(end) * 1000)
        words.append(Word(raw_text.strip(), start_ms, max(end_ms, start_ms + 1)))

    if not words:
        raise ValueError("model transcript contains no usable timed words")
    for previous, current in zip(words, words[1:]):
        if current.start_ms < previous.start_ms:
            raise ValueError("model transcript word timing is not ordered")
    return words, provider, model.strip()


def sentence_segments(words: list[Word]) -> list[dict[str, object]]:
    word_positions = {id(word): index for index, word in enumerate(words)}
    grouped: list[list[Word]] = []
    current: list[Word] = []
    for word in words:
        if SOUND_LABEL_PATTERN.fullmatch(word.text):
            if current:
                grouped.append(current)
                current = []
            grouped.append([word])
            continue
        current.append(word)
        if token_is_sentence_end(word.text):
            grouped.append(current)
            current = []
    if current:
        grouped.append(current)

    segments: list[dict[str, object]] = []
    for index, sentence_words in enumerate(grouped, start=1):
        start_ms = sentence_words[0].start_ms
        last_word = sentence_words[-1]
        end_ms = last_word.fallback_end_ms
        last_position = word_positions[id(last_word)]
        if last_position + 1 < len(words):
            end_ms = words[last_position + 1].start_ms
        end_ms = max(end_ms, start_ms + 1)
        segments.append(
            {
                "id": f"S{index:04d}",
                "start": format_timestamp(start_ms),
                "end": format_timestamp(end_ms),
                "english": " ".join(word.text for word in sentence_words),
                "draftTraditionalChinese": "",
                "traditionalChinese": "",
            }
        )
    return segments


def render_vtt(segments: list[dict[str, object]], language: str, text_key: str) -> str:
    lines = ["WEBVTT", "Kind: captions", f"Language: {language}", ""]
    for segment in segments:
        identifier = str(segment["id"])
        text = normalize_display_text(validate_content(segment[text_key], f"{identifier}.{text_key}"))
        if not text:
            raise ValueError(f"{identifier}.{text_key} is empty after punctuation normalization")
        lines.extend(
            [
                identifier,
                f"{segment['start']} --> {segment['end']}",
                text,
                "",
            ]
        )
    return "\n".join(lines)


def validate_manifest(payload: object) -> list[dict[str, object]]:
    if not isinstance(payload, dict) or payload.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError("unsupported bilingual reflow manifest")
    raw_segments = payload.get("segments")
    if not isinstance(raw_segments, list) or not raw_segments:
        raise ValueError("bilingual reflow manifest has no segments")

    segments: list[dict[str, object]] = []
    previous_end = -1
    for index, raw_segment in enumerate(raw_segments, start=1):
        if not isinstance(raw_segment, dict):
            raise ValueError(f"segment {index} must be an object")
        identifier = raw_segment.get("id")
        if not isinstance(identifier, str) or not SENTENCE_ID_PATTERN.fullmatch(identifier):
            raise ValueError(f"segment {index} has an invalid id")
        start = raw_segment.get("start")
        end = raw_segment.get("end")
        if not isinstance(start, str) or not isinstance(end, str):
            raise ValueError(f"{identifier} is missing timestamps")
        start_ms = parse_timestamp(start)
        end_ms = parse_timestamp(end)
        if start_ms < previous_end or end_ms <= start_ms:
            raise ValueError(f"{identifier} has overlapping or invalid timestamps")
        validate_content(raw_segment.get("english"), f"{identifier}.english")
        validate_content(raw_segment.get("traditionalChinese"), f"{identifier}.traditionalChinese")
        previous_end = end_ms
        segments.append(raw_segment)
    return segments


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
        cues.append(
            Cue(
                identifier=identifier,
                start_ms=parse_timestamp(match.group("start")),
                end_ms=parse_timestamp(match.group("end")),
                text=text,
            )
        )
    if not cues:
        raise ValueError(f"VTT has no cues: {path}")
    return cues


def validate_pair(english_path: Path, traditional_chinese_path: Path) -> int:
    english_cues = parse_vtt(english_path)
    chinese_cues = parse_vtt(traditional_chinese_path)
    if len(english_cues) != len(chinese_cues):
        raise ValueError("bilingual VTT cue counts do not match")
    previous_end = -1
    for index, (english, chinese) in enumerate(zip(english_cues, chinese_cues), start=1):
        if english.identifier != chinese.identifier:
            raise ValueError(f"cue {index} identifiers do not match")
        if english.start_ms != chinese.start_ms or english.end_ms != chinese.end_ms:
            raise ValueError(f"cue {index} timestamps do not match")
        if english.start_ms < previous_end or english.end_ms <= english.start_ms:
            raise ValueError(f"cue {index} has overlapping or invalid timestamps")
        for label, cue in (("English", english), ("Traditional Chinese", chinese)):
            validate_content(cue.text, f"{label} cue {index}")
            if "\n" in cue.text:
                raise ValueError(f"{label} cue {index} is split across lines")
            if REMOVED_PUNCTUATION_PATTERN.search(cue.text):
                raise ValueError(f"{label} cue {index} still contains a comma or period")
        previous_end = english.end_ms
    return len(english_cues)


def prepare(args: argparse.Namespace) -> int:
    words, provider, model = model_transcript_words(args.source_transcript)
    segments = sentence_segments(words)
    payload: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "sourceFormat": "model-word-transcript",
        "sourceProvider": provider,
        "sourceModel": model,
        "source": str(args.source_transcript),
        "rules": {
            "alignment": "shared-complete-sentence-timestamps",
            "punctuation": "replace commas and periods with ASCII spaces",
            "lineLayout": "one complete sentence per cue",
        },
        "segments": segments,
    }
    atomic_write_text(
        args.manifest,
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )
    if args.english_output is not None:
        english_vtt = render_vtt(segments, "en", "english")
        atomic_write_text(args.english_output, english_vtt)
    print(f"Prepared {len(segments)} complete-sentence segments: {args.manifest}")
    return 0


def render(args: argparse.Namespace) -> int:
    try:
        payload = json.loads(args.manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid bilingual reflow manifest: {args.manifest}") from error
    segments = validate_manifest(payload)
    atomic_write_text(args.english_output, render_vtt(segments, "en", "english"))
    atomic_write_text(
        args.traditional_chinese_output,
        render_vtt(segments, "zh-TW", "traditionalChinese"),
    )
    validate_pair(args.english_output, args.traditional_chinese_output)
    print(f"Rendered {len(segments)} synchronized bilingual cues.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--source-transcript", required=True, type=Path)
    prepare_parser.add_argument("--manifest", required=True, type=Path)
    prepare_parser.add_argument("--english-output", type=Path)
    prepare_parser.set_defaults(handler=prepare)

    render_parser = subparsers.add_parser("render")
    render_parser.add_argument("--manifest", required=True, type=Path)
    render_parser.add_argument("--english-output", required=True, type=Path)
    render_parser.add_argument("--traditional-chinese-output", required=True, type=Path)
    render_parser.set_defaults(handler=render)

    validate_parser = subparsers.add_parser("validate-pair")
    validate_parser.add_argument("--english", required=True, type=Path)
    validate_parser.add_argument("--traditional-chinese", required=True, type=Path)
    validate_parser.set_defaults(
        handler=lambda args: print(
            f"Validated {validate_pair(args.english, args.traditional_chinese)} synchronized bilingual cues."
        )
        or 0
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return int(args.handler(args))
    except ValueError as error:
        raise SystemExit(f"error: {error}") from error


if __name__ == "__main__":
    raise SystemExit(main())
