from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from current_database import create_current_database, read_media_record, write_media_record


ROOT = Path(__file__).resolve().parents[1]
MIGRATE = (
    ROOT
    / "plugins"
    / "insu-player"
    / "skills"
    / "migrate-player-library"
    / "scripts"
    / "migrate_library.py"
)


def media_record(schema_version: int) -> dict[str, object]:
    return {
        "schemaVersion": schema_version,
        "videoId": "video-one",
        "title": "Video One",
        "sourceUrl": "https://example.test/video-one",
        "sourceKind": "page",
        "durationSeconds": 12,
        "state": "ready",
        "stage": "complete",
        "progress": 100,
        "message": "已完成",
        "assets": {},
        "subtitleArtifacts": [],
        "activeSubtitleTracks": {},
        "subtitlePipeline": None,
        "transcription": None,
        "process": None,
        "lastError": None,
        "createdAt": "2026-08-12T00:00:00Z",
        "updatedAt": "2026-08-12T00:00:00Z",
        "completedAt": "2026-08-12T00:00:00Z",
        "history": [],
    }


class PlayerLibraryMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.project = Path(self.temporary.name) / "project"
        self.workspace = self.project / ".local" / "insu-player"
        self.jobs = self.workspace / "jobs"
        (self.jobs / "video-one").mkdir(parents=True)
        (self.jobs / "video-one" / "video.mp4").write_bytes(b"video")
        (self.workspace / ".insu-provider-session.json").write_text(
            '{"token":"must-not-appear"}\n', encoding="utf-8"
        )
        cookie_sessions = (
            self.workspace / ".agent-tools" / "insu-player" / "tmp" / "cookie-sessions"
        )
        cookie_sessions.mkdir(parents=True)
        (cookie_sessions / "cookie.txt").write_text("secret", encoding="utf-8")
        imports = self.workspace / ".agent-tools" / "insu-player" / "tmp" / "imports"
        imports.mkdir(parents=True)
        (imports / "partial.bin").write_bytes(b"partial")
        create_current_database(self.workspace)
        write_media_record(self.workspace, media_record(2))
        connection = sqlite3.connect(self.workspace / "app.db")
        try:
            connection.execute("PRAGMA user_version = 8")
            connection.execute(
                "INSERT INTO playback_states (video_id, time, duration, updated_at) "
                "VALUES ('video-one', 7, 12, '2026-08-12T00:00:00Z')"
            )
            connection.execute(
                "INSERT INTO operations "
                "(id, video_id, kind, state, stage, updated_at, created_at) "
                "VALUES ('old-operation', 'video-one', 'download', 'completed', "
                "'complete', '2026-08-12T00:00:00Z', '2026-08-12T00:00:00Z')"
            )
            connection.execute(
                "INSERT INTO operation_events "
                "(operation_id, sequence, type, state, stage, created_at) "
                "VALUES ('old-operation', 1, 'complete', 'completed', 'complete', "
                "'2026-08-12T00:00:00Z')"
            )
            connection.execute(
                "INSERT INTO transcription_settings (id, model_id, updated_at) "
                "VALUES ('active', 'local.openai-whisper.medium', '2026-08-12T00:00:00Z')"
            )
            connection.commit()
        finally:
            connection.close()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_migration(self, command: str, *arguments: str, check: bool = True):
        return subprocess.run(
            [
                sys.executable,
                str(MIGRATE),
                command,
                "--project-root",
                str(self.project),
                "--workspace",
                str(self.workspace),
                *arguments,
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=check,
        )

    def test_semantic_transform_preview_execute_and_verify(self) -> None:
        first = json.loads(self.run_migration("preview").stdout)
        self.assertNotIn("must-not-appear", json.dumps(first))
        self.assertEqual(first["source"]["dataSchemaVersion"], 8)
        self.assertEqual(first["target"]["dataSchemaVersion"], 9)
        self.assertIn(
            "needs-media-record-transform",
            {blocker["code"] for blocker in first["blocked"]},
        )
        self.assertIn(
            "needs-transcription-selection-validation",
            {blocker["code"] for blocker in first["blocked"]},
        )
        self.assertEqual(
            next(
                action
                for action in first["tableActions"]
                if action["table"] == "operations"
            )["action"],
            "drop-and-rebuild",
        )

        prepared = json.loads(self.run_migration("prepare-bundle").stdout)
        self.assertEqual(prepared["tables"], ["media_items", "transcription_settings"])
        bundle_path = self.workspace / ".insu-player-migration-input.json"
        bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
        record = json.loads(bundle["tables"]["media_items"][0]["record_json"])
        record["schemaVersion"] = 3
        bundle["tables"]["media_items"][0]["record_json"] = json.dumps(
            record, ensure_ascii=False, separators=(",", ":")
        )
        bundle_path.write_text(
            json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

        plan = json.loads(self.run_migration("preview").stdout)
        self.assertEqual(plan["blocked"], [])
        self.assertEqual(
            next(
                action
                for action in plan["tableActions"]
                if action["table"] == "media_items"
            )["action"],
            "transform",
        )

        executed = json.loads(
            self.run_migration(
                "execute", "--plan-digest", plan["digest"], "--yes"
            ).stdout
        )
        self.assertEqual(executed["status"], "executed-and-verified")
        self.assertTrue(Path(executed["sourceBackup"]).is_file())
        self.assertFalse(bundle_path.exists())
        self.assertFalse((self.workspace / ".insu-provider-session.json").exists())
        self.assertEqual(
            list(
                (
                    self.workspace
                    / ".agent-tools"
                    / "insu-player"
                    / "tmp"
                    / "cookie-sessions"
                ).iterdir()
            ),
            [],
        )
        self.assertEqual(
            list(
                (
                    self.workspace / ".agent-tools" / "insu-player" / "tmp" / "imports"
                ).iterdir()
            ),
            [],
        )
        self.assertEqual(read_media_record(self.workspace, "video-one")["schemaVersion"], 3)

        connection = sqlite3.connect(self.workspace / "app.db")
        try:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 9)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM operations").fetchone()[0], 0)
            self.assertEqual(
                connection.execute(
                    "SELECT time FROM playback_states WHERE video_id = 'video-one'"
                ).fetchone()[0],
                7,
            )
            self.assertEqual(
                connection.execute(
                    "SELECT model_id FROM transcription_settings WHERE id = 'active'"
                ).fetchone()[0],
                "local.openai-whisper.medium",
            )
        finally:
            connection.close()
        connection = sqlite3.connect(self.workspace / "app.db")
        try:
            connection.execute(
                "INSERT INTO download_queue_settings (id, paused, concurrency, updated_at) "
                "VALUES ('global', 0, 2, '2026-08-12T00:00:01Z')"
            )
            connection.execute(
                "INSERT INTO runtime_capabilities (key, state, label, checked_at) "
                "VALUES ('bun', 'ready', 'Bun', '2026-08-12T00:00:01Z')"
            )
            connection.commit()
        finally:
            connection.close()
        verified = json.loads(self.run_migration("verify").stdout)
        self.assertTrue(verified["valid"])
        self.assertEqual(verified["database"]["mediaItems"], 1)

    def test_changed_source_rejects_confirmed_digest(self) -> None:
        record = media_record(3)
        write_media_record(self.workspace, record)
        connection = sqlite3.connect(self.workspace / "app.db")
        try:
            connection.execute("DELETE FROM transcription_settings")
            connection.commit()
        finally:
            connection.close()
        plan = json.loads(self.run_migration("preview").stdout)
        self.assertEqual(plan["blocked"], [])
        connection = sqlite3.connect(self.workspace / "app.db")
        try:
            connection.execute(
                "UPDATE playback_states SET time = 9 WHERE video_id = 'video-one'"
            )
            connection.commit()
        finally:
            connection.close()
        result = self.run_migration(
            "execute", "--plan-digest", plan["digest"], "--yes", check=False
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("migration plan changed", result.stdout)
        self.assertFalse((self.workspace / ".insu-player-migrations" / plan["digest"]).exists())


if __name__ == "__main__":
    unittest.main()
