from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = REPO_ROOT / "plugins" / "insu-player" / "skills" / "watch-video"
SCRIPT_DIR = SKILL_DIR / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

from job_state import initialize_job, load_status, patch_status, set_subtitle  # noqa: E402
from environment_session import load_session_descriptor  # noqa: E402
from library_server import LibraryApplication  # noqa: E402
from prompt_library import load_prompt_library, save_prompt_library  # noqa: E402


SAMPLE_VTT = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n測試字幕\n"


class JobStateTests(unittest.TestCase):
    def test_initialize_and_patch_preserve_history(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            job_dir = Path(temporary) / "jobs" / "abc_123"
            initialize_job(job_dir, "abc_123", "https://example.test/watch?v=abc_123", "Example")
            patch_status(
                job_dir,
                {"state": "downloading", "stage": "video", "message": "下載中", "progress": 42},
                record_history=True,
            )
            status = load_status(job_dir)
            self.assertEqual(status["title"], "Example")
            self.assertEqual(status["progress"], 42.0)
            self.assertEqual(status["history"][-1]["state"], "downloading")
            self.assertFalse(any(job_dir.glob(".status.json.*.tmp")))

    def test_ready_state_is_complete(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            job_dir = Path(temporary) / "jobs" / "ready-id"
            initialize_job(job_dir, "ready-id", "https://example.test", "Ready")
            status = patch_status(job_dir, {"state": "ready", "progress": 12, "process": {"pid": 99}})
            self.assertEqual(status["progress"], 100.0)
            self.assertIsNotNone(status["completedAt"])
            self.assertIsNone(status["process"])


class LibraryApplicationTests(unittest.TestCase):
    def make_application(self, workspace: Path) -> LibraryApplication:
        return LibraryApplication(
            workspace,
            SKILL_DIR / "assets" / "library",
            SKILL_DIR / "assets" / "player",
        )

    def test_summary_and_player_config_use_normalized_assets(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            job_dir = workspace / "jobs" / "video-id"
            (job_dir / "source").mkdir(parents=True)
            (job_dir / "captions").mkdir()
            (job_dir / "source" / "video.mp4").write_bytes(b"video-bytes")
            caption = job_dir / "captions" / "zh-TW.vtt"
            caption.write_text(SAMPLE_VTT, encoding="utf-8")
            initialize_job(job_dir, "video-id", "https://example.test", "Sample video")
            set_subtitle(job_dir, "zh-TW", "ready", caption, "test", "繁體中文")
            patch_status(job_dir, {"state": "ready", "message": "完成"})

            application = self.make_application(workspace)
            summary = application.summarize_job(job_dir)
            config = application.player_config("video-id")
            self.assertTrue(summary["watchable"])
            self.assertEqual(summary["captionCodes"], ["zh-TW"])
            self.assertEqual(config["defaultLanguage"], "zh-TW")
            self.assertEqual(config["video"]["src"], "/media/video-id/video")
            self.assertEqual(summary["playback"]["time"], 0.0)

    def test_supported_sites_follow_workspace_ytdlp_extractors(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            yt_dlp = workspace / ".agent-tools" / "insu-player" / ".venv" / "bin" / "yt-dlp"
            yt_dlp.parent.mkdir(parents=True)
            yt_dlp.write_text(
                "#!/bin/sh\n"
                "case \"$*\" in\n"
                "  *--version*) printf '2026.08.08\\n' ;;\n"
                "  *--list-extractors*) printf 'youtube\\nvimeo\\ntwitch:vod\\nyoutube\\n' ;;\n"
                "  *) exit 2 ;;\n"
                "esac\n",
                encoding="utf-8",
            )
            yt_dlp.chmod(0o755)

            payload = self.make_application(workspace).supported_sites()
            self.assertTrue(payload["available"])
            self.assertEqual(payload["version"], "2026.08.08")
            self.assertEqual(payload["count"], 3)
            self.assertEqual(payload["extractors"], ["twitch:vod", "vimeo", "youtube"])

    def test_supported_sites_report_missing_workspace_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            payload = self.make_application(Path(temporary)).supported_sites()
            self.assertFalse(payload["available"])
            self.assertEqual(payload["extractors"], [])

    def test_prompt_library_is_agent_managed_and_served_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            self.assertEqual(load_prompt_library(workspace)["prompts"], [])
            saved = save_prompt_library(workspace, [{
                "id": "bilingual-review",
                "title": "雙語複習",
                "scenario": "切換原文與繁中字幕",
                "prompt": "請準備雙語字幕：VIDEO_URL",
                "updatedAt": "2026-08-08T00:00:00+00:00",
            }])
            payload = self.make_application(workspace).my_prompts()
            self.assertEqual(saved["prompts"], payload["prompts"])
            self.assertTrue(payload["available"])
            self.assertFalse(any(workspace.glob(".prompts.json.*.tmp")))

    def test_prompt_library_rejects_duplicate_ids(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            prompt = {
                "id": "same-id", "title": "提示", "scenario": "情境", "prompt": "內容",
                "updatedAt": "2026-08-08T00:00:00+00:00",
            }
            with self.assertRaises(ValueError):
                save_prompt_library(Path(temporary), [prompt, prompt])

    def test_model_inventory_reports_empty_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            payload = self.make_application(Path(temporary)).model_inventory()
            self.assertEqual(payload["local"]["models"], [])
            self.assertEqual(payload["local"]["modelCount"], 0)
            self.assertEqual(payload["local"]["totalSizeBytes"], 0)
            self.assertFalse(payload["local"]["providerInstalled"])
            self.assertFalse(payload["api"]["providerInstalled"])
            self.assertFalse(payload["api"]["keyConfigured"])
            self.assertEqual(payload["api"]["models"], [{"name": "whisper-1", "installed": False}])

    def test_model_inventory_uses_actual_workspace_files_and_lock(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {"OPENAI_API_KEY": "configured-for-test"}):
            workspace = Path(temporary)
            runtime = workspace / ".agent-tools" / "insu-player"
            models = runtime / "models"
            whisper = runtime / ".venv" / "bin" / "whisper"
            models.mkdir(parents=True)
            whisper.parent.mkdir(parents=True)
            whisper.write_text("#!/bin/sh\n", encoding="utf-8")
            whisper.chmod(0o755)
            model_bytes = b"model-bytes" * 173
            (models / "turbo.pt").write_bytes(model_bytes)
            (models / "download.tmp").write_bytes(b"partial")
            (runtime / "requirements.lock.txt").write_text(
                "openai-whisper==20250625\nopenai==2.8.1\n",
                encoding="utf-8",
            )

            payload = self.make_application(workspace).model_inventory()
            self.assertTrue(payload["local"]["providerInstalled"])
            self.assertEqual(payload["local"]["packageVersion"], "20250625")
            self.assertEqual(payload["local"]["modelCount"], 1)
            self.assertEqual(payload["local"]["totalSizeBytes"], len(model_bytes))
            self.assertEqual(payload["local"]["models"], [{
                "name": "turbo", "sizeBytes": len(model_bytes), "ready": True,
            }])
            self.assertTrue(payload["api"]["providerInstalled"])
            self.assertEqual(payload["api"]["packageVersion"], "2.8.1")
            self.assertTrue(payload["api"]["keyConfigured"])
            self.assertEqual(payload["api"]["models"], [{"name": "whisper-1", "installed": True}])

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_model_inventory_ignores_symlinked_model(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            models = workspace / ".agent-tools" / "insu-player" / "models"
            models.mkdir(parents=True)
            outside = workspace / "outside.pt"
            outside.write_bytes(b"not-workspace-owned")
            os.symlink(outside, models / "linked.pt")
            self.assertEqual(self.make_application(workspace).model_inventory()["local"]["models"], [])

    def test_environment_value_stays_in_process_and_public_status_is_masked(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            application = self.make_application(Path(temporary))
            secret_value = "test-session-secret-value"
            initial = application.environment_status()
            self.assertFalse(initial["variables"][0]["configured"])

            configured = application.set_environment_variable({
                "name": "OPENAI_API_KEY",
                "value": secret_value,
            })
            self.assertTrue(configured["variables"][0]["configured"])
            self.assertEqual(configured["variables"][0]["source"], "session")
            self.assertNotIn(secret_value, json.dumps(configured))
            self.assertEqual(
                application.session_environment_value("OPENAI_API_KEY", f"Bearer {application.session_token}"),
                secret_value,
            )
            with self.assertRaises(FileNotFoundError):
                application.session_environment_value("OPENAI_API_KEY", "Bearer wrong-token")

            cleared = application.clear_environment_variable("OPENAI_API_KEY")
            self.assertFalse(cleared["variables"][0]["configured"])
            self.assertNotIn("OPENAI_API_KEY", os.environ)

    def test_environment_session_descriptor_is_private_and_removable(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            application = self.make_application(workspace)
            descriptor_path = application.write_session_descriptor("127.0.0.1", 8000)
            self.assertEqual(descriptor_path.stat().st_mode & 0o077, 0)
            descriptor = load_session_descriptor(workspace)
            self.assertEqual(descriptor["port"], 8000)
            self.assertEqual(descriptor["token"], application.session_token)
            self.assertNotIn("OPENAI_API_KEY", descriptor_path.read_text(encoding="utf-8"))
            application.remove_session_descriptor()
            self.assertFalse(descriptor_path.exists())

    def test_port_conflict_keeps_the_selected_workspace_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, socket.socket() as occupied_port:
            workspace = Path(temporary) / "selected-workspace"
            occupied_port.bind(("127.0.0.1", 0))
            occupied_port.listen()
            port = occupied_port.getsockname()[1]
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT_DIR / "library_server.py"),
                    "--workspace",
                    str(workspace),
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                    "--pid-file",
                    str(workspace / ".insu-player-server.pid"),
                ],
                cwd=REPO_ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                check=False,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn(f"port {port} is already in use", result.stdout)
            self.assertIn(str(workspace.resolve()), result.stdout)
            self.assertIn("do not reuse another workspace", result.stdout)

    def test_environment_rejects_unlisted_names_and_control_characters(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            application = self.make_application(Path(temporary))
            with self.assertRaises(ValueError):
                application.set_environment_variable({"name": "PATH", "value": "/tmp/example"})
            with self.assertRaises(ValueError):
                application.set_environment_variable({"name": "OPENAI_API_KEY", "value": "line-one\nline-two"})

    def test_playback_state_is_validated_and_written_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            job_dir = workspace / "jobs" / "progress-id"
            initialize_job(job_dir, "progress-id", "https://example.test", "Progress")
            application = self.make_application(workspace)
            saved = application.save_playback_state("progress-id", {"time": 42.1254, "duration": 120.0})
            self.assertEqual(saved["time"], 42.125)
            self.assertEqual(application.playback_state(job_dir)["duration"], 120.0)
            self.assertFalse(any(job_dir.glob(".ui-state.json.*.tmp")))
            with self.assertRaises(ValueError):
                application.save_playback_state("progress-id", {"time": 999, "duration": 10})

    def test_stale_active_job_is_reported_as_interrupted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            job_dir = workspace / "jobs" / "stale-id"
            initialize_job(job_dir, "stale-id", "https://example.test", "Stale")
            patch_status(
                job_dir,
                {"state": "transcribing", "process": {"pid": 99999999}, "updatedAt": "2000-01-01T00:00:00Z"},
            )
            status_path = job_dir / "status.json"
            status = json.loads(status_path.read_text(encoding="utf-8"))
            status["updatedAt"] = "2000-01-01T00:00:00Z"
            status_path.write_text(json.dumps(status), encoding="utf-8")
            summary = self.make_application(workspace).summarize_job(job_dir)
            self.assertEqual(summary["effectiveState"], "interrupted")

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_media_symlink_outside_job_is_not_served(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            outside = workspace / "outside.mp4"
            outside.write_bytes(b"secret")
            job_dir = workspace / "jobs" / "linked-id"
            (job_dir / "source").mkdir(parents=True)
            os.symlink(outside, job_dir / "source" / "video.mp4")
            initialize_job(job_dir, "linked-id", "https://example.test", "Linked")
            self.assertIsNone(self.make_application(workspace).video_path(job_dir))


if __name__ == "__main__":
    unittest.main()
