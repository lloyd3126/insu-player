import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from current_database import create_current_database, write_media_record


ROOT = Path(__file__).resolve().parents[1]
RESET = (
    ROOT
    / "plugins"
    / "insu-player"
    / "skills"
    / "player-manager"
    / "scripts"
    / "reset_library.py"
)


class LibraryResetTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.project = Path(self.temporary.name) / "project"
        self.workspace = self.project / ".local" / "insu-player"
        self.jobs = self.workspace / "jobs"
        self.jobs.mkdir(parents=True)
        (self.project / "AGENTS.md").write_text("# test\n", encoding="utf-8")
        job = self.jobs / "video-one"
        job.mkdir()
        (job / "video.mp4").write_bytes(b"video")
        runtime = self.workspace / ".agent-tools" / "insu-player"
        (runtime / "bun-runtime").mkdir(parents=True)
        (runtime / "bun-runtime" / "bun").write_bytes(b"bun")
        (runtime / ".venv").mkdir()
        fake_python = runtime / ".venv" / "bin" / "python"
        fake_python.parent.mkdir()
        fake_python.write_text("#!/bin/sh\nprintf '{\"validated\": []}\\n'\n", encoding="utf-8")
        fake_python.chmod(0o755)
        validator = (
            self.project
            / "plugins"
            / "insu-player"
            / "skills"
            / "watch-video"
            / "scripts"
            / "validate-local-model.py"
        )
        validator.parent.mkdir(parents=True)
        validator.write_text("# test validator\n", encoding="utf-8")
        (runtime / "models").mkdir()
        (runtime / "models" / "medium.pt").write_bytes(b"model")
        imports = runtime / "tmp" / "imports" / "stale-import"
        imports.mkdir(parents=True)
        (imports / "upload.bin").write_bytes(b"partial")
        create_current_database(self.workspace)
        write_media_record(
            self.workspace,
            {
                "schemaVersion": 3,
                "videoId": "video-one",
                "title": "Video One",
                "sourceUrl": "https://example.test/video-one",
                "sourceKind": "page",
                "durationSeconds": 1,
                "state": "ready",
                "stage": "complete",
                "progress": 100,
                "message": "已完成",
                "createdAt": "2026-08-08T00:00:00Z",
                "updatedAt": "2026-08-08T00:00:00Z",
                "completedAt": "2026-08-08T00:00:00Z",
                "lastError": None,
                "process": None,
                "assets": {},
                "subtitlePipeline": None,
                "subtitleArtifacts": [],
                "activeSubtitleTracks": {},
                "transcription": None,
                "history": [],
            },
        )
        database = sqlite3.connect(self.workspace / "app.db")
        database.execute(
            """INSERT INTO subtitle_artifacts (
              id, video_id, kind, revision, lifecycle_state, validation_state,
              freshness_state, source_language, source_type, processor_provider,
              processor_service, target_frozen, checksum, warning_count,
              hard_defect_count, created_at
            ) VALUES ('subtitle-one', 'video-one', 'source', 1, 'ready', 'valid',
              'current', 'en', 'model-transcript', 'local', 'openai-whisper',
              0, ?, 0, 0, ?)""",
            ("0" * 64, "2026-08-08T00:00:00Z"),
        )
        database.commit()
        database.close()

    def tearDown(self):
        self.temporary.cleanup()

    def run_reset(self, command: str, *arguments: str, check: bool = True):
        return subprocess.run(
            [
                sys.executable,
                str(RESET),
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

    def test_preview_execute_and_verify_preserve_runtime_and_models(self):
        migration_archive = (
            self.workspace
            / ".insu-player-migrations"
            / "old-digest"
            / "source"
        )
        migration_archive.mkdir(parents=True)
        (migration_archive / "app.db").write_bytes(b"old")
        (self.workspace / ".insu-player-migration-input.json").write_text(
            "{}\n", encoding="utf-8"
        )
        preview = json.loads(self.run_reset("preview").stdout)
        self.assertEqual(preview["operation"], "reset-current-project-library")
        self.assertEqual(preview["database"]["tables"]["media_items"], 1)
        self.assertEqual(preview["database"]["tables"]["subtitle_artifacts"], 1)
        self.assertEqual(preview["database"]["tables"]["local_media_imports"], 0)
        self.assertEqual(preview["database"]["tables"]["subtitle_style_presets"], 0)
        self.assertEqual(preview["database"]["tables"]["subtitle_style_settings"], 0)
        self.assertEqual(
            preview["transientSessions"][".agent-tools/insu-player/tmp/imports"]["files"],
            1,
        )
        self.assertEqual(preview["apiKeyInspection"]["configuredNames"], [])
        self.assertEqual(
            preview["apiKeys"]["names"],
            [
                "OPENAI_API_KEY",
                "GROQ_API_KEY",
                "ELEVENLABS_API_KEY",
                "XAI_API_KEY",
                "OPENROUTER_API_KEY",
            ],
        )
        self.assertEqual(preview["blocked"], [])
        self.assertEqual(
            preview["migrationArchives"][".insu-player-migrations"]["files"],
            1,
        )
        self.assertRegex(preview["digest"], r"^[0-9a-f]{64}$")

        self.run_reset(
            "execute",
            "--plan-digest",
            preview["digest"],
            "--yes",
        )
        self.assertEqual(list(self.jobs.iterdir()), [])
        self.assertFalse((self.workspace / "app.db").exists())
        self.assertFalse((self.workspace / ".insu-player-migrations").exists())
        self.assertFalse((self.workspace / ".insu-player-migration-input.json").exists())
        self.assertEqual(
            list(
                (
                    self.workspace
                    / ".agent-tools"
                    / "insu-player"
                    / "tmp"
                    / "imports"
                ).iterdir()
            ),
            [],
        )
        self.assertTrue(
            (self.workspace / ".agent-tools/insu-player/bun-runtime/bun").is_file()
        )
        self.assertTrue(
            (self.workspace / ".agent-tools/insu-player/models/medium.pt").is_file()
        )
        verified = json.loads(self.run_reset("verify", check=False).stdout.split("\nerror:", 1)[0])
        self.assertFalse(verified["valid"])
        create_current_database(self.workspace)
        verified = json.loads(self.run_reset("verify").stdout)
        self.assertTrue(verified["valid"])
        self.assertEqual(verified["jobCount"], 0)
        self.assertTrue(verified["apiKeys"]["cleared"])

    def test_changed_jobs_require_a_new_preview_digest(self):
        preview = json.loads(self.run_reset("preview").stdout)
        (self.jobs / "video-one" / "new.log").write_text("changed", encoding="utf-8")
        result = self.run_reset(
            "execute",
            "--plan-digest",
            preview["digest"],
            "--yes",
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("reset plan changed", result.stdout)
        self.assertTrue((self.jobs / "video-one").is_dir())

    def test_preview_reports_only_configured_api_key_names(self):
        secret = "must-never-appear"

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "providers": [
                                {
                                    "id": "openai",
                                    "credentialName": "OPENAI_API_KEY",
                                    "configured": True,
                                    "value": secret,
                                },
                                {
                                    "id": "groq",
                                    "credentialName": "GROQ_API_KEY",
                                    "configured": False,
                                },
                            ],
                        }
                    ).encode("utf-8")
                )

            def log_message(self, _format, *args):
                del args

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            (self.workspace / ".insu-player-server.json").write_text(
                json.dumps(
                    {
                        "host": "127.0.0.1",
                        "port": server.server_port,
                        "pid": os.getpid(),
                    }
                ),
                encoding="utf-8",
            )
            output = self.run_reset("preview").stdout
            preview = json.loads(output)
            self.assertEqual(
                preview["apiKeyInspection"]["configuredNames"],
                ["OPENAI_API_KEY"],
            )
            self.assertNotIn(secret, output)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_workspace_outside_current_project_is_rejected(self):
        outside = Path(self.temporary.name) / "outside"
        (outside / "jobs").mkdir(parents=True)
        result = subprocess.run(
            [
                sys.executable,
                str(RESET),
                "preview",
                "--project-root",
                str(self.project),
                "--workspace",
                str(outside),
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exact .local/insu-player", result.stdout)


if __name__ == "__main__":
    unittest.main()
