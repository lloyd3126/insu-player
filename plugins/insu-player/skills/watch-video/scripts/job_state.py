#!/usr/bin/env python3
"""Durable, atomic job-state storage for the local INSU media library."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PLUGIN_ROOT = Path(__file__).resolve().parents[3]
SUBTITLE_MANIFEST_CONTRACT_PATH = (
    PLUGIN_ROOT / "contracts" / "subtitle-manifest-contract.json"
)
try:
    SUBTITLE_MANIFEST_CONTRACT = json.loads(
        SUBTITLE_MANIFEST_CONTRACT_PATH.read_text(encoding="utf-8")
    )
except (OSError, json.JSONDecodeError) as error:
    raise RuntimeError(
        f"current subtitle manifest contract is unavailable: {SUBTITLE_MANIFEST_CONTRACT_PATH}"
    ) from error
if (
    not isinstance(SUBTITLE_MANIFEST_CONTRACT, dict)
    or SUBTITLE_MANIFEST_CONTRACT.get("schemaVersion") != 1
):
    raise RuntimeError("subtitle manifest contract must use schemaVersion 1")


SCHEMA_VERSION = 3
REMOTE_SOURCE_KINDS = {"page", "embed", "network-media"}
SOURCE_KINDS = REMOTE_SOURCE_KINDS | {"local-file"}
DATABASE_APPLICATION_ID = 0x494E5355
DATABASE_SCHEMA_VERSION = 9
VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
LANGUAGE_PATTERN = re.compile(r"^(?:[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*|und)$")
ARTIFACT_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")
QUEUE_ITEM_ID_PATTERN = re.compile(r"^library-[0-9a-f-]{36}$")
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
SUBTITLE_DEPENDENCY_RELATIONS = {
    "timing-source",
    "content-source",
    "text-reference",
    "content-parent",
}
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
TIMING_PROCESSOR_PROVIDERS = {
    "local",
    "openai",
    "groq",
    "elevenlabs",
    "xai",
    "openrouter",
}
PROCESSOR_PROVIDERS = TIMING_PROCESSOR_PROVIDERS | {"agent"}
ARTIFACT_PROCESSOR_PROVIDERS = PROCESSOR_PROVIDERS | {"yt-dlp"}
PROCESSOR_NAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
JOB_STAGE_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
TIMING_PROCESSOR_CONTRACTS: dict[str, tuple[str, set[str] | None]] = {
    "local": ("openai-whisper", None),
    "openai": ("audio/transcriptions", {"whisper-1"}),
    "groq": ("audio/transcriptions", {"whisper-large-v3", "whisper-large-v3-turbo"}),
    "elevenlabs": ("speech-to-text", {"scribe_v2"}),
    "xai": ("v1/stt", set()),
    "openrouter": ("audio/transcriptions", {"openai/whisper-large-v3"}),
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def validate_timestamp(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{label} must be a timestamp") from error
    if parsed.tzinfo is None:
        raise ValueError(f"{label} must include a timezone")
    return value


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
    agent_only: bool = False,
) -> dict[str, Any] | None:
    if provider is None and service is None and model is None and optional:
        return None
    allowed = TIMING_PROCESSOR_PROVIDERS if timing_only else PROCESSOR_PROVIDERS
    if agent_only:
        allowed = {"agent"}
    if allow_yt_dlp:
        allowed = ARTIFACT_PROCESSOR_PROVIDERS
    if provider not in allowed:
        raise ValueError(f"unsupported {label} provider: {provider}")
    if provider in TIMING_PROCESSOR_PROVIDERS:
        expected_service, allowed_models = TIMING_PROCESSOR_CONTRACTS[provider]
        if service != expected_service:
            raise ValueError(f"{label} must use {provider} / {expected_service}")
        if allowed_models == set():
            if model is not None:
                raise ValueError(f"{label} cannot record a model for {provider}")
        elif allowed_models is not None:
            if not isinstance(model, str) or model not in allowed_models:
                raise ValueError(f"unsupported {label} model for {provider}: {model}")
        else:
            if not isinstance(model, str) or not model:
                raise ValueError(f"{label} requires a model for {provider}")
            if not PROCESSOR_NAME_PATTERN.fullmatch(model):
                raise ValueError(f"invalid {label} model: {model}")
    else:
        if service is not None and (
            not isinstance(service, str) or not PROCESSOR_NAME_PATTERN.fullmatch(service)
        ):
            raise ValueError(f"invalid {label} service: {service}")
        if model is not None and (
            not isinstance(model, str) or not PROCESSOR_NAME_PATTERN.fullmatch(model)
        ):
            raise ValueError(f"invalid {label} model: {model}")
    if agent_only and (service != "codex" or model is not None):
        raise ValueError(f"{label} must use agent / codex")
    if provider == "yt-dlp" and model:
        raise ValueError(f"{label} cannot record a yt-dlp model")
    identity: dict[str, Any] = {"provider": provider}
    if provider in TIMING_PROCESSOR_PROVIDERS:
        identity["service"] = service
        identity["model"] = model
    else:
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
) -> dict[str, Any]:
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


def validate_subtitle_manifest_payload(
    manifest_payload: object,
    kind: str,
    artifact_id: str,
) -> None:
    def manifest_agent_processor(value: object, label: str) -> None:
        contract = SUBTITLE_MANIFEST_CONTRACT.get("agentProcessor")
        if (
            not isinstance(contract, dict)
            or not isinstance(contract.get("fields"), list)
            or not all(isinstance(field, str) for field in contract["fields"])
            or not isinstance(value, dict)
            or set(value) != set(contract["fields"])
            or value.get("provider") != contract.get("provider")
            or value.get("service") != contract.get("service")
        ):
            raise ValueError(f"{label} must use the current agent / codex contract")
        validate_timestamp(value.get("updatedAt"), f"{label}.updatedAt")

    contract_name = "segmentation" if kind == "segmentation" else "content"
    manifest_contract = SUBTITLE_MANIFEST_CONTRACT.get(contract_name)
    if not isinstance(manifest_contract, dict):
        raise ValueError(f"subtitle manifest contract is invalid: {contract_name}")
    expected_schema = manifest_contract.get("schemaVersion")
    expected_fields = manifest_contract.get("fields")
    if (
        not isinstance(expected_schema, int)
        or not isinstance(expected_fields, list)
        or not all(isinstance(field, str) for field in expected_fields)
    ):
        raise ValueError(f"subtitle manifest contract is invalid: {contract_name}")
    if (
        not isinstance(manifest_payload, dict)
        or manifest_payload.get("schemaVersion") != expected_schema
    ):
        raise ValueError(
            f"subtitle artifact manifest must use schemaVersion {expected_schema}: {artifact_id}"
        )
    if set(manifest_payload) != set(expected_fields):
        raise ValueError(
            f"subtitle artifact manifest fields do not match the current schema: {artifact_id}"
        )
    if kind == "segmentation":
        validate_timestamp(
            manifest_payload.get("targetFrozenAt"),
            f"{artifact_id}.targetFrozenAt",
        )
        manifest_agent_processor(
            manifest_payload.get("contentProcessor"),
            f"{artifact_id}.contentProcessor",
        )
        manifest_agent_processor(
            manifest_payload.get("segmentationProcessor"),
            f"{artifact_id}.segmentationProcessor",
        )
        if (
            manifest_payload.get("targetFrozen") is not True
            or manifest_payload.get("alignmentMethod") != "agent-semantic"
        ):
            raise ValueError(
                f"segmentation manifest is not a completed Agent revision: {artifact_id}"
            )
    else:
        manifest_agent_processor(
            manifest_payload.get("contentProcessor"),
            f"{artifact_id}.contentProcessor",
        )
        if manifest_payload.get("mode") != (
            "translate" if kind == "translation" else "proofread"
        ):
            raise ValueError(
                f"content manifest is not a completed Agent revision: {artifact_id}"
            )


def validate_subtitle_artifacts(job_dir: Path, value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError("job state must contain subtitleArtifacts")
    required_artifact_fields = {
        "id",
        "kind",
        "revision",
        "lifecycleState",
        "validationState",
        "freshnessState",
        "sourceLanguage",
        "outputLanguage",
        "sourceType",
        "processor",
        "timingUnitKind",
        "targetFrozen",
        "manifestPath",
        "checksum",
        "warningCount",
        "hardDefectCount",
        "dependencies",
        "tracks",
        "createdAt",
        "completedAt",
    }
    required_track_fields = {
        "id",
        "languageCode",
        "role",
        "state",
        "path",
        "checksum",
        "updatedAt",
    }
    expected_roles = {
        "source": {"source_raw"},
        "proofread": {"input_sentence", "output_sentence"},
        "translation": {"input_sentence", "output_sentence"},
        "segmentation": {"input_segmented", "output_segmented"},
    }
    artifact_ids: set[str] = set()
    track_ids: set[str] = set()
    for artifact in value:
        if not isinstance(artifact, dict) or set(artifact) != required_artifact_fields:
            raise ValueError("subtitle artifact fields do not match the current schema")
        artifact_id = artifact.get("id")
        kind = artifact.get("kind")
        if (
            not isinstance(artifact_id, str)
            or not ARTIFACT_ID_PATTERN.fullmatch(artifact_id)
            or artifact_id in artifact_ids
            or kind not in SUBTITLE_ARTIFACT_KINDS
        ):
            raise ValueError("subtitle artifact identity is invalid")
        artifact_ids.add(artifact_id)
        revision = artifact.get("revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
            raise ValueError(f"subtitle artifact revision is invalid: {artifact_id}")
        lifecycle = artifact.get("lifecycleState")
        if lifecycle not in SUBTITLE_LIFECYCLE_STATES:
            raise ValueError(f"subtitle artifact lifecycle is invalid: {artifact_id}")
        if artifact.get("validationState") not in SUBTITLE_VALIDATION_STATES:
            raise ValueError(f"subtitle artifact validation is invalid: {artifact_id}")
        if artifact.get("freshnessState") not in SUBTITLE_FRESHNESS_STATES:
            raise ValueError(f"subtitle artifact freshness is invalid: {artifact_id}")
        source_language = validate_language(str(artifact.get("sourceLanguage", "")))
        output_language = artifact.get("outputLanguage")
        source_type = artifact.get("sourceType")
        if kind == "source":
            if output_language is not None or source_type not in SUBTITLE_SOURCE_TYPES:
                raise ValueError(f"source subtitle artifact languages are invalid: {artifact_id}")
        else:
            if not isinstance(output_language, str):
                raise ValueError(f"subtitle artifact output language is missing: {artifact_id}")
            validate_language(output_language)
            if source_type is not None:
                raise ValueError(f"subtitle revision sourceType must be null: {artifact_id}")
            if kind == "proofread" and output_language != source_language:
                raise ValueError(f"proofread subtitle artifact must preserve language: {artifact_id}")
            if kind == "translation" and output_language == source_language:
                raise ValueError(f"translation subtitle artifact must change language: {artifact_id}")
        processor = validate_processor_payload(
            artifact.get("processor"),
            label=f"{artifact_id}.processor",
            allow_yt_dlp=True,
        )
        timing_kind = artifact.get("timingUnitKind")
        if kind == "source" and source_type == "manual-cc":
            if processor["provider"] != "yt-dlp" or timing_kind != "cue":
                raise ValueError(f"manual CC artifact timing is invalid: {artifact_id}")
        elif kind == "source":
            if (
                processor["provider"] not in TIMING_PROCESSOR_PROVIDERS
                or timing_kind not in {"word", "token", "grapheme-group"}
            ):
                raise ValueError(f"model transcript timing is invalid: {artifact_id}")
        elif processor["provider"] == "yt-dlp":
            raise ValueError(f"subtitle revision processor is invalid: {artifact_id}")
        elif processor != {"provider": "agent", "service": "codex"}:
            raise ValueError(f"subtitle revision must use agent / codex: {artifact_id}")
        if artifact.get("targetFrozen") is not (kind == "segmentation"):
            raise ValueError(f"subtitle artifact targetFrozen is invalid: {artifact_id}")
        for count_field in ("warningCount", "hardDefectCount"):
            count = artifact.get(count_field)
            if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                raise ValueError(f"subtitle artifact {count_field} is invalid: {artifact_id}")
        validate_timestamp(artifact.get("createdAt"), f"{artifact_id}.createdAt")
        if lifecycle == "ready":
            validate_timestamp(artifact.get("completedAt"), f"{artifact_id}.completedAt")
        elif artifact.get("completedAt") is not None:
            validate_timestamp(artifact.get("completedAt"), f"{artifact_id}.completedAt")
        dependencies = artifact.get("dependencies")
        if not isinstance(dependencies, list):
            raise ValueError(f"subtitle artifact dependencies are invalid: {artifact_id}")
        seen_dependencies: set[tuple[str, str]] = set()
        for dependency in dependencies:
            if not isinstance(dependency, dict) or set(dependency) != {"artifactId", "relation"}:
                raise ValueError(f"subtitle dependency fields are invalid: {artifact_id}")
            parent_id = dependency.get("artifactId")
            relation = dependency.get("relation")
            if (
                not isinstance(parent_id, str)
                or not ARTIFACT_ID_PATTERN.fullmatch(parent_id)
                or relation not in SUBTITLE_DEPENDENCY_RELATIONS
                or (relation, parent_id) in seen_dependencies
            ):
                raise ValueError(f"subtitle dependency is invalid: {artifact_id}")
            seen_dependencies.add((str(relation), parent_id))
        tracks = artifact.get("tracks")
        if not isinstance(tracks, list):
            raise ValueError(f"subtitle artifact tracks are invalid: {artifact_id}")
        roles: set[str] = set()
        artifact_checksum = hashlib.sha256()
        for track in tracks:
            if (
                not isinstance(track, dict)
                or not required_track_fields.issubset(track)
                or set(track) - (required_track_fields | {"bytes"})
            ):
                raise ValueError(f"subtitle track fields are invalid: {artifact_id}")
            track_id = track.get("id")
            language = track.get("languageCode")
            role = track.get("role")
            if (
                not isinstance(track_id, str)
                or not ARTIFACT_ID_PATTERN.fullmatch(track_id)
                or track_id in track_ids
                or not isinstance(language, str)
                or not LANGUAGE_PATTERN.fullmatch(language)
                or role not in SUBTITLE_TRACK_ROLES
                or role in roles
                or not isinstance(track.get("state"), str)
                or not track["state"].strip()
            ):
                raise ValueError(f"subtitle track identity is invalid: {artifact_id}")
            track_ids.add(track_id)
            roles.add(str(role))
            expected_language = (
                source_language
                if role == "source_raw" or str(role).startswith("input_")
                else output_language
            )
            if language != expected_language:
                raise ValueError(f"subtitle track language is invalid: {track_id}")
            relative_path = track.get("path")
            if not isinstance(relative_path, str) or Path(relative_path).is_absolute():
                raise ValueError(f"subtitle track path is invalid: {track_id}")
            if not relative_path.startswith(f"subtitle-work/artifacts/{artifact_id}/"):
                raise ValueError(f"subtitle track path leaves its artifact: {track_id}")
            track_path = job_dir / relative_path
            if not track_path.is_file() or track_path.is_symlink():
                raise ValueError(f"subtitle track is unavailable: {track_id}")
            digest = hashlib.sha256(track_path.read_bytes()).hexdigest()
            if track.get("checksum") != digest:
                raise ValueError(f"subtitle track checksum mismatch: {track_id}")
            validate_timestamp(track.get("updatedAt"), f"{track_id}.updatedAt")
            artifact_checksum.update(language.encode("utf-8"))
            artifact_checksum.update(digest.encode("ascii"))
        if lifecycle == "ready" and roles != expected_roles[str(kind)]:
            raise ValueError(f"ready subtitle artifact tracks are invalid: {artifact_id}")
        manifest_path = artifact.get("manifestPath")
        if kind == "source":
            if manifest_path is not None or dependencies:
                raise ValueError(f"source subtitle artifact structure is invalid: {artifact_id}")
        else:
            if not isinstance(manifest_path, str) or not manifest_path.startswith(
                f"subtitle-work/artifacts/{artifact_id}/"
            ):
                raise ValueError(f"subtitle artifact manifest path is invalid: {artifact_id}")
            manifest = job_dir / manifest_path
            if not manifest.is_file() or manifest.is_symlink():
                raise ValueError(f"subtitle artifact manifest is unavailable: {artifact_id}")
            manifest_payload = json.loads(manifest.read_text(encoding="utf-8"))
            validate_subtitle_manifest_payload(manifest_payload, str(kind), artifact_id)
            artifact_checksum.update(hashlib.sha256(manifest.read_bytes()).digest())
        if artifact.get("checksum") != artifact_checksum.hexdigest():
            raise ValueError(f"subtitle artifact checksum mismatch: {artifact_id}")
    return value


def workspace_path(job_dir: Path) -> Path:
    resolved = job_dir.resolve()
    if resolved.parent.name != "jobs" or not VIDEO_ID_PATTERN.fullmatch(resolved.name):
        raise ValueError("job directory must be <workspace>/jobs/<video-id>")
    workspace = resolved.parent.parent
    if workspace == Path(workspace.anchor) or workspace == Path.home():
        raise ValueError("job workspace must be a dedicated directory")
    return workspace


def database_path(job_dir: Path) -> Path:
    return workspace_path(job_dir) / "app.db"


def open_database(job_dir: Path) -> sqlite3.Connection:
    path = database_path(job_dir)
    if not path.is_file() or path.is_symlink():
        raise FileNotFoundError(
            f"current INSU Player database is unavailable: {path}; start the homepage first"
        )
    connection = sqlite3.connect(f"{path.as_uri()}?mode=rw", uri=True, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    application_id = int(connection.execute("PRAGMA application_id").fetchone()[0])
    schema_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
    if application_id != DATABASE_APPLICATION_ID or schema_version != DATABASE_SCHEMA_VERSION:
        connection.close()
        raise RuntimeError(
            "database does not match the current INSU Player contract; rebuild the workspace"
        )
    required = {"media_items", "operations", "operation_events"}
    tables = {
        str(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        )
    }
    if not required.issubset(tables):
        connection.close()
        raise RuntimeError("database does not match the current INSU Player schema")
    return connection


def default_status(
    job_dir: Path,
    video_id: str | None = None,
    *,
    source_url: str,
    source_kind: str,
) -> dict[str, Any]:
    resolved_id = validate_video_id(video_id or job_dir.name)
    if not source_url:
        raise ValueError("source URL is required")
    if source_kind not in REMOTE_SOURCE_KINDS:
        raise ValueError("source kind is invalid")
    now = utc_now()
    return {
        "schemaVersion": SCHEMA_VERSION,
        "videoId": resolved_id,
        "title": resolved_id,
        "sourceUrl": source_url,
        "sourceKind": source_kind,
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


def load_status(job_dir: Path) -> dict[str, Any]:
    path = database_path(job_dir)
    with closing(open_database(job_dir)) as connection:
        row = connection.execute(
            "SELECT record_json FROM media_items WHERE video_id = ?",
            (job_dir.resolve().name,),
        ).fetchone()
    if row is None:
        raise FileNotFoundError(f"media item not found: {job_dir.resolve().name}")
    data = json.loads(str(row["record_json"]))
    if not isinstance(data, dict):
        raise ValueError("media item record is not a JSON object")
    if data.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(f"media item record must use schemaVersion {SCHEMA_VERSION}")
    required_fields = {
        "schemaVersion",
        "videoId",
        "title",
        "sourceUrl",
        "sourceKind",
        "durationSeconds",
        "state",
        "stage",
        "progress",
        "message",
        "assets",
        "subtitleArtifacts",
        "activeSubtitleTracks",
        "subtitlePipeline",
        "transcription",
        "process",
        "lastError",
        "createdAt",
        "updatedAt",
        "completedAt",
        "history",
    }
    if set(data) != required_fields:
        raise ValueError("media item record fields do not match the current schema")
    if not isinstance(data.get("title"), str) or not data["title"].strip():
        raise ValueError(f"job state title is invalid: {path}")
    if data.get("sourceKind") not in SOURCE_KINDS:
        raise ValueError(f"job state sourceKind is invalid: {path}")
    if data["sourceKind"] == "local-file":
        if data.get("sourceUrl") is not None:
            raise ValueError(f"job state sourceUrl is invalid: {path}")
    elif not isinstance(data.get("sourceUrl"), str) or not data["sourceUrl"].strip():
        raise ValueError(f"job state sourceUrl is invalid: {path}")
    if not isinstance(data.get("message"), str) or not data["message"].strip():
        raise ValueError(f"job state message is invalid: {path}")
    validate_timestamp(data.get("createdAt"), "job state createdAt")
    validate_timestamp(data.get("updatedAt"), "job state updatedAt")
    completed_at = data.get("completedAt")
    if completed_at is not None:
        validate_timestamp(completed_at, "job state completedAt")
    if data.get("lastError") is not None and not isinstance(data.get("lastError"), str):
        raise ValueError(f"job state lastError is invalid: {path}")
    duration = data.get("durationSeconds")
    if duration is not None and (
        isinstance(duration, bool)
        or not isinstance(duration, (int, float))
        or not math.isfinite(float(duration))
        or float(duration) <= 0
    ):
        raise ValueError(f"job state durationSeconds is invalid: {path}")
    if not isinstance(data.get("assets"), dict):
        raise ValueError(f"job state must contain assets: {path}")
    for name, asset in data["assets"].items():
        if (
            not isinstance(name, str)
            or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}", name)
            or not isinstance(asset, dict)
            or set(asset) != {"path", "bytes", "updatedAt"}
            or not isinstance(asset.get("path"), str)
            or not asset["path"]
            or Path(asset["path"]).is_absolute()
            or ".." in Path(asset["path"]).parts
            or (
                asset.get("bytes") is not None
                and (
                    isinstance(asset.get("bytes"), bool)
                    or not isinstance(asset.get("bytes"), int)
                    or asset["bytes"] < 0
                )
            )
        ):
            raise ValueError(f"job state asset metadata is invalid: {path}")
        validate_timestamp(asset.get("updatedAt"), f"job asset {name}.updatedAt")
    process = data.get("process")
    if process is not None:
        if (
            not isinstance(process, dict)
            or set(process) != {"pid", "startedAt", "command"}
            or isinstance(process.get("pid"), bool)
            or not isinstance(process.get("pid"), int)
            or process["pid"] <= 0
            or not isinstance(process.get("command"), str)
            or not process["command"].strip()
        ):
            raise ValueError(f"job state process metadata is invalid: {path}")
        validate_timestamp(process.get("startedAt"), "job state process.startedAt")
    validate_subtitle_artifacts(job_dir, data.get("subtitleArtifacts"))
    if not isinstance(data.get("activeSubtitleTracks"), dict):
        raise ValueError(f"job state must contain activeSubtitleTracks: {path}")
    for language, track_id in data["activeSubtitleTracks"].items():
        if (
            not isinstance(language, str)
            or not LANGUAGE_PATTERN.fullmatch(language)
            or not isinstance(track_id, str)
            or not ARTIFACT_ID_PATTERN.fullmatch(track_id)
        ):
            raise ValueError(f"job state contains an invalid active subtitle track: {path}")
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
            "service",
            "model",
            "languageTag",
            "engineLanguage",
            "updatedAt",
        }
        if unknown:
            raise ValueError(f"job state transcription contains unsupported fields: {path}")
        validate_processor_payload(
            {
                "provider": transcription.get("provider"),
                "service": transcription.get("service"),
                "model": transcription.get("model"),
            },
            label="transcription.processor",
            timing_only=True,
        )
        language_tag = validate_language(str(transcription.get("languageTag", "")))
        engine_language = transcription.get("engineLanguage")
        if language_tag == "und":
            if engine_language is not None:
                raise ValueError(f"und transcription cannot have engineLanguage: {path}")
        elif not isinstance(engine_language, str) or not re.fullmatch(r"[a-z]{2,3}", engine_language):
            raise ValueError(f"job state transcription engineLanguage is invalid: {path}")
        if not isinstance(transcription.get("updatedAt"), str):
            raise ValueError(f"job state transcription updatedAt is missing: {path}")
        validate_timestamp(transcription["updatedAt"], "transcription.updatedAt")
    pipeline = data.get("subtitlePipeline")
    if pipeline is not None:
        if not isinstance(pipeline, dict):
            raise ValueError(f"job state subtitlePipeline must be an object: {path}")
        allowed_pipeline_fields = {
            "mode",
            "stage",
            "sourceLanguage",
            "outputLanguage",
            "timingProcessor",
            "contentProcessor",
            "segmentationProcessor",
            "manualReferenceArtifactIds",
            "updatedAt",
        }
        unknown_pipeline_fields = sorted(set(pipeline) - allowed_pipeline_fields)
        if unknown_pipeline_fields:
            raise ValueError(
                f"subtitlePipeline contains unsupported fields {unknown_pipeline_fields}: {path}"
            )
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
        if not all(
            isinstance(artifact_id, str)
            and ARTIFACT_ID_PATTERN.fullmatch(artifact_id)
            for artifact_id in pipeline["manualReferenceArtifactIds"]
        ):
            raise ValueError(f"subtitlePipeline references are invalid: {path}")
        validate_timestamp(pipeline.get("updatedAt"), "subtitlePipeline.updatedAt")
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
            or set(entry) != {"at", "state", "stage", "message"}
            or entry.get("state") not in STATES
            or not isinstance(entry.get("stage"), str)
            or not JOB_STAGE_PATTERN.fullmatch(entry["stage"])
            or not isinstance(entry.get("message"), str)
            or not entry["message"].strip()
        ):
            raise ValueError(f"job state contains an invalid history entry: {path}")
        validate_timestamp(entry.get("at"), "job history at")
    return data


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
    history = status.get("history")
    if not isinstance(history, list):
        raise ValueError("job state history must be an array")
    if len(history) > 120:
        status["history"] = history[-120:]
    serialized = json.dumps(status, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    now = status["updatedAt"]
    with closing(open_database(job_dir)) as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute(
                """
                INSERT INTO media_items (
                  video_id, title, source_url, state, effective_state, stage,
                  progress, message, created_at, updated_at, completed_at,
                  last_error, watchable, size_bytes, thumbnail_url, watch_url,
                  has_log, duration_seconds, record_json, record_revision,
                  projected_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL, NULL, 0, ?, ?, 1, ?)
                ON CONFLICT(video_id) DO UPDATE SET
                  title = excluded.title,
                  source_url = excluded.source_url,
                  state = excluded.state,
                  effective_state = excluded.effective_state,
                  stage = excluded.stage,
                  progress = excluded.progress,
                  message = excluded.message,
                  created_at = excluded.created_at,
                  updated_at = excluded.updated_at,
                  completed_at = excluded.completed_at,
                  last_error = excluded.last_error,
                  duration_seconds = excluded.duration_seconds,
                  record_json = excluded.record_json,
                  record_revision = media_items.record_revision + 1,
                  projected_at = excluded.projected_at
                """,
                (
                    status["videoId"],
                    status["title"],
                    status["sourceUrl"],
                    status["state"],
                    status["state"],
                    status["stage"],
                    status["progress"],
                    status["message"],
                    status["createdAt"],
                    status["updatedAt"],
                    status["completedAt"],
                    status["lastError"],
                    status["durationSeconds"],
                    serialized,
                    now,
                ),
            )
            operation_id = f"{status['videoId']}:current"
            pipeline = status.get("subtitlePipeline")
            processor: dict[str, Any] = {}
            if isinstance(pipeline, dict):
                if status["state"] in {"transcribing", "needs_transcription"}:
                    candidate = pipeline.get("timingProcessor")
                elif status["state"] in {"segmenting", "needs_segmentation"}:
                    candidate = pipeline.get("segmentationProcessor")
                else:
                    candidate = pipeline.get("contentProcessor")
                if isinstance(candidate, dict):
                    processor = candidate
            if status["state"] in ACTIVE_STATES:
                operation_state = "running"
            elif status["state"].startswith("needs_") or status["state"] == "downloaded":
                operation_state = "needs_user"
            elif status["state"] == "ready":
                operation_state = "ready"
            elif status["state"] == "failed":
                operation_state = "failed"
            elif status["state"] == "interrupted":
                operation_state = "failed"
            else:
                operation_state = "queued"
            if "transcript" in status["stage"] or "transcrib" in status["state"]:
                operation_kind = "transcription"
            elif "proofread" in status["state"] or pipeline and pipeline.get("mode") == "proofread":
                operation_kind = "proofread"
            elif "translat" in status["state"] or pipeline and pipeline.get("mode") == "translate":
                operation_kind = "translation"
            elif "segment" in status["state"] or "segment" in status["stage"]:
                operation_kind = "segmentation"
            else:
                operation_kind = "ingestion"
            process = status.get("process") if isinstance(status.get("process"), dict) else {}
            connection.execute(
                """
                INSERT INTO operations (
                  id, video_id, parent_operation_id, kind, state, stage, progress,
                  message, processor_provider, processor_service, processor_model,
                  inputs_json, outputs_json, consent_json, resumable, attempt, pid,
                  error_code, error_message, created_at, started_at, updated_at,
                  completed_at
                ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', '{}', ?, 1, ?, NULL, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  kind = excluded.kind,
                  state = excluded.state,
                  stage = excluded.stage,
                  progress = excluded.progress,
                  message = excluded.message,
                  processor_provider = excluded.processor_provider,
                  processor_service = excluded.processor_service,
                  processor_model = excluded.processor_model,
                  resumable = excluded.resumable,
                  pid = excluded.pid,
                  error_message = excluded.error_message,
                  started_at = COALESCE(operations.started_at, excluded.started_at),
                  updated_at = excluded.updated_at,
                  completed_at = excluded.completed_at
                """,
                (
                    operation_id,
                    status["videoId"],
                    operation_kind,
                    operation_state,
                    status["stage"],
                    status["progress"],
                    status["message"],
                    processor.get("provider"),
                    processor.get("service"),
                    processor.get("model"),
                    1 if operation_state in {"running", "failed", "needs_user"} else 0,
                    process.get("pid"),
                    status.get("lastError"),
                    status["createdAt"],
                    process.get("startedAt"),
                    status["updatedAt"],
                    status.get("completedAt"),
                ),
            )
            last_event = connection.execute(
                "SELECT state, stage, progress, message FROM operation_events WHERE operation_id = ? ORDER BY sequence DESC LIMIT 1",
                (operation_id,),
            ).fetchone()
            event_signature = (
                operation_state,
                status["stage"],
                float(status["progress"]),
                status["message"],
            )
            if last_event is None or tuple(last_event) != event_signature:
                sequence = int(
                    connection.execute(
                        "SELECT COALESCE(MAX(sequence), -1) + 1 FROM operation_events WHERE operation_id = ?",
                        (operation_id,),
                    ).fetchone()[0]
                )
                connection.execute(
                    "INSERT INTO operation_events (operation_id, sequence, type, state, stage, progress, message, data_json, created_at) VALUES (?, ?, 'state', ?, ?, ?, ?, '{}', ?)",
                    (
                        operation_id,
                        sequence,
                        operation_state,
                        status["stage"],
                        status["progress"],
                        status["message"],
                        status["updatedAt"],
                    ),
                )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return status


def initialize_job(
    job_dir: Path,
    video_id: str,
    source_url: str,
    source_kind: str,
    title: str,
    duration_seconds: float | None = None,
) -> dict[str, Any]:
    validate_video_id(video_id)
    job_dir.mkdir(parents=True, exist_ok=True)
    try:
        status = load_status(job_dir)
    except FileNotFoundError:
        status = default_status(
            job_dir,
            video_id,
            source_url=source_url,
            source_kind=source_kind,
        )
    status.update(
        {
            "videoId": video_id,
            "sourceUrl": source_url,
            "sourceKind": source_kind,
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


def link_download_item(job_dir: Path, queue_item_id: str) -> dict[str, Any]:
    if not QUEUE_ITEM_ID_PATTERN.fullmatch(queue_item_id):
        raise ValueError("download queue item ID is invalid")
    status = load_status(job_dir)
    with closing(open_database(job_dir)) as connection:
        try:
            connection.execute("BEGIN IMMEDIATE")
            item = connection.execute(
                "SELECT operation_id, page_url, video_id FROM download_queue_items WHERE id = ?",
                (queue_item_id,),
            ).fetchone()
            if item is None:
                raise ValueError("download queue item does not exist")
            if str(item["page_url"]) != status["sourceUrl"]:
                raise ValueError("download queue item source does not match the media record")
            linked_video_id = item["video_id"]
            if linked_video_id is not None and str(linked_video_id) != status["videoId"]:
                raise ValueError("download queue item is already linked to another media record")
            connection.execute(
                "UPDATE download_queue_items SET video_id = ? WHERE id = ?",
                (status["videoId"], queue_item_id),
            )
            connection.execute(
                "UPDATE operations SET video_id = ?, outputs_json = ? WHERE id = ?",
                (
                    status["videoId"],
                    json.dumps({"videoId": status["videoId"]}, separators=(",", ":")),
                    str(item["operation_id"]),
                ),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return status


def patch_status(
    job_dir: Path,
    patch: dict[str, Any],
    *,
    record_history: bool = False,
) -> dict[str, Any]:
    status = load_status(job_dir)
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
        status["history"].append(
            {
                "at": utc_now(),
                "state": status.get("state"),
                "stage": status.get("stage"),
                "message": status.get("message"),
            }
        )
    return save_status(job_dir, status)


def set_asset(job_dir: Path, name: str, path: Path) -> dict[str, Any]:
    status = load_status(job_dir)
    assets = status["assets"]
    assets[name] = {
        "path": relative_job_path(job_dir, path),
        "bytes": path.stat().st_size if path.exists() and path.is_file() else None,
        "updatedAt": utc_now(),
    }
    return save_status(job_dir, status)


def remove_asset(job_dir: Path, name: str) -> dict[str, Any]:
    status = load_status(job_dir)
    assets = status["assets"]
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
            processor["provider"] not in TIMING_PROCESSOR_PROVIDERS
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
        if processor.get("provider") != "agent" or processor.get("service") != "codex" or processor.get("model") is not None:
            raise ValueError(f"{kind} artifacts must use agent / codex")
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

    status = load_status(job_dir)
    artifacts = status["subtitleArtifacts"]
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
        content_sources = resolved_dependencies["content-source"]
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
        if kind in {"proofread", "translation"}:
            if content_parents or len(content_sources) != 1:
                raise ValueError(
                    "content revisions require one content source and no content parent"
                )
            content_source = content_sources[0]
            if kind == "proofread":
                if content_source.get("id") != timing_sources[0].get("id"):
                    raise ValueError(
                        "proofread content source must be its model transcript"
                    )
            elif content_source.get("kind") == "source":
                if content_source.get("id") != timing_sources[0].get("id"):
                    raise ValueError(
                        "direct translation content source must be its model transcript"
                    )
            elif (
                content_source.get("kind") != "proofread"
                or content_source.get("sourceLanguage") != source_language
                or content_source.get("outputLanguage") != source_language
            ):
                raise ValueError(
                    "translation content source must be a matching proofread artifact"
                )
            if content_source.get("kind") == "proofread" and references:
                raise ValueError(
                    "translation inherits text references from its proofread content source"
                )
        if kind == "segmentation":
            if content_sources or references or len(content_parents) != 1:
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
    service: str,
    model: str | None,
    language_tag: str,
    engine_language: str | None,
) -> dict[str, Any]:
    processor = processor_identity(
        provider,
        service,
        model,
        label="transcription.processor",
        timing_only=True,
    )
    assert processor is not None
    language_tag = validate_language(language_tag)
    if language_tag == "und":
        if engine_language is not None:
            raise ValueError("und transcription cannot have an engine language")
    elif not isinstance(engine_language, str) or not re.fullmatch(r"[a-z]{2,3}", engine_language):
        raise ValueError("resolved transcription requires an engine language")
    status = load_status(job_dir)
    status["transcription"] = {
        "provider": provider,
        "service": processor["service"],
        "model": model,
        "languageTag": language_tag,
        "engineLanguage": engine_language,
        "updatedAt": utc_now(),
    }
    return save_status(job_dir, status)


def clear_transcription(job_dir: Path) -> dict[str, Any]:
    status = load_status(job_dir)
    status["transcription"] = None
    return save_status(job_dir, status)


def reset_transcription_for_retry(job_dir: Path) -> dict[str, Any]:
    status = load_status(job_dir)
    state = status.get("state")
    stage = status.get("stage")
    if stage == "cleanup" and state == "failed":
        previous = next(
            (
                entry
                for entry in reversed(status["history"])
                if entry.get("stage") != "cleanup"
            ),
            None,
        )
        if not previous or (
            previous.get("state") not in {"failed", "interrupted"}
            or previous.get("stage") != "model_transcription"
        ):
            raise ValueError(
                "failed / cleanup does not have a preceding model_transcription failure"
            )
    elif state not in {"failed", "interrupted"} or stage != "model_transcription":
        raise ValueError(
            "transcription retry requires failed or interrupted / model_transcription"
        )
    for artifact in status["subtitleArtifacts"]:
        if (
            artifact.get("kind") == "source"
            and artifact.get("sourceType") == "model-transcript"
            and artifact.get("lifecycleState") == "ready"
            and artifact.get("validationState") == "valid"
            and artifact.get("freshnessState") == "current"
        ):
            raise ValueError("a current valid model transcript already exists")
    status["state"] = "needs_transcription"
    status["stage"] = "model_transcription"
    status["progress"] = 0.0
    status["message"] = "已清理未完成的轉錄，可重新開始語音辨識"
    status["lastError"] = None
    status["transcription"] = None
    status["process"] = None
    status["completedAt"] = None
    status["history"].append(
        {
            "at": utc_now(),
            "state": status["state"],
            "stage": status["stage"],
            "message": status["message"],
        }
    )
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
        agent_only=True,
    )
    segmentation_processor = processor_identity(
        segmentation_processor_provider,
        segmentation_processor_service,
        segmentation_processor_model,
        label="segmentation processor",
        optional=True,
        agent_only=True,
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
    status = load_status(job_dir)
    status["subtitlePipeline"] = pipeline
    return save_status(job_dir, status)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init", help="create or refresh a job record")
    init_parser.add_argument("--job-dir", required=True, type=Path)
    init_parser.add_argument("--video-id", required=True)
    init_parser.add_argument("--source-url", required=True)
    init_parser.add_argument("--source-kind", required=True, choices=sorted(REMOTE_SOURCE_KINDS))
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
    transcription_parser.add_argument(
        "--provider", required=True, choices=sorted(TIMING_PROCESSOR_PROVIDERS)
    )
    transcription_parser.add_argument("--service", required=True)
    transcription_parser.add_argument("--model")
    transcription_parser.add_argument("--language-tag", required=True)
    transcription_parser.add_argument("--engine-language")

    transcription_clear_parser = subparsers.add_parser(
        "transcription-clear", help="clear stale transcription metadata before a new run"
    )
    transcription_clear_parser.add_argument("--job-dir", required=True, type=Path)

    transcription_retry_parser = subparsers.add_parser(
        "transcription-retry",
        help="reset an exact failed or interrupted transcription for retry",
    )
    transcription_retry_parser.add_argument("--job-dir", required=True, type=Path)

    processor_contract_parser = subparsers.add_parser(
        "processor-contract",
        help="validate one timing processor identity without mutating a job",
    )
    processor_contract_parser.add_argument(
        "--provider", required=True, choices=sorted(TIMING_PROCESSOR_PROVIDERS)
    )
    processor_contract_parser.add_argument("--service", required=True)
    processor_contract_parser.add_argument("--model")

    pipeline_parser = subparsers.add_parser(
        "subtitle-pipeline", help="record the visible subtitle pipeline stage"
    )
    pipeline_parser.add_argument("--job-dir", required=True, type=Path)
    pipeline_parser.add_argument("--mode", required=True, choices=sorted(SUBTITLE_PIPELINE_MODES))
    pipeline_parser.add_argument("--stage", required=True, choices=sorted(SUBTITLE_PIPELINE_STAGES))
    pipeline_parser.add_argument("--source-language", required=True)
    pipeline_parser.add_argument("--output-language", required=True)
    pipeline_parser.add_argument(
        "--timing-processor-provider", choices=sorted(TIMING_PROCESSOR_PROVIDERS)
    )
    pipeline_parser.add_argument("--timing-processor-service")
    pipeline_parser.add_argument("--timing-processor-model")
    pipeline_parser.add_argument("--content-processor-provider", choices=sorted(PROCESSOR_PROVIDERS))
    pipeline_parser.add_argument("--content-processor-service")
    pipeline_parser.add_argument("--content-processor-model")
    pipeline_parser.add_argument("--segmentation-processor-provider", choices=sorted(PROCESSOR_PROVIDERS))
    pipeline_parser.add_argument("--segmentation-processor-service")
    pipeline_parser.add_argument("--segmentation-processor-model")
    pipeline_parser.add_argument("--manual-reference-artifact", action="append", default=[])

    link_parser = subparsers.add_parser(
        "link-download", help="link one explicit queue item to its resolved media ID"
    )
    link_parser.add_argument("--job-dir", required=True, type=Path)
    link_parser.add_argument("--queue-item-id", required=True)

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
            args.source_kind,
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
            args.service,
            args.model,
            args.language_tag,
            args.engine_language,
        )
    elif args.command == "transcription-clear":
        status = clear_transcription(args.job_dir)
    elif args.command == "transcription-retry":
        status = reset_transcription_for_retry(args.job_dir)
    elif args.command == "processor-contract":
        identity = processor_identity(
            args.provider,
            args.service,
            args.model,
            label="timing processor",
            timing_only=True,
        )
        print(json.dumps(identity, ensure_ascii=False, sort_keys=True))
        return 0
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
    elif args.command == "link-download":
        status = link_download_item(args.job_dir, args.queue_item_id)
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
