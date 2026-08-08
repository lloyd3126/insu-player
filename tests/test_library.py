from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_DIR = REPO_ROOT / "plugins" / "xeruca-player" / "skills" / "watch-video"
SCRIPT_DIR = SKILL_DIR / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

from job_state import initialize_job, load_status, patch_status, set_subtitle  # noqa: E402
from library_server import LibraryApplication  # noqa: E402


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
