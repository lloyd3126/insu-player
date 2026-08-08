#!/usr/bin/env python3
"""Create timestamped transcript artifacts with local Whisper or OpenAI."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


API_FILE_LIMIT = 25 * 1024 * 1024
DEFAULT_CHUNK_SECONDS = 600


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


def segments_to_vtt(segments: list[dict[str, Any]]) -> str:
    cues = ["WEBVTT", ""]
    for segment in segments:
        text = str(segment["text"]).replace("-->", "→").strip()
        cues.extend([f"{timestamp(segment['start'])} --> {timestamp(segment['end'])}", text, ""])
    return "\n".join(cues)


def response_to_dict(response: object) -> dict[str, Any]:
    if hasattr(response, "model_dump"):
        payload = response.model_dump()
    elif isinstance(response, dict):
        payload = response
    else:
        payload = {
            "text": getattr(response, "text", ""),
            "segments": getattr(response, "segments", None),
            "language": getattr(response, "language", None),
            "duration": getattr(response, "duration", None),
        }
    if not isinstance(payload, dict):
        raise ValueError("unexpected transcription response")
    return payload


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
    *,
    provider: str,
    model: str,
    language: str | None,
    chunks: int,
) -> None:
    payload = {
        "schemaVersion": 1,
        "provider": provider,
        "model": model,
        "language": language,
        "chunks": chunks,
        "segments": segments,
        "text": "\n".join(segment["text"] for segment in segments),
    }
    atomic_write(output_dir / "transcript.json", json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    atomic_write(output_dir / "transcript.vtt", segments_to_vtt(segments))
    atomic_write(output_dir / "transcript.txt", payload["text"] + "\n")


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


def transcribe_openai(args: argparse.Namespace) -> tuple[list[dict[str, Any]], str | None, int]:
    if not args.consent_to_upload:
        raise RuntimeError("OpenAI provider requires --consent-to-upload after the user authorizes external upload")
    if not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set in the current process environment")
    if args.model != "whisper-1":
        raise RuntimeError("timestamped VTT output currently requires the OpenAI model whisper-1")
    try:
        from openai import OpenAI
    except ImportError as error:
        raise RuntimeError("OpenAI SDK is not installed in this Python environment") from error

    all_segments: list[dict[str, Any]] = []
    detected_language: str | None = args.language
    timeline_offset = 0.0
    client = OpenAI()
    with tempfile.TemporaryDirectory(prefix="transcribe-api-", dir=args.output_dir) as temporary:
        chunks = prepare_api_chunks(args.input, args.ffmpeg, Path(temporary), args.chunk_seconds)
        for chunk in chunks:
            request: dict[str, Any] = {
                "model": args.model,
                "response_format": "verbose_json",
                "timestamp_granularities": ["segment"],
            }
            if args.language:
                request["language"] = args.language
            with chunk.open("rb") as audio:
                response = client.audio.transcriptions.create(file=audio, **request)
            payload = response_to_dict(response)
            if not detected_language and payload.get("language"):
                detected_language = str(payload["language"])
            segments = normalize_segments(payload.get("segments"), offset=timeline_offset)
            for segment in segments:
                segment["id"] = len(all_segments)
                all_segments.append(segment)
            chunk_duration = payload.get("duration")
            if isinstance(chunk_duration, (int, float)) and chunk_duration > 0:
                timeline_offset += float(chunk_duration)
            else:
                timeline_offset += args.chunk_seconds
    return all_segments, detected_language, len(chunks)


def transcribe_local(args: argparse.Namespace) -> tuple[list[dict[str, Any]], str | None, int]:
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
    ]
    if args.model_dir:
        command.extend(["--model_dir", str(args.model_dir)])
    if args.language:
        command.extend(["--language", args.language])
    environment = os.environ.copy()
    if args.ffmpeg:
        environment["PATH"] = f"{args.ffmpeg.parent}{os.pathsep}{environment.get('PATH', '')}"
    subprocess.run(command, check=True, env=environment)

    json_files = sorted(raw_dir.glob("*.json"))
    if not json_files:
        raise RuntimeError("local Whisper did not produce transcript JSON")
    payload = json.loads(json_files[0].read_text(encoding="utf-8"))
    segments = normalize_segments(payload.get("segments"))
    language = args.language or (str(payload["language"]) if payload.get("language") else None)
    return segments, language, 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--provider", choices=("local", "openai"), default="local")
    parser.add_argument("--model")
    parser.add_argument("--language")
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--ffmpeg", type=Path)
    parser.add_argument("--whisper-cli", type=Path)
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--chunk-seconds", type=int, default=DEFAULT_CHUNK_SECONDS)
    parser.add_argument("--consent-to-upload", action="store_true")
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

    if args.provider == "openai":
        if not args.ffmpeg or not args.ffmpeg.is_file():
            raise SystemExit("OpenAI provider requires --ffmpeg for bounded audio chunks")
        args.model = args.model or "whisper-1"
        segments, language, chunks = transcribe_openai(args)
    else:
        args.model = args.model or "turbo"
        segments, language, chunks = transcribe_local(args)

    write_artifacts(
        args.output_dir,
        segments,
        provider=args.provider,
        model=args.model,
        language=language,
        chunks=chunks,
    )
    print(f"transcript: {args.output_dir / 'transcript.vtt'}")
    print(f"provider: {args.provider}")
    print(f"model: {args.model}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
