from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
REMOVAL_SCRIPT = (
    REPO_ROOT
    / "plugins"
    / "insu-player"
    / "skills"
    / "video-library"
    / "scripts"
    / "remove_library_item.py"
)


class LibraryRemovalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary.name) / "workspace"
        self.job = self.workspace / "jobs" / "demo-video"
        (self.job / "source").mkdir(parents=True)
        (self.job / "captions").mkdir()
        (self.job / "source" / "video.mp4").write_bytes(b"video")
        (self.job / "captions" / "en.vtt").write_text(
            "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n",
            encoding="utf-8",
        )
        self.write_status()
        self.create_database()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_status(self, **overrides: object) -> None:
        payload: dict[str, object] = {
            "videoId": "demo-video",
            "title": "Demo Video",
            "state": "ready",
            "stage": "complete",
            "history": [],
        }
        payload.update(overrides)
        (self.job / "status.json").write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )

    def create_database(self) -> None:
        connection = sqlite3.connect(self.workspace / "app.db")
        try:
            connection.execute("PRAGMA foreign_keys = ON")
            connection.executescript(
                """
                CREATE TABLE jobs (
                  video_id TEXT PRIMARY KEY,
                  title TEXT NOT NULL
                );
                CREATE TABLE job_history (
                  id INTEGER PRIMARY KEY,
                  video_id TEXT NOT NULL REFERENCES jobs(video_id) ON DELETE CASCADE,
                  message TEXT
                );
                CREATE TABLE subtitle_tracks (
                  id INTEGER PRIMARY KEY,
                  video_id TEXT NOT NULL REFERENCES jobs(video_id) ON DELETE CASCADE,
                  language_code TEXT
                );
                INSERT INTO jobs(video_id, title) VALUES ('demo-video', 'Demo Video');
                INSERT INTO job_history(video_id, message) VALUES ('demo-video', 'ready');
                INSERT INTO subtitle_tracks(video_id, language_code) VALUES ('demo-video', 'en');
                """
            )
            connection.commit()
        finally:
            connection.close()

    def run_removal(
        self, command: str, *arguments: str, check: bool = True
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(REMOVAL_SCRIPT),
                command,
                str(self.workspace),
                "--kind",
                "video",
                "--video-id",
                "demo-video",
                *arguments,
            ],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=check,
        )

    def preview(self) -> dict[str, object]:
        return json.loads(self.run_removal("preview").stdout)

    def test_preview_is_read_only_and_reports_owned_files_and_database_rows(self) -> None:
        before = (self.job / "status.json").read_bytes()
        plan = self.preview()

        self.assertEqual(plan["schemaVersion"], 1)
        self.assertEqual(plan["target"]["videoId"], "demo-video")
        self.assertEqual(plan["filesystem"]["path"], "jobs/demo-video")
        self.assertEqual(plan["filesystem"]["files"], 3)
        self.assertEqual(plan["blocked"], [])
        self.assertRegex(plan["digest"], r"^[0-9a-f]{64}$")
        rows = {item["table"]: item["rows"] for item in plan["database"]["rows"]}
        self.assertEqual(rows, {"job_history": 1, "jobs": 1, "subtitle_tracks": 1})
        self.assertTrue(self.job.is_dir())
        self.assertEqual((self.job / "status.json").read_bytes(), before)

    def test_execute_rejects_a_stale_plan_digest(self) -> None:
        digest = self.preview()["digest"]
        (self.job / "new-note.txt").write_text("changed", encoding="utf-8")

        result = self.run_removal(
            "execute", "--plan-digest", str(digest), "--yes", check=False
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("removal plan is stale", result.stdout)
        self.assertTrue(self.job.is_dir())

    def test_live_processing_job_is_blocked(self) -> None:
        self.write_status(state="downloading", process={"pid": os.getpid()})
        plan = self.preview()

        self.assertEqual(plan["blocked"][0]["code"], "active-process")
        result = self.run_removal(
            "execute",
            "--plan-digest",
            str(plan["digest"]),
            "--yes",
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("removal plan is blocked", result.stdout)
        self.assertTrue(self.job.is_dir())

    def test_symbolic_link_is_blocked(self) -> None:
        external = Path(self.temporary.name) / "external.txt"
        external.write_text("keep", encoding="utf-8")
        os.symlink(external, self.job / "external-link")

        plan = self.preview()

        self.assertEqual(plan["blocked"][0]["code"], "unsafe-filesystem-entry")
        self.assertTrue(external.is_file())

    def test_status_identity_mismatch_is_blocked(self) -> None:
        self.write_status(videoId="different-video")

        plan = self.preview()

        self.assertEqual(plan["blocked"][0]["code"], "resource-identity-mismatch")
        self.assertTrue(self.job.is_dir())

    def test_confirmed_current_plan_removes_and_verifies_files_and_database(self) -> None:
        digest = self.preview()["digest"]
        execution = json.loads(
            self.run_removal(
                "execute", "--plan-digest", str(digest), "--yes"
            ).stdout
        )

        self.assertEqual(execution["planDigest"], digest)
        self.assertTrue(execution["verification"]["removed"])
        self.assertFalse(self.job.exists())
        verification = json.loads(self.run_removal("verify").stdout)
        self.assertTrue(verification["removed"])
        self.assertEqual(verification["databaseRows"], [
            {"delete": "cascade", "rows": 0, "table": "job_history"},
            {"delete": "primary", "rows": 0, "table": "jobs"},
            {"delete": "cascade", "rows": 0, "table": "subtitle_tracks"},
        ])


if __name__ == "__main__":
    unittest.main()
