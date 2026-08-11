from __future__ import annotations

import json
import os
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from current_database import (
    create_current_database,
    read_media_record,
    write_media_record,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
INSU_SKILL_DIR = REPO_ROOT / "plugins" / "insu-player" / "skills" / "watch-video"
SCRIPTS = INSU_SKILL_DIR / "scripts"
SAMPLE_VTT = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nSample caption\n"


def make_executable(path: Path, source: str) -> None:
    path.write_text(source, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


class WorkflowScriptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.workspace = Path(self.temporary.name) / "workspace"
        runtime = self.workspace / ".agent-tools" / "insu-player"
        venv_bin = runtime / ".venv" / "bin"
        workflow_bin = runtime / "bin"
        fake_bin = Path(self.temporary.name) / "fake-bin"
        venv_bin.mkdir(parents=True)
        workflow_bin.mkdir(parents=True)
        fake_bin.mkdir()
        self.fake_bin = fake_bin
        create_current_database(self.workspace)
        os.symlink(sys.executable, venv_bin / "python")
        make_executable(workflow_bin / "deno", "#!/bin/sh\nexit 0\n")
        make_executable(
            workflow_bin / "ffmpeg",
            """#!/bin/sh
set -eu
input=''
output=''
previous=''
for argument in "$@"; do
  if [ "$previous" = '-i' ]; then input="$argument"; fi
  output="$argument"
  previous="$argument"
done
height=$(sed -n 's/^height=//p' "$input" 2>/dev/null | head -n 1)
height=${height:-1080}
case "$height" in
  1080) width=1920 ;;
  720) width=1280 ;;
  480) width=854 ;;
  360) width=640 ;;
  *) width=1280 ;;
esac
printf 'local workflow ffmpeg\n' >&2
printf '  Stream #0:0: Video: h264 (avc1), yuv420p, %sx%s, 30 fps\n' "$width" "$height" >&2
case "$output" in
  *.m4a) mkdir -p "$(dirname "$output")"; printf 'fake-audio' > "$output" ;;
esac
exit 0
""",
        )
        make_executable(venv_bin / "whisper", "#!/bin/sh\nexit 1\n")
        make_executable(fake_bin / "ffmpeg", "#!/bin/sh\nprintf 'system ffmpeg must not be used\\n' >&2\nexit 99\n")
        make_executable(
            venv_bin / "yt-dlp",
            """#!/bin/sh
set -eu
all_arguments=" $* "
output=''
format_selector=''
write_info=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --format) format_selector="$2"; shift 2 ;;
    --write-info-json) write_info=1; shift ;;
    *) shift ;;
  esac
done
case "$all_arguments" in
  *' --dump-single-json '*) ;;
  *) if [ "${FAKE_ECHO_ARGUMENTS:-0}" = 1 ]; then printf 'debug arguments:%s\n' "$all_arguments" >&2; fi ;;
esac
case "$all_arguments" in
  *' --dump-single-json '*)
    if [ "${FAKE_LOW_ONLY:-0}" = 1 ]; then
      printf '%s\n' '{"id":"test-video","title":"Test Video","duration":125.9,"formats":[{"format_id":"135","ext":"mp4","height":480,"width":854,"vcodec":"avc1.4d401f","acodec":"none"},{"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a.40.2"}]}'
    else
      printf '%s\n' '{"id":"test-video","title":"Test Video","duration":125.9,"formats":[{"format_id":"137","ext":"mp4","height":1080,"width":1920,"vcodec":"avc1.640028","acodec":"none"},{"format_id":"136","ext":"mp4","height":720,"width":1280,"vcodec":"avc1.4d401f","acodec":"none"},{"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a.40.2"}]}'
    fi
    exit 0
    ;;
  *' --get-url '*)
    printf '%s\n' 'https://media.test/video' 'https://media.test/audio'
    exit 0
    ;;
  *' --write-subs '*)
    directory=$(dirname "$output")
    mkdir -p "$directory"
    printf 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nEnglish\n' > "$directory/test-video.en.vtt"
    printf '[download] 100.0%%\n'
    exit 0
    ;;
  *' --write-thumbnail '*)
    target=$(printf '%s' "$output" | sed 's/%(ext)s/jpg/g')
    mkdir -p "$(dirname "$target")"
    printf 'jpeg' > "$target"
    printf '[download] 100.0%%\n'
    exit 0
    ;;
  *' --extract-audio '*)
    target=$(printf '%s' "$output" | sed 's/%(ext)s/m4a/g')
    mkdir -p "$(dirname "$target")"
    printf 'fake-audio' > "$target"
    printf '[download] 100.0%%\n'
    exit 0
    ;;
  *' --recode-video '*)
    case "$format_selector" in
      *'height=1080'*) height=1080; width=1920; format_id='137+140' ;;
      *'height=720'*) height=720; width=1280; format_id='136+140' ;;
      *'height=480'*) height=480; width=854; format_id='135+140' ;;
      *'height=360'*) height=360; width=640; format_id='18' ;;
      *) height=1080; width=1920; format_id='137+140' ;;
    esac
    target=$(printf '%s' "$output" | sed 's/%(ext)s/mp4/g')
    mkdir -p "$(dirname "$target")"
    printf 'height=%s\n' "$height" > "$target"
    if [ "$write_info" -eq 1 ]; then
      info=$(printf '%s' "$target" | sed 's/\\.mp4$/.info.json/')
      printf '{"format_id":"%s","ext":"mp4","width":%s,"height":%s,"vcodec":"avc1","acodec":"mp4a"}\n' "$format_id" "$width" "$height" > "$info"
    fi
    printf '[download] 100.0%%\n'
    exit 0
    ;;
esac
printf 'unexpected fake yt-dlp invocation\n' >&2
exit 2
""",
        )
        make_executable(
            fake_bin / "curl",
            """#!/bin/sh
set -eu
state_path=${FAKE_CURL_STATE:-}
fail_count=${FAKE_CURL_FAIL_COUNT:-0}
count=1
if [ -n "$state_path" ]; then
  if [ -f "$state_path" ]; then count=$(( $(cat "$state_path") + 1 )); fi
  printf '%s\n' "$count" > "$state_path"
fi
if [ "$count" -le "$fail_count" ]; then printf '403'; else printf '206'; fi
""",
        )
        self.environment = os.environ.copy()
        self.environment["PATH"] = f"{fake_bin}:{self.environment.get('PATH', '')}"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_script(self, name: str, *arguments: str) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(
                [str(SCRIPTS / name), *arguments],
                cwd=REPO_ROOT,
                env=self.environment,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                check=True,
            )
        except subprocess.CalledProcessError as error:
            self.fail(error.stdout)

    def read_status(self) -> dict[str, object]:
        return read_media_record(self.workspace, "test-video")

    def write_status(self, status: dict[str, object]) -> None:
        write_media_record(self.workspace, status)

    def read_media_catalog(self) -> dict[str, object]:
        return json.loads(
            (
                self.workspace
                / "jobs"
                / "test-video"
                / "media-work"
                / "catalog.json"
            ).read_text(encoding="utf-8")
        )

    def active_media_path(self) -> Path:
        catalog = self.read_media_catalog()
        active_id = catalog["activeRenditionId"]
        rendition = next(
            item for item in catalog["renditions"] if item["id"] == active_id
        )
        return self.workspace / "jobs" / "test-video" / rendition["path"]

    def initial_selection(self) -> dict[str, object]:
        catalog = self.read_media_catalog()
        selection_path = catalog["renditions"][0]["selection"]
        return json.loads(
            (self.workspace / "jobs" / "test-video" / selection_path).read_text(
                encoding="utf-8"
            )
        )

    def test_download_normalizes_caption_and_records_job(self) -> None:
        result = self.run_script("download-video.sh", str(self.workspace), "https://example.test/watch?v=test-video", "--language", "en", "--proofread")
        job_dir = self.workspace / "jobs" / "test-video"
        status = self.read_status()
        self.assertIn("Download complete", result.stdout)
        self.assertEqual(status["state"], "needs_transcription")
        self.assertEqual(status["title"], "Test Video")
        self.assertEqual(status["durationSeconds"], 125.9)
        self.assertTrue(self.active_media_path().is_file())
        source_track = status["subtitleArtifacts"][0]["tracks"][0]["path"]
        self.assertTrue((job_dir / source_track).is_file())
        self.assertEqual(
            [artifact["kind"] for artifact in status["subtitleArtifacts"]],
            ["source"],
        )
        self.assertEqual(
            status["subtitleArtifacts"][0]["tracks"][0]["role"],
            "source_raw",
        )
        self.assertTrue((job_dir / "source" / "audio.m4a").exists())
        self.assertIn("local workflow ffmpeg", (job_dir / "media-info.txt").read_text(encoding="utf-8"))
        media_selection = self.initial_selection()
        self.assertEqual(media_selection["selected"]["height"], 1080)
        self.assertEqual(media_selection["selected"]["formatId"], "137+140")
        self.assertTrue(media_selection["validation"]["resolutionConfirmed"])
        self.assertEqual(
            status["assets"]["mediaCatalog"]["path"],
            "media-work/catalog.json",
        )

    def test_network_media_keeps_signed_urls_out_of_persistent_files(self) -> None:
        signed_url = "https://cdn.example.test/master.m3u8?token=must-not-persist"
        page_url = "https://media.example.test/watch/one"
        self.environment["FAKE_ECHO_ARGUMENTS"] = "1"
        self.run_script(
            "download-video.sh",
            str(self.workspace),
            signed_url,
            "--download-only",
            "--source-kind",
            "network-media",
            "--library-source-url",
            page_url,
            "--referer",
            page_url,
        )
        status = self.read_status()
        self.assertEqual(status["sourceUrl"], page_url)
        self.assertEqual(status["sourceKind"], "network-media")
        self.assertEqual(status["state"], "downloaded")
        job_dir = self.workspace / "jobs" / "test-video"
        self.assertFalse((job_dir / "source" / "audio.m4a").exists())
        self.assertTrue((job_dir / "media-work" / "runs" / "initial" / "discovery.json").is_file())
        self.assertTrue(self.active_media_path().is_file())
        for persisted in [job_dir / "manifest.txt", job_dir / "logs" / "workflow.log"]:
            self.assertNotIn(signed_url, persisted.read_text(encoding="utf-8"))

    def test_one_command_entrypoint_reaches_actionable_state(self) -> None:
        result = self.run_script(
            "process-video.sh",
            str(self.workspace),
            "https://example.test/watch?v=test-video",
            "--language",
            "en",
            "--proofread",
            "--no-transcribe",
        )
        self.assertIn("State: needs_transcription", result.stdout)
        self.assertEqual(self.read_status()["state"], "needs_transcription")

    def test_download_requires_an_explicit_translation_choice(self) -> None:
        result = subprocess.run(
            [
                str(SCRIPTS / "download-video.sh"),
                str(self.workspace),
                "https://example.test/watch?v=test-video",
                "--language",
                "en",
            ],
            cwd=REPO_ROOT,
            env=self.environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("choose --translate", result.stdout)

    def test_transient_403_retries_a_fresh_url_without_downgrading(self) -> None:
        probe_state = Path(self.temporary.name) / "curl-count.txt"
        self.environment["FAKE_CURL_STATE"] = str(probe_state)
        self.environment["FAKE_CURL_FAIL_COUNT"] = "2"

        result = self.run_script(
            "download-video.sh",
            str(self.workspace),
            "https://example.test/watch?v=test-video",
            "--language",
            "en",
            "--proofread",
        )

        selection = self.initial_selection()
        self.assertIn("fresh 1080p stream URL (attempt 2/2)", result.stdout)
        self.assertEqual(selection["selected"]["height"], 1080)
        self.assertIsNone(selection["fallbackReason"])
        self.assertEqual(
            [(attempt["height"], attempt["probeResult"]) for attempt in selection["attempts"]],
            [(1080, "http-failed"), (1080, "ok")],
        )

    def test_download_stops_before_an_unapproved_low_quality_fallback(self) -> None:
        self.environment["FAKE_LOW_ONLY"] = "1"
        result = subprocess.run(
            [
                str(SCRIPTS / "download-video.sh"),
                str(self.workspace),
                "https://example.test/watch?v=test-video",
                "--language",
                "en",
                "--proofread",
            ],
            cwd=REPO_ROOT,
            env=self.environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires user confirmation", result.stdout)
        self.assertIn("--allow-low-quality", result.stdout)
        job_dir = self.workspace / "jobs" / "test-video"
        self.assertFalse((job_dir / "media-work" / "catalog.json").exists())
        self.assertTrue((job_dir / "media-work" / "runs" / "initial" / "discovery.json").is_file())

    def test_explicit_low_quality_approval_is_recorded(self) -> None:
        self.environment["FAKE_LOW_ONLY"] = "1"
        self.run_script(
            "download-video.sh",
            str(self.workspace),
            "https://example.test/watch?v=test-video",
            "--language",
            "en",
            "--proofread",
            "--allow-low-quality",
        )

        selection = self.initial_selection()
        self.assertEqual(selection["selected"]["height"], 480)
        self.assertTrue(selection["policy"]["belowMinimumAllowed"])
        self.assertFalse(selection["validation"]["meetsMinimumHeight"])

    def test_manage_rendition_downloads_only_the_requested_height(self) -> None:
        self.run_script(
            "download-video.sh",
            str(self.workspace),
            "https://example.test/watch?v=test-video",
            "--language",
            "en",
            "--proofread",
        )
        initial_catalog = self.read_media_catalog()
        initial_active = initial_catalog["activeRenditionId"]
        stale_lock = (
            self.workspace
            / "jobs"
            / "test-video"
            / "media-work"
            / ".download.lock"
        )
        stale_lock.mkdir()
        (stale_lock / "pid").write_text("2147483647\n", encoding="utf-8")

        result = self.run_script(
            "manage-rendition.sh",
            str(self.workspace),
            "test-video",
            "download",
            "720",
            "--run-id",
            "quality-720p-test",
        )

        catalog = self.read_media_catalog()
        self.assertIn("Verified 720p rendition added", result.stdout)
        self.assertEqual(
            sorted(item["height"] for item in catalog["renditions"]),
            [720, 1080],
        )
        self.assertEqual(catalog["activeRenditionId"], initial_active)
        self.assertEqual(catalog["operation"]["requestedHeight"], 720)
        self.assertEqual(catalog["operation"]["state"], "ready")
        downloaded = next(
            item for item in catalog["renditions"] if item["height"] == 720
        )
        self.assertTrue(
            (self.workspace / "jobs" / "test-video" / downloaded["path"]).is_file()
        )
        selection = json.loads(
            (
                self.workspace
                / "jobs"
                / "test-video"
                / downloaded["selection"]
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(selection["selected"]["height"], 720)

        duplicate = subprocess.run(
            [
                str(SCRIPTS / "manage-rendition.sh"),
                str(self.workspace),
                "test-video",
                "download",
                "720",
                "--run-id",
                "quality-720p-duplicate",
            ],
            cwd=REPO_ROOT,
            env=self.environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertNotEqual(duplicate.returncode, 0)
        self.assertIn("already exists", duplicate.stdout)

    def test_job_state_rejects_the_retired_schema(self) -> None:
        job_dir = self.workspace / "jobs" / "test-video"
        job_dir.mkdir(parents=True)
        self.write_status(
            {
                "schemaVersion": 3,
                "videoId": "test-video",
                "state": "queued",
                "stage": "queued",
                "progress": 0,
                "subtitleArtifacts": [],
                "activeSubtitleTracks": {},
            }
        )
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "job_state.py"),
                "show",
                "--job-dir",
                str(job_dir),
            ],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("schemaVersion 2", result.stdout)

    def test_job_state_requires_current_transcription_language_metadata(self) -> None:
        job_dir = self.workspace / "jobs" / "test-video"
        subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "job_state.py"),
                "init",
                "--job-dir",
                str(job_dir),
                "--video-id",
                "test-video",
                "--source-url",
                "https://example.test/video",
                "--source-kind",
                "page",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "job_state.py"),
                "transcription",
                "--job-dir",
                str(job_dir),
                "--provider",
                "local",
                "--service",
                "openai-whisper",
                "--model",
                "medium",
                "--language-tag",
                "en-US",
                "--engine-language",
                "en",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        status = self.read_status()
        self.assertEqual(status["schemaVersion"], 2)
        self.assertEqual(
            status["transcription"],
            {
                "provider": "local",
                "service": "openai-whisper",
                "model": "medium",
                "languageTag": "en-US",
                "engineLanguage": "en",
                "updatedAt": status["transcription"]["updatedAt"],
            },
        )

        status["transcription"] = {
            "provider": "local",
            "service": "openai-whisper",
            "model": "medium",
        }
        self.write_status(status)
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "job_state.py"),
                "show",
                "--job-dir",
                str(job_dir),
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid language code", result.stdout)

    def test_job_state_rejects_flat_subtitle_artifact_processor_fields(self) -> None:
        job_dir = self.workspace / "jobs" / "test-video"
        subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "job_state.py"),
                "init",
                "--job-dir",
                str(job_dir),
                "--video-id",
                "test-video",
                "--source-url",
                "https://example.test/video",
                "--source-kind",
                "page",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        status = self.read_status()
        status["subtitleArtifacts"] = [
            {"id": "legacy-source", "provider": "local", "model": "medium"}
        ]
        self.write_status(status)
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "job_state.py"),
                "show",
                "--job-dir",
                str(job_dir),
            ],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("current schema", result.stdout)

    def test_job_state_rejects_history_without_current_stage(self) -> None:
        job_dir = self.workspace / "jobs" / "test-video"
        subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "job_state.py"),
                "init",
                "--job-dir",
                str(job_dir),
                "--video-id",
                "test-video",
                "--source-url",
                "https://example.test/video",
                "--source-kind",
                "page",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        status = self.read_status()
        del status["history"][0]["stage"]
        self.write_status(status)
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "job_state.py"),
                "show",
                "--job-dir",
                str(job_dir),
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid history entry", result.stdout)

    def test_prompt_library_rejects_missing_current_timestamp(self) -> None:
        self.workspace.mkdir(parents=True, exist_ok=True)
        (self.workspace / "prompts.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "prompts": [
                        {
                            "id": "old-prompt",
                            "title": "Old",
                            "scenario": "Test",
                            "prompt": "Content",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "prompt_library.py"),
                "list",
                str(self.workspace),
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("updatedAt must be a timestamp", result.stdout)

    def test_progress_runner_handles_commands_without_percentage_output(self) -> None:
        job_dir = self.workspace / "jobs" / "no-progress"
        subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "job_state.py"),
                "init",
                "--job-dir",
                str(job_dir),
                "--video-id",
                "no-progress",
                "--source-url",
                "https://example.test/watch?v=no-progress",
                "--source-kind",
                "page",
                "--title",
                "No Progress",
            ],
            cwd=REPO_ROOT,
            env=self.environment,
            check=True,
        )
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "run_progress.py"),
                "--job-dir",
                str(job_dir),
                "--state",
                "downloading",
                "--stage",
                "video",
                "--message",
                "Downloading",
                "--",
                sys.executable,
                "-c",
                "print('no percentage output')",
            ],
            cwd=REPO_ROOT,
            env=self.environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=True,
        )
        status = read_media_record(self.workspace, "no-progress")
        self.assertIn("no percentage output", result.stdout)
        self.assertEqual(status["state"], "downloading")
        self.assertEqual(status["progress"], 100.0)

    def test_import_translation_makes_job_ready_then_cleanup_preserves_player_assets(self) -> None:
        self.run_script("download-video.sh", str(self.workspace), "https://example.test/watch?v=test-video", "--language", "en", "--proofread")
        translated = Path(self.temporary.name) / "translated.vtt"
        translated.write_text(SAMPLE_VTT, encoding="utf-8")
        self.run_script(
            "import-caption.sh",
            str(self.workspace),
            "test-video",
            "zh-TW",
            str(translated),
            "--source-type",
            "model-transcript",
            "--processor-provider",
            "local",
            "--processor-service",
            "openai-whisper",
            "--processor-model",
            "medium",
            "--timing-unit-kind",
            "grapheme-group",
        )
        status = self.read_status()
        self.assertEqual(status["state"], "needs_transcription")

        job_dir = self.workspace / "jobs" / "test-video"
        (job_dir / "whisper").mkdir()
        (job_dir / "whisper" / "scratch.txt").write_text("temporary", encoding="utf-8")
        self.run_script("clean-job.sh", str(self.workspace), "test-video", "--yes")
        self.assertTrue(self.active_media_path().is_file())
        zh_artifact = next(item for item in status["subtitleArtifacts"] if item["sourceLanguage"] == "zh-TW")
        self.assertTrue((job_dir / zh_artifact["tracks"][0]["path"]).is_file())
        self.assertFalse((job_dir / "whisper").exists())

    def test_bilingual_import_registers_an_immutable_revisioned_artifact(self) -> None:
        self.run_script(
            "download-video.sh",
            str(self.workspace),
            "https://example.test/watch?v=test-video",
            "--language",
            "en",
            "--proofread",
        )
        job_dir = self.workspace / "jobs" / "test-video"
        source_artifact = self.read_status()["subtitleArtifacts"][0]
        source = job_dir / source_artifact["tracks"][0]["path"]
        self.run_script(
            "import-caption.sh",
            str(self.workspace),
            "test-video",
            "en",
            str(source),
            "--source-type",
            "model-transcript",
            "--processor-provider",
            "local",
            "--processor-service",
            "openai-whisper",
            "--processor-model",
            "medium",
        )
        target = Path(self.temporary.name) / "fr.vtt"
        target.write_text(
            "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nExemple de sous-titre\n",
            encoding="utf-8",
        )
        manifest = job_dir / "subtitle-work" / "content-manifest.json"
        manifest.parent.mkdir(parents=True, exist_ok=True)
        transcript = job_dir / "whisper" / "local" / "transcript.json"
        transcript.parent.mkdir(parents=True, exist_ok=True)
        transcript.write_text(
            json.dumps(
                {
                    "schemaVersion": 3,
                    "processor": {
                        "provider": "local",
                        "service": "openai-whisper",
                        "model": "medium",
                    },
                    "language": "en",
                    "engineLanguage": "en",
                    "timingUnitKind": "word",
                    "durationSeconds": 2.0,
                    "chunks": [
                        {
                            "index": 0,
                            "startSeconds": 0.0,
                            "endSeconds": 2.0,
                            "sha256": "0" * 64,
                        }
                    ],
                    "segments": [
                        {
                            "id": 0,
                            "start": 0.0,
                            "end": 2.0,
                            "text": "Sample caption",
                            "origin": "provider",
                        }
                    ],
                    "words": [
                        {
                            "id": 0,
                            "word": "Sample caption",
                            "start": 0.0,
                            "end": 2.0,
                        }
                    ],
                    "text": "Sample caption",
                }
            ),
            encoding="utf-8",
        )
        manifest.write_text(
            json.dumps(
                {
                    "schemaVersion": 5,
                    "mode": "translate",
                    "sourceLanguage": "en",
                    "outputLanguage": "fr",
                    "sourceTranscript": str(transcript),
                    "timingSourceArtifactId": "test-video-source-model-transcript-en-r1",
                    "sourceContentArtifactId": "test-video-source-model-transcript-en-r1",
                    "sourceContentKind": "model-transcript",
                    "sourceContentManifest": None,
                    "sourceContentChecksum": None,
                    "referenceArtifactIds": ["test-video-source-manual-cc-en-r1"],
                    "timingProcessor": {
                        "provider": "local",
                        "service": "openai-whisper",
                        "model": "medium",
                    },
                    "contentProcessor": {"provider": "agent", "service": "codex"},
                    "sentenceReview": {
                        "provider": "agent",
                        "service": "codex",
                        "reviewedAt": "2026-08-10T00:00:00Z",
                    },
                    "outputProfile": {"punctuationPolicy": "preserve"},
                    "segments": [
                        {
                            "id": "S0001",
                            "start": "00:00:00.000",
                            "end": "00:00:02.000",
                            "sourceUnitStart": "U000001",
                            "sourceUnitEnd": "U000001",
                            "sourceText": "Sample caption",
                            "draftOutputText": "Exemple de sous-titre",
                            "outputText": "Exemple de sous-titre",
                            "requiredTerms": [],
                        }
                    ],
                }
            ) + "\n",
            encoding="utf-8",
        )

        self.run_script(
            "import-subtitle-revision.sh",
            str(self.workspace),
            "test-video",
            str(source),
            str(target),
            "--source-language",
            "en",
            "--output-language",
            "fr",
            "--artifact-kind",
            "translation",
            "--revision",
            "2",
            "--timing-source-artifact",
            "test-video-source-model-transcript-en-r1",
            "--text-reference-artifact",
            "test-video-source-manual-cc-en-r1",
            "--manifest",
            str(manifest),
        )

        status = self.read_status()
        artifact = next(
            item
            for item in status["subtitleArtifacts"]
            if item["kind"] == "translation"
        )
        self.assertEqual(artifact["revision"], 2)
        self.assertEqual(artifact["sourceLanguage"], "en")
        self.assertEqual(artifact["outputLanguage"], "fr")
        self.assertEqual(
            artifact["processor"],
            {"provider": "agent", "service": "codex"},
        )
        self.assertEqual(
            artifact["dependencies"],
            [
                {"relation": "timing-source", "artifactId": "test-video-source-model-transcript-en-r1"},
                {"relation": "content-source", "artifactId": "test-video-source-model-transcript-en-r1"},
                {"relation": "text-reference", "artifactId": "test-video-source-manual-cc-en-r1"},
            ],
        )
        self.assertEqual(
            artifact["manifestPath"],
            "subtitle-work/artifacts/test-video-translation-en-fr-r2/manifest.json",
        )
        self.assertEqual(
            (job_dir / artifact["manifestPath"]).read_text(encoding="utf-8"),
            json.dumps(
                {
                    "schemaVersion": 5,
                    "mode": "translate",
                    "sourceLanguage": "en",
                    "outputLanguage": "fr",
                    "sourceTranscript": str(transcript),
                    "timingSourceArtifactId": "test-video-source-model-transcript-en-r1",
                    "sourceContentArtifactId": "test-video-source-model-transcript-en-r1",
                    "sourceContentKind": "model-transcript",
                    "sourceContentManifest": None,
                    "sourceContentChecksum": None,
                    "referenceArtifactIds": ["test-video-source-manual-cc-en-r1"],
                    "timingProcessor": {
                        "provider": "local",
                        "service": "openai-whisper",
                        "model": "medium",
                    },
                    "contentProcessor": {"provider": "agent", "service": "codex"},
                    "sentenceReview": {
                        "provider": "agent",
                        "service": "codex",
                        "reviewedAt": "2026-08-10T00:00:00Z",
                    },
                    "outputProfile": {"punctuationPolicy": "preserve"},
                    "segments": [
                        {
                            "id": "S0001",
                            "start": "00:00:00.000",
                            "end": "00:00:02.000",
                            "sourceUnitStart": "U000001",
                            "sourceUnitEnd": "U000001",
                            "sourceText": "Sample caption",
                            "draftOutputText": "Exemple de sous-titre",
                            "outputText": "Exemple de sous-titre",
                            "requiredTerms": [],
                        }
                    ],
                }
            ) + "\n",
        )
        self.assertEqual(
            [track["role"] for track in artifact["tracks"]],
            ["input_sentence", "output_sentence"],
        )
        for track in artifact["tracks"]:
            self.assertTrue((job_dir / track["path"]).is_file())

        no_reference_manifest = job_dir / "subtitle-work" / "content-manifest-no-reference.json"
        no_reference_payload = json.loads(manifest.read_text(encoding="utf-8"))
        no_reference_payload["referenceArtifactIds"] = []
        no_reference_manifest.write_text(
            json.dumps(no_reference_payload) + "\n",
            encoding="utf-8",
        )
        self.run_script(
            "import-subtitle-revision.sh",
            str(self.workspace),
            "test-video",
            str(source),
            str(target),
            "--source-language",
            "en",
            "--output-language",
            "fr",
            "--artifact-kind",
            "translation",
            "--revision",
            "3",
            "--timing-source-artifact",
            "test-video-source-model-transcript-en-r1",
            "--manifest",
            str(no_reference_manifest),
        )
        no_reference = next(
            item
            for item in self.read_status()["subtitleArtifacts"]
            if item["kind"] == "translation" and item["revision"] == 3
        )
        self.assertEqual(
            no_reference["dependencies"],
            [
                {"relation": "timing-source", "artifactId": "test-video-source-model-transcript-en-r1"},
                {"relation": "content-source", "artifactId": "test-video-source-model-transcript-en-r1"},
            ],
        )

    def test_complete_job_cleanup_delegates_to_confirmed_removal_plan(self) -> None:
        self.run_script(
            "download-video.sh",
            str(self.workspace),
            "https://example.test/watch?v=test-video",
            "--language",
            "en",
            "--proofread",
        )
        preview = json.loads(
            self.run_script(
                "clean-job.sh", str(self.workspace), "test-video", "--all"
            ).stdout
        )
        job_dir = self.workspace / "jobs" / "test-video"
        self.assertTrue(job_dir.is_dir())

        unconfirmed = subprocess.run(
            [
                str(SCRIPTS / "clean-job.sh"),
                str(self.workspace),
                "test-video",
                "--all",
                "--yes",
            ],
            cwd=REPO_ROOT,
            env=self.environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertNotEqual(unconfirmed.returncode, 0)
        self.assertIn("confirmed --plan-digest", unconfirmed.stdout)
        self.assertTrue(job_dir.is_dir())

        result = self.run_script(
            "clean-job.sh",
            str(self.workspace),
            "test-video",
            "--all",
            "--plan-digest",
            preview["digest"],
            "--yes",
        )
        self.assertIn('"removed": true', result.stdout)
        self.assertFalse(job_dir.exists())

    def test_uninstall_refuses_while_library_pid_is_alive(self) -> None:
        pid_file = self.workspace / ".insu-player-server.pid"
        pid_file.write_text(f"{os.getpid()}\n", encoding="utf-8")
        preview = self.run_script("uninstall.sh", str(self.workspace))
        self.assertIn("library server: running", preview.stdout)
        attempted = subprocess.run(
            [str(SCRIPTS / "uninstall.sh"), str(self.workspace), "--yes"],
            cwd=REPO_ROOT,
            env=self.environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertNotEqual(attempted.returncode, 0)
        self.assertIn("library server is still running", attempted.stdout)
        self.assertTrue((self.workspace / ".agent-tools" / "insu-player").is_dir())

    def test_uninstall_removes_stale_provider_session_descriptor(self) -> None:
        descriptor = self.workspace / ".insu-provider-session.json"
        descriptor.write_text('{"token":"stale"}\n', encoding="utf-8")
        descriptor.chmod(0o600)
        self.run_script("uninstall.sh", str(self.workspace), "--yes")
        self.assertFalse(descriptor.exists())

    def test_runtime_cache_environment_stays_under_workspace(self) -> None:
        command = f"""
set -eu
. {SCRIPTS / 'lib.sh'}
caption_set_paths {self.workspace}
printf '%s\n' "$UV_CACHE_DIR" "$UV_PYTHON_INSTALL_DIR" "$DENO_DIR" "$XDG_CACHE_HOME" \
  "$PYTHONPYCACHEPREFIX" "$TORCH_HOME" "$TIKTOKEN_CACHE_DIR" "$HF_HOME" "$CAPTION_YTDLP_CACHE" \
  "$HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$TMPDIR"
"""
        result = subprocess.run(
            ["bash", "-c", command],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=True,
        )
        runtime = (self.workspace / ".agent-tools" / "insu-player").resolve()
        for output_path in result.stdout.splitlines():
            Path(output_path).resolve().relative_to(runtime)

    def test_setup_never_invokes_a_system_package_manager(self) -> None:
        source = (SCRIPTS / "setup-environment.sh").read_text(encoding="utf-8")
        for forbidden in ("brew install", "apt-get", "sudo ", "dnf install", "pacman -S"):
            self.assertNotIn(forbidden, source)

    def test_medium_is_the_setup_default_and_transcription_uses_database_selection(self) -> None:
        setup_source = (SCRIPTS / "setup-environment.sh").read_text(encoding="utf-8")
        transcribe_source = (SCRIPTS / "transcribe.sh").read_text(encoding="utf-8")
        update_source = (SCRIPTS / "update-environment.sh").read_text(encoding="utf-8")
        transcriber_source = (
            REPO_ROOT
            / "plugins"
            / "insu-player"
            / "skills"
            / "transcribe-media"
            / "scripts"
            / "transcribe_media.py"
        ).read_text(encoding="utf-8")
        self.assertIn('model_name="medium"', setup_source)
        self.assertIn("resolve-transcription-settings.py", transcribe_source)
        self.assertNotIn("--timing-provider", transcribe_source)
        self.assertNotIn("--model requires", transcribe_source)
        self.assertNotIn("DEFAULT_MODEL", update_source)
        self.assertNotIn("DEFAULT_MODEL", setup_source)
        self.assertIn("elif not args.model:", transcriber_source)

    def test_transcription_settings_resolver_fails_closed_and_returns_exact_identity(self) -> None:
        resolver = SCRIPTS / "resolve-transcription-settings.py"
        missing = subprocess.run(
            [sys.executable, str(resolver), "--workspace", str(self.workspace)],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("no transcription model is selected", missing.stdout)

        connection = sqlite3.connect(self.workspace / "app.db")
        try:
            connection.execute(
                "INSERT INTO transcription_settings (id, model_id, updated_at) VALUES (?, ?, ?)",
                (
                    "active",
                    "cloud.groq.whisper-large-v3-turbo",
                    "2026-08-11T00:00:00.000Z",
                ),
            )
            connection.commit()
        finally:
            connection.close()

        resolved = subprocess.run(
            [
                sys.executable,
                str(resolver),
                "--workspace",
                str(self.workspace),
                "--format",
                "tsv",
            ],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=True,
        )
        self.assertEqual(
            resolved.stdout.strip(),
            "groq\taudio/transcriptions\twhisper-large-v3-turbo",
        )

        connection = sqlite3.connect(self.workspace / "app.db")
        try:
            connection.execute(
                "UPDATE transcription_settings SET model_id = ? WHERE id = 'active'",
                ("unsupported",),
            )
            connection.commit()
        finally:
            connection.close()
        rejected = subprocess.run(
            [sys.executable, str(resolver), "--workspace", str(self.workspace)],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn("unsupported", rejected.stdout)

    def test_api_transcription_can_use_the_active_server_session_without_weakening_consent(self) -> None:
        source = (SCRIPTS / "transcribe.sh").read_text(encoding="utf-8")
        helper = (SCRIPTS / "provider_credential_session.py").read_text(encoding="utf-8")
        self.assertIn("--consent-to-audio-upload", source)
        self.assertNotIn("--allow-api-upload", source)
        self.assertNotIn("--consent-to-upload", source)
        self.assertIn("manual_reference_count=0", source)
        self.assertNotIn('${#manual_reference_artifacts[@]}', source)
        self.assertIn("CAPTION_PROVIDER_CREDENTIAL_SESSION", source)
        self.assertIn("os.execvpe", helper)
        self.assertNotIn("print(value", helper)
        for name in (
            "OPENAI_API_KEY",
            "GROQ_API_KEY",
            "ELEVENLABS_API_KEY",
            "XAI_API_KEY",
            "OPENROUTER_API_KEY",
        ):
            self.assertIn(name, helper)

        check = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "provider_credential_session.py"),
                "--workspace",
                str(self.workspace),
                "--provider",
                "openai",
                "check",
            ],
            cwd=REPO_ROOT,
            env=self.environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=False,
        )
        self.assertNotEqual(check.returncode, 0)
        self.assertNotIn("usage:", check.stdout)
        self.assertIn("provider credential session", check.stdout)


if __name__ == "__main__":
    unittest.main()
