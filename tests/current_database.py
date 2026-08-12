from __future__ import annotations

import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA = (
    ROOT
    / "plugins"
    / "insu-player"
    / "skills"
    / "watch-video"
    / "assets"
    / "server"
    / "current-schema.sql"
)


def create_current_database(workspace: Path) -> Path:
    workspace.mkdir(parents=True, exist_ok=True)
    path = workspace / "app.db"
    connection = sqlite3.connect(path)
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(SCHEMA.read_text(encoding="utf-8"))
        connection.execute("PRAGMA application_id = 0x494e5355")
        connection.execute("PRAGMA user_version = 9")
        connection.commit()
    finally:
        connection.close()
    return path


def read_media_record(workspace: Path, video_id: str) -> dict[str, object]:
    connection = sqlite3.connect(workspace / "app.db")
    try:
        row = connection.execute(
            "SELECT record_json FROM media_items WHERE video_id = ?", (video_id,)
        ).fetchone()
    finally:
        connection.close()
    if row is None:
        raise AssertionError(f"media record not found: {video_id}")
    import json

    return json.loads(row[0])


def write_media_record(workspace: Path, record: dict[str, object]) -> None:
    import json

    video_id = str(record["videoId"])
    connection = sqlite3.connect(workspace / "app.db")
    try:
        connection.execute(
            """
            INSERT INTO media_items (
              video_id, title, source_url, state, effective_state, stage,
              progress, message, created_at, updated_at, completed_at,
              last_error, watchable, size_bytes, duration_seconds, record_json,
              record_revision, projected_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?)
            ON CONFLICT(video_id) DO UPDATE SET
              title = excluded.title,
              source_url = excluded.source_url,
              state = excluded.state,
              effective_state = excluded.effective_state,
              stage = excluded.stage,
              progress = excluded.progress,
              message = excluded.message,
              updated_at = excluded.updated_at,
              completed_at = excluded.completed_at,
              last_error = excluded.last_error,
              duration_seconds = excluded.duration_seconds,
              record_json = excluded.record_json,
              record_revision = media_items.record_revision + 1,
              projected_at = excluded.projected_at
            """,
            (
                video_id,
                str(record.get("title") or video_id),
                record.get("sourceUrl"),
                str(record.get("state") or "queued"),
                str(record.get("state") or "queued"),
                str(record.get("stage") or "queued"),
                float(record.get("progress") or 0),
                str(record.get("message") or "尚未開始"),
                record.get("createdAt"),
                record.get("updatedAt"),
                record.get("completedAt"),
                record.get("lastError"),
                1 if str(record.get("state")) == "ready" else 0,
                record.get("durationSeconds"),
                json.dumps(record, ensure_ascii=False, separators=(",", ":")),
                str(record.get("updatedAt") or "1970-01-01T00:00:00Z"),
            ),
        )
        connection.commit()
    finally:
        connection.close()
