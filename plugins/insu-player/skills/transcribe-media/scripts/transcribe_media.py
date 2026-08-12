#!/usr/bin/env python3
"""Create strict word-timed transcript artifacts with local or cloud STT."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from hashlib import sha256
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from transcription_providers import (  # noqa: E402
    CLOUD_PROVIDERS,
    PROVIDER_API_KEYS,
    processor_identity,
    transcribe_chunk,
    validate_model,
)

API_FILE_LIMIT = 25 * 1024 * 1024
DEFAULT_CHUNK_SECONDS = 600
TRANSCRIPT_SCHEMA_VERSION = 3
LANGUAGE_PATTERN = re.compile(r"^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|und)$")

# Current Whisper language parameters. This is a model capability boundary, not
# a list of every valid BCP 47 language.
WHISPER_LANGUAGE_CODES = {
    "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs",
    "ca", "cs", "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi",
    "fo", "fr", "gl", "gu", "ha", "haw", "he", "hi", "hr", "ht", "hu", "hy",
    "id", "is", "it", "ja", "jw", "ka", "kk", "km", "kn", "ko", "la", "lb",
    "ln", "lo", "lt", "lv", "mg", "mi", "mk", "ml", "mn", "mr", "ms", "mt",
    "my", "ne", "nl", "nn", "no", "oc", "pa", "pl", "ps", "pt", "ro", "ru",
    "sa", "sd", "si", "sk", "sl", "sn", "so", "sq", "sr", "su", "sv", "sw",
    "ta", "te", "tg", "th", "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi",
    "yi", "yo", "zh",
}
WHISPER_LANGUAGE_PARAMETERS = {
    "fil": "tl",
    "jv": "jw",
    "nb": "no",
}

# Whisper APIs may return a human-readable language name instead of the model
# parameter. Keep this mapping local to the current Whisper timing contract so
# an arbitrary alphabetic string cannot be mistaken for a BCP 47 language tag.
WHISPER_LANGUAGE_NAMES = {
    "afrikaans": "af", "albanian": "sq", "amharic": "am", "arabic": "ar",
    "armenian": "hy", "assamese": "as", "azerbaijani": "az", "bashkir": "ba",
    "basque": "eu", "belarusian": "be", "bengali": "bn", "bosnian": "bs",
    "breton": "br", "bulgarian": "bg", "burmese": "my",
    "catalan": "ca", "chinese": "zh", "croatian": "hr", "czech": "cs",
    "danish": "da", "dutch": "nl", "english": "en", "estonian": "et",
    "faroese": "fo", "finnish": "fi", "flemish": "nl", "french": "fr",
    "galician": "gl", "georgian": "ka", "german": "de", "greek": "el",
    "gujarati": "gu", "haitian": "ht", "haitian creole": "ht", "hausa": "ha",
    "hawaiian": "haw", "hebrew": "he", "hindi": "hi", "hungarian": "hu",
    "icelandic": "is", "indonesian": "id", "italian": "it", "japanese": "ja",
    "javanese": "jv", "kannada": "kn", "kazakh": "kk", "khmer": "km",
    "korean": "ko", "lao": "lo", "latin": "la", "latvian": "lv",
    "lingala": "ln", "lithuanian": "lt", "luxembourgish": "lb",
    "macedonian": "mk", "malagasy": "mg", "malay": "ms", "malayalam": "ml",
    "maltese": "mt", "mandarin": "zh", "maori": "mi", "marathi": "mr",
    "moldavian": "ro", "moldovan": "ro", "mongolian": "mn", "myanmar": "my",
    "nepali": "ne", "norwegian": "no", "nynorsk": "nn", "occitan": "oc",
    "pashto": "ps", "persian": "fa", "polish": "pl", "portuguese": "pt",
    "punjabi": "pa", "pushto": "ps", "romanian": "ro", "russian": "ru",
    "sanskrit": "sa", "serbian": "sr", "shona": "sn", "sindhi": "sd",
    "sinhala": "si", "sinhalese": "si", "slovak": "sk", "slovenian": "sl",
    "somali": "so", "spanish": "es", "sundanese": "su", "swahili": "sw",
    "swedish": "sv", "tagalog": "fil", "filipino": "fil", "tajik": "tg", "tamil": "ta",
    "tatar": "tt", "telugu": "te", "thai": "th", "tibetan": "bo",
    "turkish": "tr", "turkmen": "tk", "ukrainian": "uk", "urdu": "ur",
    "uzbek": "uz", "valencian": "ca", "vietnamese": "vi", "welsh": "cy",
    "yiddish": "yi", "yoruba": "yo",
}

XAI_LANGUAGE_NAMES = {
    "arabic": "ar",
    "czech": "cs",
    "danish": "da",
    "dutch": "nl",
    "english": "en",
    "filipino": "fil",
    "french": "fr",
    "german": "de",
    "hindi": "hi",
    "indonesian": "id",
    "italian": "it",
    "japanese": "ja",
    "korean": "ko",
    "macedonian": "mk",
    "malay": "ms",
    "persian": "fa",
    "polish": "pl",
    "portuguese": "pt",
    "romanian": "ro",
    "russian": "ru",
    "spanish": "es",
    "swedish": "sv",
    "thai": "th",
    "turkish": "tr",
    "vietnamese": "vi",
}
XAI_LANGUAGE_CODES = set(XAI_LANGUAGE_NAMES.values())


def canonical_language_tag(language: str | None) -> str | None:
    if language is None:
        return None
    if not isinstance(language, str) or not LANGUAGE_PATTERN.fullmatch(language):
        raise ValueError(f"invalid BCP 47 language tag: {language!r}")
    parts = language.split("-")
    if parts[0].lower() == "und":
        if len(parts) != 1:
            raise ValueError("und cannot include language subtags")
        return "und"
    normalized = [parts[0].lower()]
    for part in parts[1:]:
        if len(part) == 4 and part.isalpha():
            normalized.append(part.title())
        elif (len(part) == 2 and part.isalpha()) or (len(part) == 3 and part.isdigit()):
            normalized.append(part.upper())
        else:
            normalized.append(part.lower())
    return "-".join(normalized)


def engine_language_code(language: str | None) -> str | None:
    """Return the ISO language subtag accepted by transcription engines.

    The workflow keeps the full BCP 47 tag in manifests and transcript metadata,
    while Whisper and the OpenAI transcription endpoint consume the base language
    code (for example, ``en-US`` becomes ``en``).
    """
    canonical = canonical_language_tag(language)
    if canonical is None or canonical == "und":
        return None
    code = canonical.split("-", 1)[0]
    parameter = WHISPER_LANGUAGE_PARAMETERS.get(code, code)
    if parameter not in WHISPER_LANGUAGE_CODES:
        raise ValueError(
            f"current Whisper model does not accept language {canonical!r}; "
            "choose a supported timing model or use automatic detection"
        )
    return parameter


def provider_language_parameter(provider: str, language: str | None) -> str | None:
    canonical = canonical_language_tag(language)
    if canonical is None or canonical == "und":
        return None
    if provider == "xai":
        code = canonical.split("-", 1)[0]
        if code not in XAI_LANGUAGE_CODES:
            raise ValueError(
                f"xAI speech-to-text does not accept language {canonical!r} for formatting"
            )
        return code
    if provider == "elevenlabs":
        return canonical.split("-", 1)[0]
    return engine_language_code(canonical)


def detected_language_from_payload(provider: str, payload: dict[str, Any]) -> str | None:
    raw = payload.get("language_code") if provider == "elevenlabs" else payload.get("language")
    if not isinstance(raw, str) or not raw.strip():
        return None
    value = raw.strip()
    if provider == "xai":
        mapped = XAI_LANGUAGE_NAMES.get(value.lower())
        if not mapped:
            raise ValueError(f"xAI returned an unmapped detected language: {value!r}")
        return mapped
    if provider in {"openai", "groq", "openrouter"}:
        mapped = WHISPER_LANGUAGE_NAMES.get(" ".join(value.lower().split()))
        if mapped:
            return mapped
        canonical = canonical_language_tag(value)
        engine_language_code(canonical)
        if canonical == "tl" or canonical.startswith("tl-"):
            return "fil" + canonical[2:]
        if canonical == "jw" or canonical.startswith("jw-"):
            return "jv" + canonical[2:]
        return canonical
    return canonical_language_tag(value)


def timestamp(seconds: float) -> str:
    milliseconds = max(0, round(float(seconds) * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d}.{millis:03d}"


def normalize_segments(raw_segments: object, *, offset: float = 0.0) -> list[dict[str, Any]]:
    if not isinstance(raw_segments, list):
        raise ValueError("transcription response did not include timestamped segments")
    normalized: list[dict[str, Any]] = []
    for raw in raw_segments:
        if hasattr(raw, "model_dump"):
            raw = raw.model_dump()
        elif not isinstance(raw, dict):
            raw = {
                "start": getattr(raw, "start", None),
                "end": getattr(raw, "end", None),
                "text": getattr(raw, "text", ""),
            }
        if not isinstance(raw, dict):
            continue
        start = raw.get("start")
        end = raw.get("end")
        text = str(raw.get("text") or "").strip()
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or end <= start or not text:
            continue
        normalized.append(
            {
                "id": len(normalized),
                "start": round(float(start) + offset, 3),
                "end": round(float(end) + offset, 3),
                "text": text,
            }
        )
    if not normalized:
        raise ValueError("transcription produced no usable timestamped segments")
    return normalized


def normalize_words(raw_words: object, *, offset: float = 0.0) -> list[dict[str, Any]]:
    if not isinstance(raw_words, list):
        raise ValueError("transcription response did not include word timestamps")
    normalized: list[dict[str, Any]] = []
    for raw in raw_words:
        if hasattr(raw, "model_dump"):
            raw = raw.model_dump()
        elif not isinstance(raw, dict):
            raw = {
                "start": getattr(raw, "start", None),
                "end": getattr(raw, "end", None),
                "word": getattr(raw, "word", getattr(raw, "text", "")),
            }
        if not isinstance(raw, dict):
            continue
        if raw.get("type") not in {None, "word"}:
            continue
        start = raw.get("start")
        end = raw.get("end")
        text = str(raw.get("word") or raw.get("text") or "").strip()
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or end <= start or not text:
            continue
        normalized.append(
            {
                "id": len(normalized),
                "start": round(float(start) + offset, 3),
                "end": round(float(end) + offset, 3),
                "word": text,
            }
        )
    if not normalized:
        raise ValueError("transcription produced no usable word timestamps")
    return normalized


def validate_word_timeline(words: list[dict[str, Any]]) -> None:
    previous_start = -1.0
    previous_end = -1.0
    for index, word in enumerate(words):
        start = float(word["start"])
        end = float(word["end"])
        if start < previous_start or end <= start:
            raise ValueError(f"word timeline is not monotonic at index {index}")
        if start + 0.05 < previous_end:
            raise ValueError(f"word timeline overlaps at index {index}")
        previous_start = start
        previous_end = max(previous_end, end)


def joined_word_text(words: list[dict[str, Any]]) -> str:
    text = ""
    no_space_before = set(",.!?;:%)]}，。！？、；：％）】》」』")
    no_space_after = set("([{（【《「『")
    for word in words:
        token = str(word["word"])
        if not text or token[0] in no_space_before or text[-1] in no_space_after:
            text += token
        elif re.match(r"[\u3000-\u9fff\uf900-\ufaff]", token[0]) or re.match(
            r"[\u3000-\u9fff\uf900-\ufaff]", text[-1]
        ):
            text += token
        else:
            text += f" {token}"
    return text.strip()


def transport_segments_from_words(
    words: list[dict[str, Any]], *, max_seconds: float = 8.0
) -> list[dict[str, Any]]:
    """Create viewing cues only; these are never complete-sentence boundaries."""
    if not words:
        raise ValueError("cannot create transport cues without word timestamps")
    groups: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for word in words:
        if current and (
            float(word["start"]) - float(current[-1]["end"]) >= 0.8
            or float(word["end"]) - float(current[0]["start"]) > max_seconds
        ):
            groups.append(current)
            current = []
        current.append(word)
    if current:
        groups.append(current)
    return [
        {
            "id": index,
            "start": group[0]["start"],
            "end": group[-1]["end"],
            "text": joined_word_text(group),
            "origin": "derived-window",
        }
        for index, group in enumerate(groups)
    ]


def words_from_payload(payload: dict[str, Any], *, offset: float = 0.0) -> list[dict[str, Any]]:
    raw_words = payload.get("words")
    if not isinstance(raw_words, list):
        raw_words = []
        raw_segments = payload.get("segments")
        if isinstance(raw_segments, list):
            for segment in raw_segments:
                if hasattr(segment, "model_dump"):
                    segment = segment.model_dump()
                if isinstance(segment, dict) and isinstance(segment.get("words"), list):
                    raw_words.extend(segment["words"])
    return normalize_words(raw_words, offset=offset)


def segments_to_vtt(segments: list[dict[str, Any]]) -> str:
    cues = ["WEBVTT", ""]
    for segment in segments:
        text = str(segment["text"]).replace("-->", "→").strip()
        cues.extend([f"{timestamp(segment['start'])} --> {timestamp(segment['end'])}", text, ""])
    return "\n".join(cues)


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def write_artifacts(
    output_dir: Path,
    segments: list[dict[str, Any]],
    words: list[dict[str, Any]],
    *,
    provider: str,
    model: str | None,
    language: str,
    engine_language: str | None,
    chunks: list[dict[str, Any]],
) -> None:
    identity = processor_identity(provider, model)
    duration = max(float(words[-1]["end"]), float(segments[-1]["end"]))
    payload = {
        "schemaVersion": TRANSCRIPT_SCHEMA_VERSION,
        "processor": identity,
        "language": language,
        "engineLanguage": engine_language,
        "timingUnitKind": "word",
        "durationSeconds": round(duration, 3),
        "chunks": chunks,
        "segments": segments,
        "words": words,
        "text": "\n".join(segment["text"] for segment in segments),
    }
    atomic_write(output_dir / "transcript.json", json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    atomic_write(output_dir / "transcript.vtt", segments_to_vtt(segments))
    atomic_write(output_dir / "transcript.txt", payload["text"] + "\n")


def file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def prepare_api_chunks(input_path: Path, ffmpeg: Path, chunk_dir: Path, seconds: int) -> list[Path]:
    chunk_dir.mkdir(parents=True, exist_ok=True)
    pattern = chunk_dir / "chunk-%04d.mp3"
    subprocess.run(
        [
            str(ffmpeg),
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(input_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-b:a",
            "48k",
            "-f",
            "segment",
            "-segment_time",
            str(seconds),
            "-reset_timestamps",
            "1",
            str(pattern),
        ],
        check=True,
    )
    chunks = sorted(chunk_dir.glob("chunk-*.mp3"))
    if not chunks:
        raise RuntimeError("FFmpeg produced no API upload chunks")
    oversized = [path for path in chunks if path.stat().st_size >= API_FILE_LIMIT]
    if oversized:
        raise RuntimeError(f"API chunk exceeds 25 MB: {oversized[0]}")
    return chunks


def transcribe_cloud(
    args: argparse.Namespace,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    str | None,
    str | None,
    list[dict[str, Any]],
]:
    provider = args.provider
    if provider not in CLOUD_PROVIDERS:
        raise RuntimeError(f"unsupported cloud timing provider: {provider}")
    if not args.consent_to_audio_upload:
        raise RuntimeError(
            f"{provider} requires --consent-to-audio-upload after the user authorizes audio transcription"
        )
    key_name = PROVIDER_API_KEYS[provider]
    if not os.environ.get(key_name):
        raise RuntimeError(f"{key_name} is not set in the current process environment")
    args.model = validate_model(provider, args.model)

    all_segments: list[dict[str, Any]] = []
    all_words: list[dict[str, Any]] = []
    requested_language = canonical_language_tag(args.language)
    detected_language: str | None = None if requested_language in {None, "und"} else requested_language
    model_language = provider_language_parameter(provider, requested_language)
    timeline_offset = 0.0
    cloud_root = args.output_dir / "cloud-work"
    run_manifest = cloud_root / "run.json"
    input_checksum = file_sha256(args.input)
    run_contract = {
        "schemaVersion": 1,
        "inputSha256": input_checksum,
        "provider": provider,
        "service": processor_identity(provider, args.model)["service"],
        "model": args.model,
        "requestedLanguage": requested_language,
        "chunkSeconds": args.chunk_seconds,
    }
    reusable = False
    if run_manifest.is_file():
        try:
            reusable = json.loads(run_manifest.read_text(encoding="utf-8")) == run_contract
        except (OSError, json.JSONDecodeError):
            reusable = False
    if not reusable and cloud_root.exists():
        if cloud_root.is_symlink():
            raise RuntimeError("refusing a symlinked cloud transcription work directory")
        shutil.rmtree(cloud_root)
    chunk_dir = cloud_root / "chunks"
    result_dir = cloud_root / "results"
    chunks = sorted(chunk_dir.glob("chunk-*.mp3")) if reusable else []
    if not chunks:
        chunks = prepare_api_chunks(args.input, args.ffmpeg, chunk_dir, args.chunk_seconds)
        atomic_write(run_manifest, json.dumps(run_contract, ensure_ascii=False, indent=2) + "\n")
    result_dir.mkdir(parents=True, exist_ok=True)
    chunk_records: list[dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        result_path = result_dir / f"chunk-{index:04d}.json"
        if reusable and result_path.is_file() and not result_path.is_symlink():
            payload = json.loads(result_path.read_text(encoding="utf-8"))
        else:
            payload = transcribe_chunk(
                provider,
                chunk,
                model=args.model,
                language=model_language,
            )
            safe_payload = {
                "text": payload.get("text"),
                "language": payload.get("language"),
                "language_code": payload.get("language_code"),
                "duration": payload.get("duration"),
                "segments": payload.get("segments"),
                "words": payload.get("words"),
            }
            atomic_write(result_path, json.dumps(safe_payload, ensure_ascii=False, indent=2) + "\n")
            payload = safe_payload
        response_language = detected_language_from_payload(provider, payload)
        if response_language:
            if detected_language is None:
                detected_language = response_language
            elif engine_language_code(response_language) != engine_language_code(detected_language):
                raise RuntimeError(f"{provider} chunks returned inconsistent detected languages")
        words = words_from_payload(payload, offset=timeline_offset)
        raw_segments = payload.get("segments")
        if isinstance(raw_segments, list) and raw_segments:
            segments = normalize_segments(raw_segments, offset=timeline_offset)
            for segment in segments:
                segment["origin"] = "provider"
        else:
            segments = transport_segments_from_words(words)
        for segment in segments:
            segment["id"] = len(all_segments)
            all_segments.append(segment)
        for word in words:
            word["id"] = len(all_words)
            all_words.append(word)
        chunk_duration = payload.get("duration")
        if not isinstance(chunk_duration, (int, float)) or chunk_duration <= 0:
            chunk_duration = max(float(word["end"]) - timeline_offset for word in words)
        chunk_records.append(
            {
                "index": index,
                "startSeconds": round(timeline_offset, 3),
                "endSeconds": round(timeline_offset + float(chunk_duration), 3),
                "sha256": file_sha256(chunk),
            }
        )
        timeline_offset += float(chunk_duration)
    detected_engine_language = (
        provider_language_parameter(provider, detected_language)
        if detected_language
        else None
    )
    return (
        all_segments,
        all_words,
        detected_language,
        model_language or detected_engine_language,
        chunk_records,
    )


def transcribe_local(
    args: argparse.Namespace,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    str | None,
    str | None,
    list[dict[str, Any]],
]:
    if not args.whisper_cli or not args.whisper_cli.is_file():
        raise RuntimeError("--whisper-cli must point to the workflow-local Whisper executable")
    raw_dir = args.output_dir / "local-raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    command = [
        str(args.whisper_cli),
        str(args.input),
        "--model",
        args.model,
        "--output_dir",
        str(raw_dir),
        "--output_format",
        "all",
        "--device",
        args.device,
        "--fp16",
        "True" if args.device == "cuda" else "False",
        "--verbose",
        "False",
        "--word_timestamps",
        "True",
    ]
    if args.model_dir:
        command.extend(["--model_dir", str(args.model_dir)])
    requested_language = canonical_language_tag(args.language)
    model_language = engine_language_code(requested_language)
    if model_language:
        command.extend(["--language", model_language])
    environment = os.environ.copy()
    if args.ffmpeg:
        environment["PATH"] = f"{args.ffmpeg.parent}{os.pathsep}{environment.get('PATH', '')}"
    subprocess.run(command, check=True, env=environment)

    json_files = sorted(raw_dir.glob("*.json"))
    if not json_files:
        raise RuntimeError("local Whisper did not produce transcript JSON")
    payload = json.loads(json_files[0].read_text(encoding="utf-8"))
    segments = normalize_segments(payload.get("segments"))
    words = words_from_payload(payload)
    language = None if requested_language in {None, "und"} else requested_language
    if language is None and payload.get("language"):
        language = canonical_language_tag(str(payload["language"]))
    engine_language = model_language or (
        engine_language_code(language) if language else None
    )
    return (
        segments,
        words,
        language,
        engine_language,
        [
            {
                "index": 0,
                "startSeconds": 0.0,
                "endSeconds": round(float(words[-1]["end"]), 3),
                "sha256": file_sha256(args.input),
            }
        ],
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--provider", choices=("local", *CLOUD_PROVIDERS), required=True
    )
    parser.add_argument("--model")
    parser.add_argument("--language")
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--ffmpeg", type=Path)
    parser.add_argument("--whisper-cli", type=Path)
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--chunk-seconds", type=int, default=DEFAULT_CHUNK_SECONDS)
    parser.add_argument("--consent-to-audio-upload", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    args.input = args.input.resolve()
    args.output_dir = args.output_dir.resolve()
    if not args.input.is_file():
        raise SystemExit(f"input file not found: {args.input}")
    if args.chunk_seconds < 60 or args.chunk_seconds > 1200:
        raise SystemExit("chunk seconds must be between 60 and 1200")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    try:
        args.language = canonical_language_tag(args.language)
        provider_language_parameter(args.provider, args.language)
    except ValueError as error:
        raise SystemExit(str(error)) from error

    if args.provider == "xai":
        if args.model:
            raise SystemExit("xAI /v1/stt does not accept --model")
    elif not args.model:
        raise SystemExit(f"{args.provider} requires --model")
    try:
        args.model = validate_model(args.provider, args.model)
    except ValueError as error:
        raise SystemExit(str(error)) from error

    if args.provider in CLOUD_PROVIDERS:
        if not args.ffmpeg or not args.ffmpeg.is_file():
            raise SystemExit(f"{args.provider} requires --ffmpeg for bounded audio chunks")
        segments, words, language, engine_language, chunks = transcribe_cloud(args)
    else:
        segments, words, language, engine_language, chunks = transcribe_local(args)

    if not language or language == "und":
        raise SystemExit("transcription model did not return a supported detected language")
    validate_word_timeline(words)

    write_artifacts(
        args.output_dir,
        segments,
        words,
        provider=args.provider,
        model=args.model,
        language=language,
        engine_language=engine_language,
        chunks=chunks,
    )
    print(f"transcript: {args.output_dir / 'transcript.vtt'}")
    print(f"provider: {args.provider}")
    print(f"service: {processor_identity(args.provider, args.model)['service']}")
    print(f"model: {args.model or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
