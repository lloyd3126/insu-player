from __future__ import annotations

import json
import hashlib
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
        rendition = self.job / "source" / "renditions" / "720p-test.mp4"
        rendition.parent.mkdir(parents=True)
        rendition.write_bytes(b"video")
        media_work = self.job / "media-work"
        media_work.mkdir(parents=True)
        (media_work / "catalog.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "videoId": "demo-video",
                    "revision": 1,
                    "activeRenditionId": "720p-test",
                    "availability": {"discoveredAt": None, "formats": []},
                    "renditions": [
                        {
                            "id": "720p-test",
                            "requestedHeight": 720,
                            "width": 1280,
                            "height": 720,
                            "container": "mp4",
                            "videoCodec": "avc1",
                            "audioCodec": "aac",
                            "path": "source/renditions/720p-test.mp4",
                            "sizeBytes": rendition.stat().st_size,
                            "checksum": hashlib.sha256(rendition.read_bytes()).hexdigest(),
                            "createdAt": "2026-08-08T00:00:00Z",
                        }
                    ],
                    "operation": None,
                }
            ),
            encoding="utf-8",
        )
        source_artifact = self.job / "subtitle-work" / "artifacts" / "source-en-r1"
        source_artifact.mkdir(parents=True)
        (source_artifact / "en.vtt").write_text(
            "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n",
            encoding="utf-8",
        )
        self.write_status()
        self.create_database()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_status(self, **overrides: object) -> None:
        payload: dict[str, object] = {
            "schemaVersion": 6,
            "videoId": "demo-video",
            "title": "Demo Video",
            "state": "ready",
            "stage": "complete",
            "history": [],
            "subtitleArtifacts": [],
            "activeSubtitleTracks": {},
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
                CREATE TABLE media_renditions (
                  id TEXT PRIMARY KEY,
                  video_id TEXT NOT NULL REFERENCES jobs(video_id) ON DELETE CASCADE,
                  height INTEGER NOT NULL
                );
                INSERT INTO jobs(video_id, title) VALUES ('demo-video', 'Demo Video');
                INSERT INTO job_history(video_id, message) VALUES ('demo-video', 'ready');
                INSERT INTO media_renditions(id, video_id, height)
                  VALUES ('720p-test', 'demo-video', 720);
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

    def run_subtitle_removal(
        self, command: str, artifact_id: str, *arguments: str, check: bool = True
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(REMOVAL_SCRIPT),
                command,
                str(self.workspace),
                "--kind",
                "subtitle-artifact",
                "--video-id",
                "demo-video",
                "--artifact-id",
                artifact_id,
                *arguments,
            ],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=check,
        )

    def run_media_removal(
        self, command: str, rendition_id: str, *arguments: str, check: bool = True
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(REMOVAL_SCRIPT),
                command,
                str(self.workspace),
                "--kind",
                "media-rendition",
                "--video-id",
                "demo-video",
                "--rendition-id",
                rendition_id,
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
        self.assertEqual(plan["filesystem"]["files"], 4)
        self.assertEqual(plan["blocked"], [])
        self.assertRegex(plan["digest"], r"^[0-9a-f]{64}$")
        rows = {item["table"]: item["rows"] for item in plan["database"]["rows"]}
        self.assertEqual(rows, {"job_history": 1, "jobs": 1, "media_renditions": 1})
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
            {"delete": "cascade", "rows": 0, "table": "media_renditions"},
        ])

    def test_media_rendition_removal_preserves_active_quality_and_other_job_data(self) -> None:
        rendition = self.job / "source" / "renditions" / "1080p-test.mp4"
        rendition.write_bytes(b"higher quality video")
        catalog_path = self.job / "media-work" / "catalog.json"
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        catalog["revision"] = 2
        catalog["renditions"].append(
            {
                "id": "1080p-test",
                "requestedHeight": 1080,
                "width": 1920,
                "height": 1080,
                "container": "mp4",
                "videoCodec": "avc1",
                "audioCodec": "aac",
                "path": "source/renditions/1080p-test.mp4",
                "sizeBytes": rendition.stat().st_size,
                "checksum": hashlib.sha256(rendition.read_bytes()).hexdigest(),
                "createdAt": "2026-08-08T01:00:00Z",
            }
        )
        catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
        connection = sqlite3.connect(self.workspace / "app.db")
        try:
            connection.execute(
                "INSERT INTO media_renditions(id, video_id, height) VALUES (?, ?, ?)",
                ("1080p-test", "demo-video", 1080),
            )
            connection.commit()
        finally:
            connection.close()

        active_preview = json.loads(
            self.run_media_removal("preview", "720p-test").stdout
        )
        self.assertEqual(active_preview["blocked"][0]["code"], "active-rendition")

        preview = json.loads(
            self.run_media_removal("preview", "1080p-test").stdout
        )
        self.assertEqual(preview["blocked"], [])
        self.assertEqual(preview["databaseRows"], 1)
        execution = json.loads(
            self.run_media_removal(
                "execute",
                "1080p-test",
                "--plan-digest",
                preview["digest"],
                "--yes",
            ).stdout
        )

        self.assertTrue(execution["verification"]["removed"])
        updated = json.loads(catalog_path.read_text(encoding="utf-8"))
        self.assertEqual(updated["activeRenditionId"], "720p-test")
        self.assertEqual(
            [item["id"] for item in updated["renditions"]], ["720p-test"]
        )
        self.assertFalse(rendition.exists())
        self.assertTrue(self.job.is_dir())
        self.assertTrue((self.job / "status.json").is_file())

    def test_subtitle_artifact_removal_cascades_dependents_and_preserves_video(self) -> None:
        artifact_root = self.job / "subtitle-work" / "artifacts"
        source_id = "source-en-r1"
        translation_id = "translation-en-fr-r1"
        segmentation_id = "segmentation-en-fr-r1"
        translation_source = artifact_root / translation_id / "en.vtt"
        translation_target = artifact_root / translation_id / "fr.vtt"
        segmentation_source = artifact_root / segmentation_id / "en.vtt"
        segmentation_target = artifact_root / segmentation_id / "fr.vtt"
        for path, text in (
            (translation_source, "Hello"),
            (translation_target, "Bonjour"),
            (segmentation_source, "Hello"),
            (segmentation_target, "Bonjour"),
        ):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                f"WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n{text}\n",
                encoding="utf-8",
            )

        def track(artifact_id: str, language: str, role: str, path: Path) -> dict[str, object]:
            return {
                "id": f"{artifact_id}-{role}",
                "languageCode": language,
                "role": role,
                "state": "ready",
                "path": path.relative_to(self.job).as_posix(),
            }

        artifacts = [
            {
                "id": source_id,
                "kind": "source",
                "revision": 1,
                "sourceType": "model-transcript",
                "sourceLanguage": "en",
                "dependencies": [],
                "tracks": [
                    track(source_id, "en", "source_raw", artifact_root / source_id / "en.vtt")
                ],
            },
            {
                "id": translation_id,
                "kind": "translation",
                "revision": 1,
                "sourceLanguage": "en",
                "outputLanguage": "fr",
                "dependencies": [
                    {"artifactId": source_id, "relation": "timing-source"},
                    {"artifactId": source_id, "relation": "content-source"},
                ],
                "tracks": [
                    track(translation_id, "en", "input_sentence", translation_source),
                    track(translation_id, "fr", "output_sentence", translation_target),
                ],
            },
            {
                "id": segmentation_id,
                "kind": "segmentation",
                "revision": 1,
                "sourceLanguage": "en",
                "outputLanguage": "fr",
                "dependencies": [
                    {"artifactId": source_id, "relation": "timing-source"},
                    {"artifactId": translation_id, "relation": "content-parent"},
                ],
                "tracks": [
                    track(segmentation_id, "en", "input_segmented", segmentation_source),
                    track(segmentation_id, "fr", "output_segmented", segmentation_target),
                ],
            },
        ]
        self.write_status(
            subtitleArtifacts=artifacts,
            subtitlePipeline={
                "mode": "translate",
                "stage": "complete",
                "sourceLanguage": "en",
                "outputLanguage": "fr",
                "manualReferenceArtifactIds": [],
            },
            activeSubtitleTracks={
                "en": f"{segmentation_id}-input_segmented",
                "fr": f"{segmentation_id}-output_segmented",
            },
        )

        preview = json.loads(
            self.run_subtitle_removal("preview", translation_id).stdout
        )
        self.assertEqual(
            preview["removedArtifactIds"],
            [segmentation_id, translation_id],
        )
        self.assertEqual(preview["blocked"], [])

        execution = json.loads(
            self.run_subtitle_removal(
                "execute",
                translation_id,
                "--plan-digest",
                preview["digest"],
                "--yes",
            ).stdout
        )

        self.assertTrue(execution["verification"]["removed"])
        status = json.loads((self.job / "status.json").read_text(encoding="utf-8"))
        self.assertEqual(
            [artifact["id"] for artifact in status["subtitleArtifacts"]],
            [source_id],
        )
        self.assertEqual(status["activeSubtitleTracks"], {})
        self.assertEqual(status["state"], "needs_translation")
        self.assertEqual(status["subtitlePipeline"]["stage"], "content_revision")
        self.assertTrue(
            (self.job / "source" / "renditions" / "720p-test.mp4").is_file()
        )
        self.assertTrue((artifact_root / source_id / "en.vtt").is_file())
        for removed_path in (
            translation_source,
            translation_target,
            segmentation_source,
            segmentation_target,
        ):
            self.assertFalse(removed_path.exists())
        self.assertFalse((artifact_root / translation_id).exists())
        self.assertFalse((artifact_root / segmentation_id).exists())


if __name__ == "__main__":
    unittest.main()
