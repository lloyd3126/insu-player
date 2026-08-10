#!/usr/bin/env python3
"""Durable, atomic job-state storage for the local INSU media library."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 5
VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
LANGUAGE_PATTERN = re.compile(r"^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|und)$")
ARTIFACT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")
STATES = {
    "queued",
    "checking",
    "downloading",
    "downloaded",
    "needs_transcription",
    "transcribing",
    "needs_proofreading",
    "proofreading",
    "needs_translation",
    "translating",
    "needs_segmentation",
    "segmenting",
    "preparing_player",
    "ready",
    "interrupted",
    "failed",
}
ACTIVE_STATES = {
    "checking",
    "downloading",
    "transcribing",
    "proofreading",
    "translating",
    "segmenting",
    "preparing_player",
}
SUBTITLE_PIPELINE_STAGES = {
    "awaiting_choice",
    "awaiting_model",
    "model_transcription",
    "content_revision",
    "content_complete",
    "target_segmentation",
    "target_frozen",
    "source_alignment",
    "validation",
    "complete",
}
SUBTITLE_PIPELINE_MODES = {"proofread", "translate"}
SUBTITLE_ARTIFACT_KINDS = {"source", "proofread", "translation", "segmentation"}
SUBTITLE_SOURCE_TYPES = {"manual-cc", "model-transcript"}
SUBTITLE_DEPENDENCY_RELATIONS = {"timing-source", "text-reference", "content-parent"}
SUBTITLE_LIFECYCLE_STATES = {"draft", "processing", "ready", "failed", "archived"}
SUBTITLE_VALIDATION_STATES = {"pending", "valid", "warning", "invalid"}
SUBTITLE_FRESHNESS_STATES = {"current", "stale", "superseded"}
SUBTITLE_TRACK_ROLES = {
    "source_raw",
    "input_sentence",
    "output_sentence",
    "input_segmented",
    "output_segmented",
}
PROCESSOR_PROVIDERS = {"local", "openai", "agent"}
ARTIFACT_PROCESSOR_PROVIDERS = PROCESSOR_PROVIDERS | {"yt-dlp"}
PROCESSOR_NAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
JOB_STAGE_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def validate_video_id(video_id: str) -> str:
    if not VIDEO_ID_PATTERN.fullmatch(video_id):
        raise ValueError(f"invalid video ID: {video_id!r}")
    return video_id


def validate_language(language: str) -> str:
    if not LANGUAGE_PATTERN.fullmatch(language):
        raise ValueError(f"invalid language code: {language!r}")
    return language


def processor_identity(
    provider: str | None,
    service: str | None,
    model: str | None,
    *,
    label: str,
    optional: bool = False,
    timing_only: bool = False,
    allow_yt_dlp: bool = False,
) -> dict[str, str] | None:
    if provider is None and service is None and model is None and optional:
        return None
    allowed = {"local", "openai"} if timing_only else PROCESSOR_PROVIDERS
    if allow_yt_dlp:
        allowed = ARTIFACT_PROCESSOR_PROVIDERS
    if provider not in allowed:
        raise ValueError(f"unsupported {label} provider: {provider}")
    for value, field in ((service, "service"), (model, "model")):
        if value is not None and not PROCESSOR_NAME_PATTERN.fullmatch(value):
            raise ValueError(f"invalid {label} {field}: {value}")
    if provider in {"local", "openai"} and not model:
        raise ValueError(f"{label} requires a model for {provider}")
    if provider == "agent" and not service:
        raise ValueError(f"{label} requires a service for agent")
    if provider == "yt-dlp" and model:
        raise ValueError(f"{label} cannot record a yt-dlp model")
    identity = {"provider": provider}
    if service:
        identity["service"] = service
    if model:
        identity["model"] = model
    return identity


def validate_processor_payload(
    value: object,
    *,
    label: str,
    timing_only: bool = False,
    allow_yt_dlp: bool = False,
) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    unknown = set(value) - {"provider", "service", "model"}
    if unknown:
        raise ValueError(f"{label} contains unsupported fields: {sorted(unknown)}")
    resolved = processor_identity(
        value.get("provider"),
        value.get("service"),
        value.get("model"),
        label=label,
        timing_only=timing_only,
        allow_yt_dlp=allow_yt_dlp,
    )
    assert resolved is not None
    return resolved


def state_path(job_dir: Path) -> Path:
    return job_dir / "status.json"


def default_status(job_dir: Path, video_id: str | None = None) -> dict[str, Any]:
    resolved_id = validate_video_id(video_id or job_dir.name)
    now = utc_now()
    return {
        "schemaVersion": SCHEMA_VERSION,
        "videoId": resolved_id,
        "title": resolved_id,
        "sourceUrl": "",
        "durationSeconds": None,
        "state": "queued",
        "stage": "queued",
        "progress": 0.0,
        "message": "等待處理",
        "assets": {},
        "subtitleArtifacts": [],
        "activeSubtitleTracks": {},
        "subtitlePipeline": None,
        "transcription": None,
        "process": None,
        "lastError": None,
        "createdAt": now,
        "updatedAt": now,
        "completedAt": None,
        "history": [
            {
                "at": now,
                "state": "queued",
                "stage": "queued",
                "message": "建立任務",
            }
        ],
    }


def load_status(job_dir: Path, *, create_default: bool = False) -> dict[str, Any]:
    path = state_path(job_dir)
    if not path.exists():
        if create_default:
            return default_status(job_dir)
        raise FileNotFoundError(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"job state is not a JSON object: {path}")
    if data.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(f"job state must use schemaVersion {SCHEMA_VERSION}: {path}")
    if not isinstance(data.get("subtitleArtifacts"), list):
        raise ValueError(f"job state must contain subtitleArtifacts: {path}")
    for artifact in data["subtitleArtifacts"]:
        if not isinstance(artifact, dict):
            raise ValueError(f"job state contains an invalid subtitle artifact: {path}")
        if {"provider", "model"}.intersection(artifact):
            raise ValueError(f"subtitle artifact contains removed processor fields: {path}")
        validate_processor_payload(
            artifact.get("processor"),
            label="subtitleArtifact.processor",
            allow_yt_dlp=True,
        )
    if not isinstance(data.get("activeSubtitleTracks"), dict):
        raise ValueError(f"job state must contain activeSubtitleTracks: {path}")
    if data.get("videoId") != job_dir.name:
        raise ValueError(f"job state videoId must match its directory: {path}")
    if data.get("state") not in STATES:
        raise ValueError(f"job state has an unsupported state: {path}")
    if not isinstance(data.get("stage"), str) or not JOB_STAGE_PATTERN.fullmatch(data["stage"]):
        raise ValueError(f"job state must contain a semantic stage token: {path}")
    progress = data.get("progress")
    if isinstance(progress, bool) or not isinstance(progress, (int, float)):
        raise ValueError(f"job state progress must be numeric: {path}")
    if not math.isfinite(float(progress)) or not 0 <= float(progress) <= 100:
        raise ValueError(f"job state progress must be between 0 and 100: {path}")
    transcription = data.get("transcription")
    if transcription is not None:
        if not isinstance(transcription, dict):
            raise ValueError(f"job state transcription must be an object: {path}")
        unknown = set(transcription) - {
            "provider",
            "model",
            "languageTag",
            "engineLanguage",
            "updatedAt",
        }
        if unknown:
            raise ValueError(f"job state transcription contains unsupported fields: {path}")
        if transcription.get("provider") not in {"local", "openai"}:
            raise ValueError(f"job state transcription provider is unsupported: {path}")
        model = transcription.get("model")
        if not isinstance(model, str) or not PROCESSOR_NAME_PATTERN.fullmatch(model):
            raise ValueError(f"job state transcription model is invalid: {path}")
        language_tag = validate_language(str(transcription.get("languageTag", "")))
        engine_language = transcription.get("engineLanguage")
        if language_tag == "und":
            if engine_language is not None:
                raise ValueError(f"und transcription cannot have engineLanguage: {path}")
        elif not isinstance(engine_language, str) or not re.fullmatch(r"[a-z]{2,3}", engine_language):
            raise ValueError(f"job state transcription engineLanguage is invalid: {path}")
        if not isinstance(transcription.get("updatedAt"), str):
            raise ValueError(f"job state transcription updatedAt is missing: {path}")
    pipeline = data.get("subtitlePipeline")
    if pipeline is not None:
        if not isinstance(pipeline, dict):
            raise ValueError(f"job state subtitlePipeline must be an object: {path}")
        if pipeline.get("mode") not in SUBTITLE_PIPELINE_MODES:
            raise ValueError(f"subtitlePipeline.mode is unsupported: {path}")
        if pipeline.get("stage") not in SUBTITLE_PIPELINE_STAGES:
            raise ValueError(f"subtitlePipeline.stage is unsupported: {path}")
        source_language = validate_language(str(pipeline.get("sourceLanguage", "")))
        output_language = validate_language(str(pipeline.get("outputLanguage", "")))
        if pipeline.get("mode") == "proofread" and source_language != output_language:
            raise ValueError(f"proofread subtitlePipeline must preserve language: {path}")
        if pipeline.get("mode") == "translate" and source_language == output_language:
            raise ValueError(f"translate subtitlePipeline must change language: {path}")
        if not isinstance(pipeline.get("manualReferenceArtifactIds"), list):
            raise ValueError(f"subtitlePipeline references must be an array: {path}")
        forbidden_fields = {
            "timingProvider",
            "timingModel",
            "contentProvider",
            "contentModel",
        }
        if forbidden_fields.intersection(pipeline):
            raise ValueError(f"subtitlePipeline contains removed processor fields: {path}")
        if pipeline.get("timingProcessor") is not None:
            validate_processor_payload(
                pipeline["timingProcessor"],
                label="subtitlePipeline.timingProcessor",
                timing_only=True,
            )
        if pipeline.get("contentProcessor") is not None:
            validate_processor_payload(
                pipeline["contentProcessor"],
                label="subtitlePipeline.contentProcessor",
            )
        if pipeline.get("segmentationProcessor") is not None:
            validate_processor_payload(
                pipeline["segmentationProcessor"],
                label="subtitlePipeline.segmentationProcessor",
            )
    history = data.get("history")
    if not isinstance(history, list):
        raise ValueError(f"job state must contain history: {path}")
    for entry in history:
        if (
            not isinstance(entry, dict)
            or entry.get("state") not in STATES
            or not isinstance(entry.get("stage"), str)
            or not JOB_STAGE_PATTERN.fullmatch(entry["stage"])
        ):
            raise ValueError(f"job state contains an invalid history entry: {path}")
    return data


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_name = handle.name
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)


def relative_job_path(job_dir: Path, candidate: Path) -> str:
    job_root = job_dir.resolve()
    target = candidate.resolve()
    try:
        return target.relative_to(job_root).as_posix()
    except ValueError as error:
        raise ValueError(f"asset must stay inside the job directory: {candidate}") from error


def save_status(job_dir: Path, status: dict[str, Any]) -> dict[str, Any]:
    status["schemaVersion"] = SCHEMA_VERSION
    status["updatedAt"] = utc_now()
    history = status.setdefault("history", [])
    if isinstance(history, list) and len(history) > 120:
        status["history"] = history[-120:]
    atomic_write_json(state_path(job_dir), status)
    return status


def initialize_job(
    job_dir: Path,
    video_id: str,
    source_url: str,
    title: str,
    duration_seconds: float | None = None,
) -> dict[str, Any]:
    validate_video_id(video_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    try:
        status = load_status(job_dir)
    except FileNotFoundError:
        status = default_status(job_dir, video_id)
    status.update(
        {
            "videoId": video_id,
            "sourceUrl": source_url,
            "title": title or status.get("title") or video_id,
        }
    )
    if duration_seconds is not None:
        if not isinstance(duration_seconds, (int, float)) or isinstance(duration_seconds, bool):
            raise ValueError("duration must be a positive finite number")
        duration_seconds = float(duration_seconds)
        if not duration_seconds > 0 or not math.isfinite(duration_seconds):
            raise ValueError("duration must be a positive finite number")
        status["durationSeconds"] = duration_seconds
    return save_status(job_dir, status)


def patch_status(
    job_dir: Path,
    patch: dict[str, Any],
    *,
    record_history: bool = False,
) -> dict[str, Any]:
    status = load_status(job_dir, create_default=True)
    old_state = status.get("state")
    old_stage = status.get("stage")
    old_message = status.get("message")

    if "state" in patch:
        new_state = str(patch["state"])
        if new_state not in STATES:
            raise ValueError(f"unsupported state: {new_state}")
    if "stage" in patch:
        new_stage = str(patch["stage"])
        if not JOB_STAGE_PATTERN.fullmatch(new_stage):
            raise ValueError(f"unsupported stage token: {new_stage}")
    if "progress" in patch and patch["progress"] is not None:
        patch["progress"] = max(0.0, min(100.0, float(patch["progress"])))

    status.update(patch)
    state = status.get("state")
    if state == "ready":
        status["progress"] = 100.0
        status["completedAt"] = status.get("completedAt") or utc_now()
        status["lastError"] = None
        status["process"] = None
    elif state == "failed":
        status["process"] = None
    elif old_state == "ready":
        status["completedAt"] = None

    changed = (
        old_state != status.get("state")
        or old_stage != status.get("stage")
        or old_message != status.get("message")
    )
    if record_history or changed:
        status.setdefault("history", []).append(
            {
                "at": utc_now(),
                "state": status.get("state"),
                "stage": status.get("stage"),
                "message": status.get("message"),
            }
        )
    return save_status(job_dir, status)


def set_asset(job_dir: Path, name: str, path: Path) -> dict[str, Any]:
    status = load_status(job_dir, create_default=True)
    assets = status.setdefault("assets", {})
    assets[name] = {
        "path": relative_job_path(job_dir, path),
        "bytes": path.stat().st_size if path.exists() and path.is_file() else None,
        "updatedAt": utc_now(),
    }
    return save_status(job_dir, status)


def remove_asset(job_dir: Path, name: str) -> dict[str, Any]:
    status = load_status(job_dir, create_default=True)
    assets = status.setdefault("assets", {})
    assets.pop(name, None)
    return save_status(job_dir, status)


def set_subtitle_artifact(
    job_dir: Path,
    *,
    artifact_id: str,
    kind: str,
    revision: int,
    lifecycle_state: str,
    validation_state: str,
    freshness_state: str,
    source_language: str,
    output_language: str | None,
    source_type: str | None,
    processor_provider: str | None,
    processor_service: str | None,
    processor_model: str | None,
    timing_unit_kind: str | None,
    target_frozen: bool,
    manifest: Path | None,
    dependencies: list[list[str]],
    tracks: list[list[str]],
    warning_count: int,
    hard_defect_count: int,
) -> dict[str, Any]:
    if not ARTIFACT_ID_PATTERN.fullmatch(artifact_id):
        raise ValueError(f"invalid subtitle artifact ID: {artifact_id!r}")
    if kind not in SUBTITLE_ARTIFACT_KINDS:
        raise ValueError(f"unsupported subtitle artifact kind: {kind}")
    if revision < 1:
        raise ValueError("subtitle artifact revision must be positive")
    if lifecycle_state not in SUBTITLE_LIFECYCLE_STATES:
        raise ValueError(f"unsupported subtitle lifecycle state: {lifecycle_state}")
    if validation_state not in SUBTITLE_VALIDATION_STATES:
        raise ValueError(f"unsupported subtitle validation state: {validation_state}")
    if freshness_state not in SUBTITLE_FRESHNESS_STATES:
        raise ValueError(f"unsupported subtitle freshness state: {freshness_state}")
    validate_language(source_language)
    if output_language is not None:
        validate_language(output_language)
    processor = processor_identity(
        processor_provider,
        processor_service,
        processor_model,
        label="subtitle artifact processor",
        allow_yt_dlp=True,
    )
    assert processor is not None
    if kind == "source":
        if output_language is not None:
            raise ValueError("source artifacts cannot have an output language")
        if source_type not in SUBTITLE_SOURCE_TYPES:
            raise ValueError("source artifacts require a source type")
        if dependencies:
            raise ValueError("source artifacts cannot have dependencies")
        if manifest is not None:
            raise ValueError("source artifacts cannot have a manifest")
        if source_type == "manual-cc":
            if processor["provider"] != "yt-dlp" or timing_unit_kind != "cue":
                raise ValueError("manual CC must use yt-dlp cue timing")
        elif (
            processor["provider"] not in {"local", "openai"}
            or timing_unit_kind not in {"word", "token", "grapheme-group"}
        ):
            raise ValueError("model transcripts require a model and fine-grained timing")
    else:
        if source_type is not None:
            raise ValueError("only source artifacts may have a source type")
        if output_language is None:
            raise ValueError(f"{kind} artifacts require an output language")
        if kind == "proofread" and output_language != source_language:
            raise ValueError("proofread artifacts must preserve the source language")
        if kind == "translation" and output_language == source_language:
            raise ValueError("translation artifacts must change language")
        if processor["provider"] == "yt-dlp":
            raise ValueError(f"{kind} artifacts cannot use yt-dlp as a processor")
        if manifest is None:
            raise ValueError(f"{kind} artifacts require a manifest")
    if kind == "segmentation" and not target_frozen:
        raise ValueError("segmentation artifacts require a frozen target")
    if kind != "segmentation" and target_frozen:
        raise ValueError("only segmentation artifacts can freeze the target")
    if warning_count < 0 or hard_defect_count < 0:
        raise ValueError("subtitle defect counts cannot be negative")
    normalized_dependencies: list[dict[str, str]] = []
    seen_dependencies: set[tuple[str, str]] = set()
    for relation, dependency_id in dependencies:
        if relation not in SUBTITLE_DEPENDENCY_RELATIONS:
            raise ValueError(f"unsupported subtitle dependency relation: {relation}")
        if not ARTIFACT_ID_PATTERN.fullmatch(dependency_id):
            raise ValueError(f"invalid subtitle dependency ID: {dependency_id!r}")
        key = (relation, dependency_id)
        if key in seen_dependencies:
            raise ValueError("duplicate subtitle artifact dependency")
        seen_dependencies.add(key)
        normalized_dependencies.append(
            {"relation": relation, "artifactId": dependency_id}
        )

    normalized_tracks: list[dict[str, Any]] = []
    seen_roles: set[str] = set()
    artifact_checksum = hashlib.sha256()
    for language, role, raw_path in tracks:
        validate_language(language)
        if role not in SUBTITLE_TRACK_ROLES:
            raise ValueError(f"unsupported subtitle track role: {role}")
        if role in seen_roles:
            raise ValueError(f"duplicate artifact track role: {role}")
        track_path = Path(raw_path)
        if track_path.suffix.lower() != ".vtt" or not track_path.is_file():
            raise ValueError(f"subtitle artifact track is not a VTT file: {track_path}")
        relative = relative_job_path(job_dir, track_path)
        artifact_root = f"subtitle-work/artifacts/{artifact_id}/"
        if not relative.startswith(artifact_root):
            raise ValueError(f"subtitle track must stay inside {artifact_root}")
        contents = track_path.read_bytes()
        digest = hashlib.sha256(contents).hexdigest()
        artifact_checksum.update(language.encode("utf-8"))
        artifact_checksum.update(digest.encode("ascii"))
        normalized_tracks.append(
            {
                "id": f"{artifact_id}-{role}",
                "languageCode": language,
                "role": role,
                "state": "ready" if lifecycle_state == "ready" else lifecycle_state,
                "path": relative,
                "bytes": len(contents),
                "checksum": digest,
                "updatedAt": utc_now(),
            }
        )
        seen_roles.add(role)
    if lifecycle_state == "ready" and not normalized_tracks:
        raise ValueError("ready subtitle artifact requires at least one track")
    expected_roles = {
        "source": ["source_raw"],
        "proofread": ["input_sentence", "output_sentence"],
        "translation": ["input_sentence", "output_sentence"],
        "segmentation": ["input_segmented", "output_segmented"],
    }
    if lifecycle_state == "ready":
        if sorted(track["role"] for track in normalized_tracks) != sorted(expected_roles[kind]):
            raise ValueError(f"ready {kind} artifact tracks do not match its contract")
    for track in normalized_tracks:
        expected_language = (
            source_language
            if track["role"] == "source_raw" or track["role"].startswith("input_")
            else output_language
        )
        if track["languageCode"] != expected_language:
            raise ValueError("subtitle artifact tracks do not match its languages")

    manifest_path: str | None = None
    if manifest is not None:
        if manifest.suffix.lower() != ".json" or not manifest.is_file():
            raise ValueError(f"subtitle artifact manifest is not JSON: {manifest}")
        manifest_path = relative_job_path(job_dir, manifest)
        artifact_root = f"subtitle-work/artifacts/{artifact_id}/"
        if not manifest_path.startswith(artifact_root):
            raise ValueError(f"subtitle manifest must stay inside {artifact_root}")
        artifact_checksum.update(hashlib.sha256(manifest.read_bytes()).digest())

    status = load_status(job_dir, create_default=True)
    artifacts = status.setdefault("subtitleArtifacts", [])
    if not isinstance(artifacts, list):
        raise ValueError("subtitleArtifacts must be a list")
    artifacts_by_id = {
        candidate.get("id"): candidate
        for candidate in artifacts
        if isinstance(candidate, dict) and isinstance(candidate.get("id"), str)
    }
    resolved_dependencies: dict[str, list[dict[str, Any]]] = {
        relation: [] for relation in SUBTITLE_DEPENDENCY_RELATIONS
    }
    for dependency in normalized_dependencies:
        parent = artifacts_by_id.get(dependency["artifactId"])
        if parent is None:
            raise ValueError(
                f"subtitle dependency does not exist: {dependency['artifactId']}"
            )
        resolved_dependencies[dependency["relation"]].append(parent)
    if kind != "source":
        timing_sources = resolved_dependencies["timing-source"]
        references = resolved_dependencies["text-reference"]
        content_parents = resolved_dependencies["content-parent"]
        if (
            len(timing_sources) != 1
            or timing_sources[0].get("kind") != "source"
            or timing_sources[0].get("sourceType") != "model-transcript"
            or timing_sources[0].get("sourceLanguage") != source_language
        ):
            raise ValueError("subtitle revisions require one model transcript timing source")
        if any(
            reference.get("kind") != "source"
            or reference.get("sourceType") != "manual-cc"
            or reference.get("sourceLanguage") != source_language
            for reference in references
        ):
            raise ValueError("text references must be same-language manual CC")
        if kind in {"proofread", "translation"} and content_parents:
            raise ValueError("content revisions cannot have a content parent")
        if kind == "segmentation":
            if references or len(content_parents) != 1:
                raise ValueError("segmentation requires one content parent")
            content_parent = content_parents[0]
            if (
                content_parent.get("kind") not in {"proofread", "translation"}
                or content_parent.get("sourceLanguage") != source_language
                or content_parent.get("outputLanguage") != output_language
            ):
                raise ValueError("segmentation content parent languages do not match")
    existing = next(
        (
            artifact
            for artifact in artifacts
            if isinstance(artifact, dict) and artifact.get("id") == artifact_id
        ),
        None,
    )
    conflicting_revision = next(
        (
            candidate
            for candidate in artifacts
            if isinstance(candidate, dict)
            and candidate.get("id") != artifact_id
            and candidate.get("kind") == kind
            and candidate.get("revision") == revision
            and candidate.get("sourceLanguage") == source_language
            and candidate.get("outputLanguage") == output_language
            and candidate.get("sourceType") == source_type
        ),
        None,
    )
    if conflicting_revision is not None:
        raise ValueError("subtitle artifact revision already has a different ID")
    now = utc_now()
    artifact: dict[str, Any] = {
        "id": artifact_id,
        "kind": kind,
        "revision": revision,
        "lifecycleState": lifecycle_state,
        "validationState": validation_state,
        "freshnessState": freshness_state,
        "sourceLanguage": source_language,
        "outputLanguage": output_language,
        "sourceType": source_type,
        "processor": processor,
        "timingUnitKind": timing_unit_kind,
        "targetFrozen": target_frozen,
        "manifestPath": manifest_path,
        "checksum": artifact_checksum.hexdigest(),
        "warningCount": warning_count,
        "hardDefectCount": hard_defect_count,
        "dependencies": normalized_dependencies,
        "tracks": normalized_tracks,
        "createdAt": existing.get("createdAt") if isinstance(existing, dict) else now,
        "completedAt": now if lifecycle_state == "ready" else None,
    }
    if isinstance(existing, dict):
        immutable = ("kind", "revision", "sourceLanguage", "outputLanguage", "sourceType")
        if any(existing.get(key) != artifact.get(key) for key in immutable):
            raise ValueError("an existing subtitle artifact cannot change identity")
        if existing.get("lifecycleState") == "ready":
            immutable_ready = (
                "checksum",
                "manifestPath",
                "dependencies",
                "targetFrozen",
                "processor",
            )
            existing_tracks = [
                {
                    key: track.get(key)
                    for key in ("id", "languageCode", "role", "path", "checksum")
                }
                for track in existing.get("tracks", [])
                if isinstance(track, dict)
            ]
            artifact_tracks = [
                {
                    key: track.get(key)
                    for key in ("id", "languageCode", "role", "path", "checksum")
                }
                for track in artifact["tracks"]
            ]
            if any(existing.get(key) != artifact.get(key) for key in immutable_ready):
                raise ValueError("a ready subtitle artifact revision is immutable")
            if existing_tracks != artifact_tracks:
                raise ValueError("a ready subtitle artifact revision is immutable")
            return status
        artifacts[artifacts.index(existing)] = artifact
    else:
        artifacts.append(artifact)

    if (
        lifecycle_state == "ready"
        and validation_state != "invalid"
        and hard_defect_count == 0
    ):
        for candidate in artifacts:
            if not isinstance(candidate, dict) or candidate.get("id") == artifact_id:
                continue
            same_stream = (
                candidate.get("kind") == kind
                and candidate.get("sourceLanguage") == source_language
                and candidate.get("outputLanguage") == output_language
                and candidate.get("sourceType") == source_type
            )
            candidate_revision = candidate.get("revision")
            if (
                same_stream
                and isinstance(candidate_revision, int)
                and candidate_revision < revision
                and candidate.get("lifecycleState") == "ready"
            ):
                candidate["freshnessState"] = "superseded"
    return save_status(job_dir, status)


def set_transcription(
    job_dir: Path,
    provider: str,
    model: str,
    language_tag: str,
    engine_language: str | None,
) -> dict[str, Any]:
    if provider not in {"local", "openai"}:
        raise ValueError(f"unsupported transcription provider: {provider}")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", model):
        raise ValueError(f"invalid transcription model: {model}")
    language_tag = validate_language(language_tag)
    if language_tag == "und":
        if engine_language is not None:
            raise ValueError("und transcription cannot have an engine language")
    elif not isinstance(engine_language, str) or not re.fullmatch(r"[a-z]{2,3}", engine_language):
        raise ValueError("resolved transcription requires an engine language")
    status = load_status(job_dir, create_default=True)
    status["transcription"] = {
        "provider": provider,
        "model": model,
        "languageTag": language_tag,
        "engineLanguage": engine_language,
        "updatedAt": utc_now(),
    }
    return save_status(job_dir, status)


def clear_transcription(job_dir: Path) -> dict[str, Any]:
    status = load_status(job_dir, create_default=True)
    status["transcription"] = None
    return save_status(job_dir, status)


def set_subtitle_pipeline(
    job_dir: Path,
    *,
    mode: str,
    stage: str,
    source_language: str,
    output_language: str,
    timing_processor_provider: str | None,
    timing_processor_service: str | None,
    timing_processor_model: str | None,
    content_processor_provider: str | None,
    content_processor_service: str | None,
    content_processor_model: str | None,
    segmentation_processor_provider: str | None,
    segmentation_processor_service: str | None,
    segmentation_processor_model: str | None,
    manual_reference_artifact_ids: list[str],
) -> dict[str, Any]:
    if mode not in SUBTITLE_PIPELINE_MODES:
        raise ValueError(f"unsupported subtitle pipeline mode: {mode}")
    if stage not in SUBTITLE_PIPELINE_STAGES:
        raise ValueError(f"unsupported subtitle pipeline stage: {stage}")
    validate_language(source_language)
    validate_language(output_language)
    if mode == "proofread" and source_language != output_language:
        raise ValueError("proofread pipeline must preserve the source language")
    if mode == "translate" and source_language == output_language:
        raise ValueError("translate pipeline must change language")
    timing_processor = processor_identity(
        timing_processor_provider,
        timing_processor_service,
        timing_processor_model,
        label="timing processor",
        optional=True,
        timing_only=True,
    )
    content_processor = processor_identity(
        content_processor_provider,
        content_processor_service,
        content_processor_model,
        label="content processor",
        optional=True,
    )
    segmentation_processor = processor_identity(
        segmentation_processor_provider,
        segmentation_processor_service,
        segmentation_processor_model,
        label="segmentation processor",
        optional=True,
    )
    if len(set(manual_reference_artifact_ids)) != len(manual_reference_artifact_ids):
        raise ValueError("subtitle pipeline references must be unique")
    if any(
        not ARTIFACT_ID_PATTERN.fullmatch(artifact_id)
        for artifact_id in manual_reference_artifact_ids
    ):
        raise ValueError("subtitle pipeline contains an invalid reference artifact ID")
    pipeline: dict[str, Any] = {
        "mode": mode,
        "stage": stage,
        "sourceLanguage": source_language,
        "outputLanguage": output_language,
        "manualReferenceArtifactIds": manual_reference_artifact_ids,
        "updatedAt": utc_now(),
    }
    if timing_processor is not None:
        pipeline["timingProcessor"] = timing_processor
    if content_processor is not None:
        pipeline["contentProcessor"] = content_processor
    if segmentation_processor is not None:
        pipeline["segmentationProcessor"] = segmentation_processor
    status = load_status(job_dir, create_default=True)
    status["subtitlePipeline"] = pipeline
    return save_status(job_dir, status)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init", help="create or refresh a job record")
    init_parser.add_argument("--job-dir", required=True, type=Path)
    init_parser.add_argument("--video-id", required=True)
    init_parser.add_argument("--source-url", required=True)
    init_parser.add_argument("--title", default="")
    init_parser.add_argument("--duration-seconds", type=float)

    update_parser = subparsers.add_parser("update", help="update state and progress")
    update_parser.add_argument("--job-dir", required=True, type=Path)
    update_parser.add_argument("--state", choices=sorted(STATES))
    update_parser.add_argument("--stage")
    update_parser.add_argument("--message")
    update_parser.add_argument("--progress", type=float)
    update_parser.add_argument("--error")
    update_parser.add_argument("--title")
    update_parser.add_argument("--clear-error", action="store_true")
    update_parser.add_argument("--record-history", action="store_true")

    asset_parser = subparsers.add_parser("asset", help="record a generated asset")
    asset_parser.add_argument("--job-dir", required=True, type=Path)
    asset_parser.add_argument("--name", required=True)
    asset_parser.add_argument("--path", type=Path)
    asset_parser.add_argument("--remove", action="store_true")

    artifact_parser = subparsers.add_parser(
        "subtitle-artifact", help="register one revisioned subtitle artifact"
    )
    artifact_parser.add_argument("--job-dir", required=True, type=Path)
    artifact_parser.add_argument("--id", required=True)
    artifact_parser.add_argument("--kind", required=True, choices=sorted(SUBTITLE_ARTIFACT_KINDS))
    artifact_parser.add_argument("--revision", required=True, type=int)
    artifact_parser.add_argument(
        "--lifecycle-state", default="ready", choices=sorted(SUBTITLE_LIFECYCLE_STATES)
    )
    artifact_parser.add_argument(
        "--validation-state", default="valid", choices=sorted(SUBTITLE_VALIDATION_STATES)
    )
    artifact_parser.add_argument(
        "--freshness-state", default="current", choices=sorted(SUBTITLE_FRESHNESS_STATES)
    )
    artifact_parser.add_argument("--source-language", required=True)
    artifact_parser.add_argument("--output-language")
    artifact_parser.add_argument("--source-type", choices=sorted(SUBTITLE_SOURCE_TYPES))
    artifact_parser.add_argument(
        "--processor-provider", required=True, choices=sorted(ARTIFACT_PROCESSOR_PROVIDERS)
    )
    artifact_parser.add_argument("--processor-service")
    artifact_parser.add_argument("--processor-model")
    artifact_parser.add_argument("--timing-unit-kind")
    artifact_parser.add_argument("--target-frozen", action="store_true")
    artifact_parser.add_argument("--manifest", type=Path)
    artifact_parser.add_argument(
        "--dependency",
        action="append",
        nargs=2,
        metavar=("RELATION", "ARTIFACT_ID"),
        default=[],
    )
    artifact_parser.add_argument(
        "--track", action="append", nargs=3, metavar=("LANGUAGE", "ROLE", "PATH"), default=[]
    )
    artifact_parser.add_argument("--warning-count", type=int, default=0)
    artifact_parser.add_argument("--hard-defect-count", type=int, default=0)

    transcription_parser = subparsers.add_parser("transcription", help="record transcription provider metadata")
    transcription_parser.add_argument("--job-dir", required=True, type=Path)
    transcription_parser.add_argument("--provider", required=True, choices=("local", "openai"))
    transcription_parser.add_argument("--model", required=True)
    transcription_parser.add_argument("--language-tag", required=True)
    transcription_parser.add_argument("--engine-language")

    transcription_clear_parser = subparsers.add_parser(
        "transcription-clear", help="clear stale transcription metadata before a new run"
    )
    transcription_clear_parser.add_argument("--job-dir", required=True, type=Path)

    pipeline_parser = subparsers.add_parser(
        "subtitle-pipeline", help="record the visible subtitle pipeline stage"
    )
    pipeline_parser.add_argument("--job-dir", required=True, type=Path)
    pipeline_parser.add_argument("--mode", required=True, choices=sorted(SUBTITLE_PIPELINE_MODES))
    pipeline_parser.add_argument("--stage", required=True, choices=sorted(SUBTITLE_PIPELINE_STAGES))
    pipeline_parser.add_argument("--source-language", required=True)
    pipeline_parser.add_argument("--output-language", required=True)
    pipeline_parser.add_argument("--timing-processor-provider", choices=("local", "openai"))
    pipeline_parser.add_argument("--timing-processor-service")
    pipeline_parser.add_argument("--timing-processor-model")
    pipeline_parser.add_argument("--content-processor-provider", choices=sorted(PROCESSOR_PROVIDERS))
    pipeline_parser.add_argument("--content-processor-service")
    pipeline_parser.add_argument("--content-processor-model")
    pipeline_parser.add_argument("--segmentation-processor-provider", choices=sorted(PROCESSOR_PROVIDERS))
    pipeline_parser.add_argument("--segmentation-processor-service")
    pipeline_parser.add_argument("--segmentation-processor-model")
    pipeline_parser.add_argument("--manual-reference-artifact", action="append", default=[])

    show_parser = subparsers.add_parser("show", help="print a job record")
    show_parser.add_argument("--job-dir", required=True, type=Path)
    show_parser.add_argument("--field")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "init":
        status = initialize_job(
            args.job_dir,
            args.video_id,
            args.source_url,
            args.title,
            args.duration_seconds,
        )
    elif args.command == "update":
        patch: dict[str, Any] = {}
        for key in ("state", "stage", "message", "progress", "title"):
            value = getattr(args, key)
            if value is not None:
                patch[key] = value
        if args.error is not None:
            patch["lastError"] = args.error
        if args.clear_error:
            patch["lastError"] = None
        status = patch_status(args.job_dir, patch, record_history=args.record_history)
    elif args.command == "asset":
        if args.remove:
            status = remove_asset(args.job_dir, args.name)
        elif args.path is not None:
            status = set_asset(args.job_dir, args.name, args.path)
        else:
            raise ValueError("asset requires --path or --remove")
    elif args.command == "subtitle-artifact":
        status = set_subtitle_artifact(
            args.job_dir,
            artifact_id=args.id,
            kind=args.kind,
            revision=args.revision,
            lifecycle_state=args.lifecycle_state,
            validation_state=args.validation_state,
            freshness_state=args.freshness_state,
            source_language=args.source_language,
            output_language=args.output_language,
            source_type=args.source_type,
            processor_provider=args.processor_provider,
            processor_service=args.processor_service,
            processor_model=args.processor_model,
            timing_unit_kind=args.timing_unit_kind,
            target_frozen=args.target_frozen,
            manifest=args.manifest,
            dependencies=args.dependency,
            tracks=args.track,
            warning_count=max(0, args.warning_count),
            hard_defect_count=max(0, args.hard_defect_count),
        )
    elif args.command == "transcription":
        status = set_transcription(
            args.job_dir,
            args.provider,
            args.model,
            args.language_tag,
            args.engine_language,
        )
    elif args.command == "transcription-clear":
        status = clear_transcription(args.job_dir)
    elif args.command == "subtitle-pipeline":
        status = set_subtitle_pipeline(
            args.job_dir,
            mode=args.mode,
            stage=args.stage,
            source_language=args.source_language,
            output_language=args.output_language,
            timing_processor_provider=args.timing_processor_provider,
            timing_processor_service=args.timing_processor_service,
            timing_processor_model=args.timing_processor_model,
            content_processor_provider=args.content_processor_provider,
            content_processor_service=args.content_processor_service,
            content_processor_model=args.content_processor_model,
            segmentation_processor_provider=args.segmentation_processor_provider,
            segmentation_processor_service=args.segmentation_processor_service,
            segmentation_processor_model=args.segmentation_processor_model,
            manual_reference_artifact_ids=args.manual_reference_artifact,
        )
    elif args.command == "show":
        status = load_status(args.job_dir)
        if args.field:
            value: Any = status
            for part in args.field.split("."):
                if not isinstance(value, dict) or part not in value:
                    raise KeyError(args.field)
                value = value[part]
            if isinstance(value, (dict, list)):
                print(json.dumps(value, ensure_ascii=False))
            elif value is not None:
                print(value)
            return 0
    else:
        raise AssertionError(args.command)

    print(json.dumps(status, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
