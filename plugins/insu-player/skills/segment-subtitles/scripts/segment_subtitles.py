#!/usr/bin/env python3
"""Freeze output-first subtitle pieces and align them to timed source units."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 4
CONTENT_SCHEMA_VERSION = 5
LANGUAGE_PATTERN = re.compile(r"^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|und)$")
UNIT_ID_PATTERN = re.compile(r"^U[0-9]{6,}$")
SEGMENT_ID_PATTERN = re.compile(r"^S[0-9]{4,}$")
PIECE_ID_PATTERN = re.compile(r"^S[0-9]{4,}-P[0-9]{2,}$")
REMOVED_PUNCTUATION_PATTERN = re.compile(r"[,\.，。]")
FORBIDDEN_MARKER_PATTERN = re.compile(
    r"(?i)(?:_{2,}[A-Z0-9]*CUE[A-Z0-9_]*_{0,}|XQZCUE[A-Z0-9]*)"
)
PROFILE_DEFAULTS = {
    "spacing": {"fitUnits": 42, "hardUnits": 56, "maxReadingUnitsPerSecond": 20.0},
    "cjk": {"fitUnits": 40, "hardUnits": 56, "maxReadingUnitsPerSecond": 20.0},
    "rtl": {"fitUnits": 42, "hardUnits": 56, "maxReadingUnitsPerSecond": 20.0},
    "complex-no-space": {"fitUnits": 42, "hardUnits": 56, "maxReadingUnitsPerSecond": 20.0},
}


class PlanError(ValueError):
    """A deterministic segmentation contract violation."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise PlanError(f"output path must not be a symlink: {path}")
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
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise PlanError(f"output path must not be a symlink: {path}")
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
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise PlanError(f"invalid {label}: {path}") from error
    if not isinstance(payload, dict):
        raise PlanError(f"{label} must be an object")
    return payload


def validate_language(value: object, label: str) -> str:
    if not isinstance(value, str) or not LANGUAGE_PATTERN.fullmatch(value):
        raise PlanError(f"{label} must be a BCP 47 language code")
    return value


def require_text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PlanError(f"{label} must contain text")
    if FORBIDDEN_MARKER_PATTERN.search(value):
        raise PlanError(f"{label} contains an internal cue marker")
    if re.fullmatch(r"S\d{4}(?:-P\d{2})?", value.strip()):
        raise PlanError(f"{label} uses an internal segmentation ID as visible subtitle text")
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
        raise PlanError(f"{label} must be an object")
    unknown = set(value) - {"provider", "service", "model", "updatedAt"}
    if unknown:
        raise PlanError(f"{label} contains unsupported fields: {sorted(unknown)}")
    provider = value.get("provider")
    allowed = set(TIMING_PROCESSOR_CONTRACTS) if timing_only else {"agent"}
    if provider not in allowed:
        raise PlanError(f"{label}.provider is unsupported")
    service = value.get("service")
    model = value.get("model")
    if provider in TIMING_PROCESSOR_CONTRACTS:
        expected_service, allowed_models = TIMING_PROCESSOR_CONTRACTS[provider]
        if service != expected_service:
            raise PlanError(f"{label} must use {provider} / {expected_service}")
        if allowed_models is not None and model not in allowed_models:
            raise PlanError(f"{label}.model is unsupported")
        if allowed_models is None:
            require_text(model, f"{label}.model")
            pattern = (
                r"^[A-Za-z0-9._-]+/[A-Za-z0-9._/-]+$"
                if provider == "openrouter"
                else r"^[A-Za-z0-9._-]+$"
            )
            if not re.fullmatch(pattern, str(model)):
                raise PlanError(f"{label}.model is invalid")
    if provider == "agent":
        if service != "codex" or model is not None:
            raise PlanError(f"{label} must use agent / codex")
    for field_value, field_name in ((service, "service"), (model, "model")):
        if field_value is not None and not isinstance(field_value, str):
            raise PlanError(f"{label}.{field_name} must be text")
    identity = {"provider": provider, "service": service, "model": model}
    if provider == "agent":
        identity.pop("model")
    if value.get("updatedAt") is not None:
        identity["updatedAt"] = str(value["updatedAt"])
    return identity


def timed_units(transcript: dict[str, Any]) -> list[dict[str, Any]]:
    raw_units = transcript.get("words")
    if not isinstance(raw_units, list):
        raise PlanError("source transcript has no word or token timestamps")
    units: list[dict[str, Any]] = []
    for raw_unit in raw_units:
        if not isinstance(raw_unit, dict):
            continue
        text = raw_unit.get("word") or raw_unit.get("text")
        start = raw_unit.get("start")
        end = raw_unit.get("end")
        if not isinstance(text, str) or not text.strip():
            continue
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or end <= start:
            continue
        raw_identifier = raw_unit.get("id")
        if isinstance(raw_identifier, int) and raw_identifier >= 0:
            identifier = f"U{raw_identifier + 1:06d}"
        elif isinstance(raw_identifier, str) and UNIT_ID_PATTERN.fullmatch(raw_identifier):
            identifier = raw_identifier
        else:
            identifier = f"U{len(units) + 1:06d}"
        raw_kind = raw_unit.get("kind")
        kind = raw_kind if raw_kind in {"word", "token", "grapheme-group"} else "word"
        units.append(
            {
                "id": identifier,
                "text": text.strip(),
                "start": round(float(start), 3),
                "end": round(float(end), 3),
                "kind": kind,
            }
        )
    identifiers = [unit["id"] for unit in units]
    if not units:
        raise PlanError("source transcript contains no usable timed units")
    if len(set(identifiers)) != len(identifiers):
        raise PlanError("source timed unit IDs are not unique")
    for previous, current in zip(units, units[1:]):
        if float(current["start"]) < float(previous["start"]):
            raise PlanError("source timed units are not ordered")
    return units


def language_profile(language: str) -> str:
    primary = language.split("-", 1)[0].lower()
    if primary in {"zh", "ja", "ko"}:
        return "cjk"
    if primary in {"ar", "fa", "he", "ur"}:
        return "rtl"
    if primary in {"th", "km", "lo", "my"}:
        return "complex-no-space"
    return "spacing"


def compact_text(value: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFC", value))


def display_units(value: str) -> int:
    width = 0
    join_next = False
    for character in unicodedata.normalize("NFC", value):
        codepoint = ord(character)
        if character == "\u200d":
            join_next = True
            continue
        if unicodedata.combining(character) or 0xFE00 <= codepoint <= 0xFE0F:
            continue
        character_width = 2 if unicodedata.east_asian_width(character) in {"W", "F"} else 1
        if join_next:
            join_next = False
            continue
        width += character_width
    return width


def target_fingerprint(plan: dict[str, Any]) -> str:
    snapshot: list[dict[str, Any]] = []
    for unit in plan.get("contentUnits", []):
        if not isinstance(unit, dict):
            continue
        snapshot.append(
            {
                "id": unit.get("id"),
                "outputFullText": unit.get("outputFullText"),
                "pieces": [
                    {"id": piece.get("id"), "outputText": piece.get("outputText")}
                    for piece in unit.get("pieces", [])
                    if isinstance(piece, dict)
                ],
            }
        )
    encoded = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def alignment_fingerprint(plan: dict[str, Any]) -> str:
    content_units: list[dict[str, Any]] = []
    for unit in plan.get("contentUnits", []):
        if not isinstance(unit, dict):
            continue
        content_units.append(
            {
                "id": unit.get("id"),
                "anchors": unit.get("anchors"),
                "pieces": [
                    {"id": piece.get("id"), "sourceSpan": piece.get("sourceSpan")}
                    for piece in unit.get("pieces", [])
                    if isinstance(piece, dict)
                ],
            }
        )
    encoded = json.dumps(
        {
            "boundaryHints": plan.get("boundaryHints"),
            "contentUnits": content_units,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def agent_review(value: object, label: str) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != {"provider", "service", "reviewedAt"}:
        raise PlanError(f"{label} fields do not match the current contract")
    if value.get("provider") != "agent" or value.get("service") != "codex":
        raise PlanError(f"{label} must use agent / codex")
    reviewed_at = value.get("reviewedAt")
    if not isinstance(reviewed_at, str) or not reviewed_at.endswith("Z"):
        raise PlanError(f"{label}.reviewedAt is invalid")
    return {"provider": "agent", "service": "codex", "reviewedAt": reviewed_at}


def normalize_required_terms(raw_terms: object, label: str) -> list[str]:
    if raw_terms is None:
        return []
    if not isinstance(raw_terms, list):
        raise PlanError(f"{label} must be a list")
    terms: list[str] = []
    for index, raw_term in enumerate(raw_terms, start=1):
        if isinstance(raw_term, str):
            term = require_text(raw_term, f"{label}[{index}]")
        elif isinstance(raw_term, dict):
            term = require_text(raw_term.get("target") or raw_term.get("text"), f"{label}[{index}]")
        else:
            raise PlanError(f"{label}[{index}] must be text or an object")
        terms.append(term)
    return terms


def prepare(args: argparse.Namespace) -> int:
    content = load_json(args.content_manifest, "content manifest")
    if content.get("schemaVersion") != CONTENT_SCHEMA_VERSION:
        raise PlanError("segment-subtitles requires a schemaVersion 5 content manifest")
    mode = content.get("mode")
    if mode not in {"proofread", "translate"}:
        raise PlanError("content manifest mode must be proofread or translate")
    source_language = validate_language(content.get("sourceLanguage"), "sourceLanguage")
    output_language = validate_language(content.get("outputLanguage"), "outputLanguage")
    if mode == "proofread" and source_language != output_language:
        raise PlanError("proofread content must preserve the source language")
    if mode == "translate" and source_language == output_language:
        raise PlanError("translated content requires a different output language")
    if "contentModel" in content or "transcriptionModel" in content:
        raise PlanError("content manifest contains removed model fields")
    timing_processor = processor_identity(
        content.get("timingProcessor"),
        "timingProcessor",
        timing_only=True,
    )
    content_processor = processor_identity(
        content.get("contentProcessor"),
        "contentProcessor",
    )
    sentence_review = agent_review(content.get("sentenceReview"), "sentenceReview")
    source_content_artifact = content.get("sourceContentArtifactId")
    source_content_kind = content.get("sourceContentKind")
    timing_source_artifact = content.get("timingSourceArtifactId")
    if not isinstance(timing_source_artifact, str) or not timing_source_artifact:
        raise PlanError("content manifest has no timing source artifact")
    if not isinstance(source_content_artifact, str) or not source_content_artifact:
        raise PlanError("content manifest has no content source artifact")
    if source_content_kind not in {"model-transcript", "proofread"}:
        raise PlanError("content manifest has an invalid content source kind")
    if mode == "proofread" and source_content_kind != "model-transcript":
        raise PlanError("proofread content must come from the model transcript")
    if (
        source_content_kind == "model-transcript"
        and source_content_artifact != timing_source_artifact
    ):
        raise PlanError("model transcript content and timing sources must match")
    if source_content_kind == "proofread":
        if mode != "translate":
            raise PlanError("only translation accepts proofread content")
        source_manifest = content.get("sourceContentManifest")
        source_checksum = content.get("sourceContentChecksum")
        if not isinstance(source_manifest, str) or not source_manifest:
            raise PlanError("proofread content source manifest is missing")
        if not isinstance(source_checksum, str) or not re.fullmatch(
            r"[0-9a-f]{64}", source_checksum
        ):
            raise PlanError("proofread content source checksum is invalid")
        try:
            actual_source_checksum = hashlib.sha256(
                Path(source_manifest).read_bytes()
            ).hexdigest()
        except OSError as error:
            raise PlanError("proofread content source manifest is unavailable") from error
        if actual_source_checksum != source_checksum:
            raise PlanError("proofread content source checksum changed")
    transcript = load_json(args.source_transcript, "source transcript")
    expected_transcript_fields = {
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
    if transcript.get("schemaVersion") != 3 or set(transcript) != expected_transcript_fields:
        raise PlanError("source transcript must use the exact schemaVersion 3 contract")
    transcript_processor = processor_identity(
        transcript.get("processor"),
        "source transcript processor",
        timing_only=True,
    )
    if transcript_processor != timing_processor:
        raise PlanError("source transcript processor does not match the content timing processor")
    if transcript.get("language") != source_language or transcript.get("timingUnitKind") != "word":
        raise PlanError("source transcript language or timing unit does not match the content manifest")
    units = timed_units(transcript)
    unit_positions = {str(unit["id"]): index for index, unit in enumerate(units)}
    raw_segments = content.get("segments")
    if not isinstance(raw_segments, list) or not raw_segments:
        raise PlanError("content manifest has no complete-sentence units")

    content_units: list[dict[str, Any]] = []
    expected_content_start = 0
    for raw_segment in raw_segments:
        if not isinstance(raw_segment, dict):
            raise PlanError("content segment must be an object")
        identifier = raw_segment.get("id")
        if not isinstance(identifier, str) or not SEGMENT_ID_PATTERN.fullmatch(identifier):
            raise PlanError("content segment has an invalid ID")
        source_start = raw_segment.get("sourceUnitStart")
        source_end = raw_segment.get("sourceUnitEnd")
        if source_start not in unit_positions or source_end not in unit_positions:
            raise PlanError(f"{identifier} references an unknown timed unit")
        start_position = unit_positions[str(source_start)]
        end_position = unit_positions[str(source_end)]
        if start_position != expected_content_start or start_position > end_position:
            raise PlanError(f"{identifier} source timed unit range is reversed")
        unit_count = end_position - start_position + 1
        duration = float(units[end_position]["end"]) - float(units[start_position]["start"])
        if unit_count > 160 or duration > 60:
            raise PlanError(
                f"SOURCE_SENTENCE_IMPLAUSIBLE: {identifier} spans {unit_count} units and {round(duration, 3)} seconds"
            )
        expected_content_start = end_position + 1
        source_text = require_text(raw_segment.get("sourceText"), f"{identifier}.sourceText")
        output_text = require_text(raw_segment.get("outputText"), f"{identifier}.outputText")
        required_terms = normalize_required_terms(raw_segment.get("requiredTerms"), f"{identifier}.requiredTerms")
        content_units.append(
            {
                "id": identifier,
                "sourceUnitStart": source_start,
                "sourceUnitEnd": source_end,
                "sourceText": source_text,
                "outputFullText": output_text,
                "requiredTerms": required_terms,
                "anchors": [],
                "pieces": [
                    {
                        "id": f"{identifier}-P01",
                        "outputText": output_text,
                        "sourceSpan": None,
                        "allowShortTiming": False,
                    }
                ],
            }
        )

    if expected_content_start != len(units):
        raise PlanError("content sentences do not cover every timed source unit")

    profile_name = args.width_profile or language_profile(output_language)
    if profile_name not in PROFILE_DEFAULTS:
        raise PlanError(f"unsupported width profile: {profile_name}")
    profile = dict(PROFILE_DEFAULTS[profile_name])
    if args.fit_units is not None:
        profile["fitUnits"] = args.fit_units
    if args.hard_units is not None:
        profile["hardUnits"] = args.hard_units
    if int(profile["fitUnits"]) <= 0 or int(profile["hardUnits"]) <= int(profile["fitUnits"]):
        raise PlanError("hardUnits must be greater than fitUnits")
    output_profile = content.get("outputProfile")
    punctuation_policy = "preserve"
    if isinstance(output_profile, dict):
        punctuation_policy = str(output_profile.get("punctuationPolicy", "preserve"))

    plan: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "contentMode": mode,
        "sourceLanguage": source_language,
        "outputLanguage": output_language,
        "sourceTranscript": str(args.source_transcript),
        "contentManifest": str(args.content_manifest),
        "sourceContentArtifactId": source_content_artifact,
        "sourceContentKind": source_content_kind,
        "timingProcessor": timing_processor,
        "contentProcessor": content_processor,
        "sentenceReview": sentence_review,
        "segmentationProcessor": None,
        "alignmentMethod": None,
        "alignmentReview": None,
        "alignmentFingerprint": None,
        "targetRevision": 1,
        "targetFrozen": False,
        "targetFingerprint": None,
        "widthProfile": {"name": profile_name, **profile},
        "timingProfile": {"minimumPieceMilliseconds": 800},
        "outputProfile": {"punctuationPolicy": punctuation_policy},
        "timedUnits": units,
        "boundaryHints": [],
        "contentUnits": content_units,
    }
    atomic_write_json(args.output, plan)
    print(f"Prepared {len(content_units)} target-first content units: {args.output}")
    return 0


def validate_target_structure(plan: dict[str, Any]) -> None:
    if plan.get("schemaVersion") != SCHEMA_VERSION:
        raise PlanError("unsupported segmentation plan")
    if "languageModel" in plan:
        raise PlanError("segmentation plan contains removed languageModel")
    processor_identity(
        plan.get("timingProcessor"),
        "timingProcessor",
        timing_only=True,
    )
    processor_identity(plan.get("contentProcessor"), "contentProcessor")
    agent_review(plan.get("sentenceReview"), "sentenceReview")
    processor_identity(
        plan.get("segmentationProcessor"),
        "segmentationProcessor",
    )
    validate_language(plan.get("sourceLanguage"), "sourceLanguage")
    validate_language(plan.get("outputLanguage"), "outputLanguage")
    raw_units = plan.get("contentUnits")
    if not isinstance(raw_units, list) or not raw_units:
        raise PlanError("segmentation plan has no content units")
    seen_piece_ids: set[str] = set()
    for raw_unit in raw_units:
        if not isinstance(raw_unit, dict):
            raise PlanError("content unit must be an object")
        identifier = raw_unit.get("id")
        if not isinstance(identifier, str) or not SEGMENT_ID_PATTERN.fullmatch(identifier):
            raise PlanError("content unit has an invalid ID")
        output_full_text = require_text(raw_unit.get("outputFullText"), f"{identifier}.outputFullText")
        raw_pieces = raw_unit.get("pieces")
        if not isinstance(raw_pieces, list) or not raw_pieces:
            raise PlanError(f"{identifier} has no target pieces")
        piece_texts: list[str] = []
        for raw_piece in raw_pieces:
            if not isinstance(raw_piece, dict):
                raise PlanError(f"{identifier} contains an invalid piece")
            piece_id = raw_piece.get("id")
            if not isinstance(piece_id, str) or not PIECE_ID_PATTERN.fullmatch(piece_id):
                raise PlanError(f"{identifier} contains an invalid piece ID")
            if piece_id in seen_piece_ids:
                raise PlanError(f"duplicate target piece ID: {piece_id}")
            seen_piece_ids.add(piece_id)
            piece_texts.append(require_text(raw_piece.get("outputText"), f"{piece_id}.outputText"))
        if compact_text("".join(piece_texts)) != compact_text(output_full_text):
            raise PlanError(f"{identifier} output pieces change the complete content revision")
        for term in normalize_required_terms(raw_unit.get("requiredTerms"), f"{identifier}.requiredTerms"):
            if term in output_full_text and not any(term in piece for piece in piece_texts):
                raise PlanError(f"{identifier} splits required output term: {term}")


def freeze_target(args: argparse.Namespace) -> int:
    plan = load_json(args.plan, "segmentation plan")
    validate_target_structure(plan)
    fingerprint = target_fingerprint(plan)
    if plan.get("targetFrozen"):
        if plan.get("targetFingerprint") != fingerprint:
            raise PlanError("frozen target pieces were modified; create a new target revision")
        print(f"Target revision {plan.get('targetRevision')} is already frozen.")
        return 0
    plan["targetFrozen"] = True
    plan["targetFingerprint"] = fingerprint
    plan["targetFrozenAt"] = utc_now()
    atomic_write_json(args.plan, plan)
    print(f"Frozen target revision {plan.get('targetRevision')} with fingerprint {fingerprint}.")
    return 0


def record_segmentation_processor(args: argparse.Namespace) -> int:
    plan = load_json(args.plan, "segmentation plan")
    if plan.get("schemaVersion") != SCHEMA_VERSION:
        raise PlanError(
            f"segmentation processor requires a schemaVersion {SCHEMA_VERSION} plan"
        )
    metadata: dict[str, str] = {
        "provider": "agent",
        "service": "codex",
        "updatedAt": utc_now(),
    }
    plan["segmentationProcessor"] = processor_identity(
        metadata,
        "segmentationProcessor",
    )
    atomic_write_json(args.plan, plan)
    print(f"Recorded agent segmentation processor codex: {args.plan}")
    return 0


def revise_target(args: argparse.Namespace) -> int:
    plan = load_json(args.plan, "segmentation plan")
    validate_target_structure(plan)
    revision = plan.get("targetRevision")
    if not isinstance(revision, int) or revision < 1:
        raise PlanError("targetRevision must be a positive integer")
    plan["targetRevision"] = revision + 1
    plan["targetFrozen"] = False
    plan["targetFingerprint"] = None
    plan.pop("targetFrozenAt", None)
    plan["alignmentMethod"] = None
    plan["alignmentReview"] = None
    plan["alignmentFingerprint"] = None
    for unit in plan["contentUnits"]:
        unit["anchors"] = []
        for piece in unit["pieces"]:
            piece["sourceSpan"] = None
    atomic_write_json(args.plan, plan)
    print(f"Opened target revision {revision + 1}; source alignment was cleared.")
    return 0


def record_alignment_review(args: argparse.Namespace) -> int:
    plan = load_json(args.plan, "segmentation plan")
    validate_alignment(plan, require_review=False)
    plan["alignmentMethod"] = "agent-semantic"
    plan["alignmentReview"] = {
        "provider": "agent",
        "service": "codex",
        "reviewedAt": utc_now(),
    }
    plan["alignmentFingerprint"] = alignment_fingerprint(plan)
    atomic_write_json(args.plan, plan)
    print(f"Recorded Agent semantic Source Alignment review: {args.plan}")
    return 0


def validate_alignment(
    plan: dict[str, Any],
    *,
    require_review: bool = True,
) -> list[dict[str, Any]]:
    if plan.get("targetFrozen") is not True:
        raise PlanError("target pieces must be frozen before source alignment")
    if plan.get("targetFingerprint") != target_fingerprint(plan):
        raise PlanError("frozen target pieces were modified")
    validate_target_structure(plan)
    if require_review:
        if plan.get("alignmentMethod") != "agent-semantic":
            raise PlanError("Source Alignment must use agent-semantic review")
        agent_review(plan.get("alignmentReview"), "alignmentReview")
        if plan.get("alignmentFingerprint") != alignment_fingerprint(plan):
            raise PlanError("Source Alignment changed after Agent semantic review")

    raw_timed_units = plan.get("timedUnits")
    if not isinstance(raw_timed_units, list) or not raw_timed_units:
        raise PlanError("segmentation plan has no timed source units")
    timed_units_by_id: dict[str, dict[str, Any]] = {}
    unit_order: list[str] = []
    for raw_unit in raw_timed_units:
        if not isinstance(raw_unit, dict):
            raise PlanError("timed source unit must be an object")
        identifier = raw_unit.get("id")
        if not isinstance(identifier, str) or not UNIT_ID_PATTERN.fullmatch(identifier):
            raise PlanError("timed source unit has an invalid ID")
        if identifier in timed_units_by_id:
            raise PlanError(f"duplicate timed source unit: {identifier}")
        require_text(raw_unit.get("text"), f"{identifier}.text")
        start = raw_unit.get("start")
        end = raw_unit.get("end")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or end <= start:
            raise PlanError(f"{identifier} has invalid timing")
        timed_units_by_id[identifier] = raw_unit
        unit_order.append(identifier)
    unit_position = {identifier: index for index, identifier in enumerate(unit_order)}

    raw_hints = plan.get("boundaryHints", [])
    if not isinstance(raw_hints, list):
        raise PlanError("boundaryHints must be a list")
    hints: dict[str, dict[str, Any]] = {}
    for hint in raw_hints:
        if not isinstance(hint, dict):
            raise PlanError("boundary hint must be an object")
        after_unit = hint.get("afterUnitId")
        state = hint.get("state")
        if after_unit not in unit_position or state not in {"safe", "risky", "blocked"}:
            raise PlanError("boundary hint has an invalid unit or state")
        hints[str(after_unit)] = hint

    width_profile = plan.get("widthProfile")
    if not isinstance(width_profile, dict):
        raise PlanError("widthProfile is missing")
    fit_units = width_profile.get("fitUnits")
    hard_units = width_profile.get("hardUnits")
    max_reading = width_profile.get("maxReadingUnitsPerSecond")
    if not isinstance(fit_units, int) or not isinstance(hard_units, int) or hard_units <= fit_units:
        raise PlanError("widthProfile limits are invalid")
    if not isinstance(max_reading, (int, float)) or max_reading <= 0:
        raise PlanError("maxReadingUnitsPerSecond is invalid")
    timing_profile = plan.get("timingProfile")
    minimum_ms = 800
    if isinstance(timing_profile, dict) and isinstance(timing_profile.get("minimumPieceMilliseconds"), int):
        minimum_ms = int(timing_profile["minimumPieceMilliseconds"])

    warnings: list[dict[str, Any]] = []
    for unit in plan["contentUnits"]:
        identifier = str(unit["id"])
        unit_start = unit.get("sourceUnitStart")
        unit_end = unit.get("sourceUnitEnd")
        if unit_start not in unit_position or unit_end not in unit_position:
            raise PlanError(f"{identifier} references an unknown source range")
        pieces = unit["pieces"]
        previous_end_position: int | None = None
        for piece_index, piece in enumerate(pieces):
            piece_id = str(piece["id"])
            span = piece.get("sourceSpan")
            if not isinstance(span, dict):
                raise PlanError(f"{piece_id} has no sourceSpan")
            span_start = span.get("startUnitId")
            span_end = span.get("endUnitId")
            if span_start not in unit_position or span_end not in unit_position:
                raise PlanError(f"{piece_id} references an unknown source timed unit")
            start_position = unit_position[str(span_start)]
            end_position = unit_position[str(span_end)]
            if end_position < start_position:
                raise PlanError(f"{piece_id} sourceSpan is reversed")
            expected_start = unit_position[str(unit_start)] if piece_index == 0 else int(previous_end_position) + 1
            if start_position != expected_start:
                raise PlanError(f"{piece_id} sourceSpan leaves a gap or overlaps another piece")
            previous_end_position = end_position
            output_text = str(piece["outputText"]).strip()
            if not output_text:
                raise PlanError(f"{piece_id} has empty outputText")
            if output_text == piece_id or re.fullmatch(r"S\d{4}(?:-P\d{2})?", output_text):
                raise PlanError(
                    f"{piece_id} uses an internal segmentation ID as visible subtitle text"
                )
            if piece_index < len(pieces) - 1:
                hint = hints.get(str(span_end))
                if hint and hint.get("state") in {"risky", "blocked"}:
                    raise PlanError(
                        f"{piece_id} uses a {hint.get('state')} source boundary after {span_end}"
                    )
            text_width = display_units(output_text)
            if text_width > hard_units:
                raise PlanError(f"{piece_id} exceeds hard width: {text_width} > {hard_units}")
            if text_width > fit_units:
                warnings.append({"code": "TARGET_OVER_FIT", "pieceId": piece_id, "value": text_width})
            start_seconds = float(timed_units_by_id[str(span_start)]["start"])
            end_seconds = float(timed_units_by_id[str(span_end)]["end"])
            duration = end_seconds - start_seconds
            if duration <= 0:
                raise PlanError(f"{piece_id} has invalid derived timing")
            if duration * 1000 < minimum_ms and not bool(piece.get("allowShortTiming")):
                warnings.append({"code": "FLASH_FRAGMENT", "pieceId": piece_id, "milliseconds": round(duration * 1000)})
            reading_rate = text_width / duration
            if reading_rate > float(max_reading):
                warnings.append(
                    {"code": "READING_RATE_HIGH", "pieceId": piece_id, "unitsPerSecond": round(reading_rate, 2)}
                )
        if previous_end_position != unit_position[str(unit_end)]:
            raise PlanError(f"{identifier} source spans do not cover the complete content unit")

        for raw_anchor in unit.get("anchors", []):
            if not isinstance(raw_anchor, dict):
                raise PlanError(f"{identifier} contains an invalid bilingual anchor")
            piece_id = raw_anchor.get("targetPieceId")
            anchor_start = raw_anchor.get("sourceUnitStart")
            anchor_end = raw_anchor.get("sourceUnitEnd")
            matching_piece = next((piece for piece in pieces if piece.get("id") == piece_id), None)
            if matching_piece is None or anchor_start not in unit_position or anchor_end not in unit_position:
                raise PlanError(f"{identifier} contains an unresolved bilingual anchor")
            span = matching_piece["sourceSpan"]
            if not (
                unit_position[str(span["startUnitId"])]
                <= unit_position[str(anchor_start)]
                <= unit_position[str(anchor_end)]
                <= unit_position[str(span["endUnitId"])]
            ):
                raise PlanError(f"{identifier} bilingual anchor is outside its paired source span")
    return warnings


def validate_command(args: argparse.Namespace) -> int:
    plan = load_json(args.plan, "segmentation plan")
    warnings = validate_alignment(plan)
    print(json.dumps({"valid": True, "warnings": warnings}, ensure_ascii=False, indent=2))
    return 0


def normalize_display_text(value: str, punctuation_policy: str) -> str:
    if punctuation_policy == "remove-commas-periods":
        value = REMOVED_PUNCTUATION_PATTERN.sub(" ", value)
    elif punctuation_policy != "preserve":
        raise PlanError(f"unsupported punctuation policy: {punctuation_policy}")
    return " ".join(value.split())


def format_timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, fraction = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d}.{fraction:03d}"


def render(args: argparse.Namespace) -> int:
    plan = load_json(args.plan, "segmentation plan")
    warnings = validate_alignment(plan)
    timed_units = {str(unit["id"]): unit for unit in plan["timedUnits"]}
    punctuation_policy = "preserve"
    if isinstance(plan.get("outputProfile"), dict):
        punctuation_policy = str(plan["outputProfile"].get("punctuationPolicy", "preserve"))
    source_lines = ["WEBVTT", "Kind: captions", f"Language: {plan['sourceLanguage']}", ""]
    output_lines = ["WEBVTT", "Kind: captions", f"Language: {plan['outputLanguage']}", ""]
    unit_order = [str(unit["id"]) for unit in plan["timedUnits"]]
    unit_position = {identifier: index for index, identifier in enumerate(unit_order)}
    for content_unit in plan["contentUnits"]:
        for piece in content_unit["pieces"]:
            span = piece["sourceSpan"]
            start_id = str(span["startUnitId"])
            end_id = str(span["endUnitId"])
            selected_ids = unit_order[unit_position[start_id] : unit_position[end_id] + 1]
            source_text = " ".join(str(timed_units[identifier]["text"]) for identifier in selected_ids)
            output_text = str(piece["outputText"])
            start = format_timestamp(float(timed_units[start_id]["start"]))
            end = format_timestamp(float(timed_units[end_id]["end"]))
            # Piece IDs belong to the manifest, never the player-facing track.
            cue = [f"{start} --> {end}"]
            source_lines.extend(cue + [normalize_display_text(source_text, punctuation_policy), ""])
            output_lines.extend(cue + [normalize_display_text(output_text, punctuation_policy), ""])
    atomic_write_text(args.input_output, "\n".join(source_lines))
    atomic_write_text(args.output, "\n".join(output_lines))
    print(
        f"Rendered target revision {plan['targetRevision']} for "
        f"{plan['sourceLanguage']} -> {plan['outputLanguage']} with {len(warnings)} warning(s)."
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--content-manifest", required=True, type=Path)
    prepare_parser.add_argument("--source-transcript", required=True, type=Path)
    prepare_parser.add_argument("--output", required=True, type=Path)
    prepare_parser.add_argument("--width-profile", choices=tuple(PROFILE_DEFAULTS))
    prepare_parser.add_argument("--fit-units", type=int)
    prepare_parser.add_argument("--hard-units", type=int)
    prepare_parser.set_defaults(handler=prepare)

    processor_parser = subparsers.add_parser("record-segmentation-processor")
    processor_parser.add_argument("--plan", required=True, type=Path)
    processor_parser.set_defaults(handler=record_segmentation_processor)

    freeze_parser = subparsers.add_parser("freeze-target")
    freeze_parser.add_argument("--plan", required=True, type=Path)
    freeze_parser.set_defaults(handler=freeze_target)

    revise_parser = subparsers.add_parser("revise-target")
    revise_parser.add_argument("--plan", required=True, type=Path)
    revise_parser.set_defaults(handler=revise_target)

    review_parser = subparsers.add_parser("record-alignment-review")
    review_parser.add_argument("--plan", required=True, type=Path)
    review_parser.set_defaults(handler=record_alignment_review)

    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--plan", required=True, type=Path)
    validate_parser.set_defaults(handler=validate_command)

    render_parser = subparsers.add_parser("render")
    render_parser.add_argument("--plan", required=True, type=Path)
    render_parser.add_argument("--input-output", required=True, type=Path)
    render_parser.add_argument("--output", required=True, type=Path)
    render_parser.set_defaults(handler=render)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        return int(args.handler(args))
    except PlanError as error:
        raise SystemExit(f"error: {error}") from error


if __name__ == "__main__":
    raise SystemExit(main())
