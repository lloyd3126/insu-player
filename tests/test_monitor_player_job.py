from __future__ import annotations

import importlib.util
import json
import os
import sqlite3
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from current_database import create_current_database, write_media_record


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (
    REPO_ROOT
    / "plugins"
    / "insu-player"
    / "skills"
    / "monitor-player-job"
    / "scripts"
    / "inspect_player_job.py"
)
SPEC = importlib.util.spec_from_file_location("inspect_player_job", SCRIPT)
assert SPEC and SPEC.loader
inspect_player_job = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inspect_player_job)


def database_snapshot(path: Path) -> dict[str, list[tuple[object, ...]]]:
    connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
    try:
        tables = [
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        return {
            table: connection.execute(f'SELECT * FROM "{table}" ORDER BY rowid').fetchall()
            for table in tables
        }
    finally:
        connection.close()


class MonitorPlayerJobTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.project_root = Path(self.temporary.name) / "project"
        self.workspace = self.project_root / ".local" / "insu-player"
        self.video_id = "video_123"
        self.job_dir = self.workspace / "jobs" / self.video_id
        self.job_dir.mkdir(parents=True)
        self.database_path = create_current_database(self.workspace)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_status(self, **updates: object) -> dict[str, object]:
        status = inspect_player_job.JOB_STATE.default_status(
            self.job_dir,
            self.video_id,
            source_url="https://example.test/video",
            source_kind="page",
        )
        status.update(updates)
        write_media_record(self.workspace, status)
        return status

    def write_catalog(self, operation: dict[str, object] | None) -> Path:
        catalog = inspect_player_job.MEDIA_CATALOG.empty_catalog(self.video_id)
        catalog["operation"] = operation
        path = self.job_dir / "media-work" / "catalog.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return path

    def now_text(self) -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    def snapshot(self, **kwargs: object) -> dict[str, object]:
        return inspect_player_job.job_snapshot(
            self.job_dir,
            stale_after_seconds=int(kwargs.get("stale_after_seconds", 900)),
            now=kwargs.get("now", datetime.now(timezone.utc)),
        )

    def test_active_job_with_live_pid_is_monitored(self) -> None:
        self.write_status(
            state="transcribing",
            stage="model_transcription",
            progress=42.5,
            updatedAt=self.now_text(),
            process={"pid": os.getpid(), "command": "whisper", "startedAt": self.now_text()},
        )

        result = self.snapshot()

        self.assertEqual(result["classification"], "monitor")
        self.assertEqual(result["nextAction"], "wait")
        self.assertTrue(result["processAlive"])
        self.assertEqual(result["progress"], 42.5)

    def test_active_job_with_missing_or_stale_process_requires_diagnosis(self) -> None:
        old = datetime.now(timezone.utc) - timedelta(minutes=20)
        old_text = old.isoformat(timespec="seconds").replace("+00:00", "Z")
        self.write_status(
            state="downloading",
            stage="download",
            progress=20,
            updatedAt=old_text,
            process={"pid": os.getpid(), "command": "yt-dlp", "startedAt": old_text},
        )
        stale = self.snapshot()
        self.assertEqual(stale["classification"], "diagnose")
        self.assertEqual(stale["nextAction"], "inspect-stale-process")

        self.write_status(
            state="downloading",
            stage="download",
            progress=20,
            updatedAt=self.now_text(),
            process={"pid": 999_999_999, "command": "yt-dlp", "startedAt": self.now_text()},
        )
        missing = self.snapshot()
        self.assertEqual(missing["classification"], "diagnose")
        self.assertEqual(missing["nextAction"], "inspect-missing-process")

    def test_handoff_ready_and_queued_states_are_classified(self) -> None:
        expected_actions = {
            "downloaded": "ask-subtitle-mode",
            "needs_transcription": "transcribe",
            "needs_proofreading": "proofread",
            "needs_translation": "translate",
            "needs_segmentation": "segment",
        }
        for state, expected_action in expected_actions.items():
            with self.subTest(state=state):
                self.write_status(state=state, stage=state, updatedAt=self.now_text())
                snapshot = self.snapshot()
                self.assertEqual(snapshot["classification"], "continue-workflow")
                self.assertEqual(snapshot["nextAction"], expected_action)

        self.write_status(state="ready", stage="complete", progress=100, updatedAt=self.now_text())
        self.assertEqual(self.snapshot()["classification"], "complete")

        self.write_status(state="queued", stage="queued", updatedAt=self.now_text())
        self.assertEqual(self.snapshot()["classification"], "needs-user")

    def test_error_contents_are_not_returned(self) -> None:
        secret = "OPENAI_API_KEY=should-not-leak"
        self.write_status(
            state="failed",
            stage="openai",
            updatedAt=self.now_text(),
            lastError=secret,
        )

        result = self.snapshot()

        self.assertTrue(result["errorPresent"])
        self.assertNotIn(secret, json.dumps(result))

    def test_rendition_operation_is_classified_without_switching_quality(self) -> None:
        run_id = "quality-720p"
        operation = {
            "id": run_id,
            "requestedHeight": 720,
            "state": "downloading",
            "stage": "downloading",
            "progress": 35.0,
            "message": "下載中",
            "error": None,
            "pid": os.getpid(),
            "startedAt": self.now_text(),
            "updatedAt": self.now_text(),
            "completedAt": None,
        }
        self.write_status(state="ready", stage="complete", progress=100)
        self.write_catalog(operation)

        active = inspect_player_job.rendition_snapshot(
            self.job_dir,
            self.video_id,
            run_id=run_id,
            stale_after_seconds=900,
            now=datetime.now(timezone.utc),
        )
        self.assertEqual(active["classification"], "monitor")
        self.assertEqual(active["requestedHeight"], 720)

        operation.update(
            state="ready", stage="ready", progress=100.0, pid=None, completedAt=self.now_text()
        )
        self.write_catalog(operation)
        ready = inspect_player_job.rendition_snapshot(
            self.job_dir,
            self.video_id,
            run_id=run_id,
            stale_after_seconds=900,
            now=datetime.now(timezone.utc),
        )
        self.assertEqual(ready["classification"], "complete")
        self.assertEqual(ready["nextAction"], "verify-rendition-and-stop")

        mismatch = inspect_player_job.rendition_snapshot(
            self.job_dir,
            self.video_id,
            run_id="different-run",
            stale_after_seconds=900,
            now=datetime.now(timezone.utc),
        )
        self.assertEqual(mismatch["classification"], "needs-user")
        self.assertEqual(mismatch["nextAction"], "run-id-mismatch")

    def test_cli_is_read_only(self) -> None:
        self.write_status(state="ready", stage="complete", progress=100, updatedAt=self.now_text())
        before = database_snapshot(self.database_path)

        result = subprocess.run(
            [
                "python3",
                str(SCRIPT),
                "--project-root",
                str(self.project_root),
                "--workspace",
                str(self.workspace),
                "--video-id",
                self.video_id,
            ],
            check=True,
            capture_output=True,
            text=True,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )

        payload = json.loads(result.stdout)
        self.assertEqual(payload["classification"], "complete")
        self.assertEqual(before, database_snapshot(self.database_path))

    def test_rejects_legacy_schema_and_paths_outside_project(self) -> None:
        status = self.write_status(state="ready", stage="complete", progress=100)
        status["schemaVersion"] = 2
        write_media_record(self.workspace, status)
        with self.assertRaisesRegex(ValueError, "schemaVersion 3"):
            self.snapshot()

        outside = Path(self.temporary.name) / "outside"
        outside_job = outside / "jobs" / self.video_id
        outside_job.mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, "workspace must stay inside"):
            inspect_player_job.resolve_job_dir(self.project_root, outside, self.video_id)

        with self.assertRaisesRegex(ValueError, "invalid video ID"):
            inspect_player_job.resolve_job_dir(self.project_root, self.workspace, "../escape")

    def test_rejects_symlinked_job(self) -> None:
        self.job_dir.rmdir()
        target = self.project_root / "target-job"
        target.mkdir()
        self.job_dir.symlink_to(target, target_is_directory=True)

        with self.assertRaisesRegex(ValueError, "job is unavailable"):
            inspect_player_job.resolve_job_dir(
                self.project_root, self.workspace, self.video_id
            )


if __name__ == "__main__":
    unittest.main()
