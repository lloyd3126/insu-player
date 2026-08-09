from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


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
        os.symlink(sys.executable, venv_bin / "python")
        make_executable(workflow_bin / "deno", "#!/bin/sh\nexit 0\n")
        make_executable(workflow_bin / "ffmpeg", "#!/bin/sh\nprintf 'local workflow ffmpeg\\n' >&2\nexit 0\n")
        make_executable(venv_bin / "whisper", "#!/bin/sh\nexit 1\n")
        make_executable(fake_bin / "ffmpeg", "#!/bin/sh\nprintf 'system ffmpeg must not be used\\n' >&2\nexit 99\n")
        make_executable(
            venv_bin / "yt-dlp",
            """#!/bin/sh
set -eu
output=''
previous=''
for argument in "$@"; do
  if [ "$previous" = '--output' ]; then output="$argument"; fi
  previous="$argument"
done
case " $* " in
  *' --dump-single-json '*) printf '%s\n' '{"id":"test-video","title":"Test Video","duration":125.9}'; exit 0 ;;
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
  *' --recode-video '*)
    target=$(printf '%s' "$output" | sed 's/%(ext)s/mp4/g')
    mkdir -p "$(dirname "$target")"
    printf 'fake-mp4' > "$target"
    printf '[download] 100.0%%\n'
    exit 0
    ;;
esac
printf 'unexpected fake yt-dlp invocation\n' >&2
exit 2
""",
        )
        self.environment = os.environ.copy()
        self.environment["PATH"] = f"{fake_bin}:{self.environment.get('PATH', '')}"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_script(self, name: str, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(SCRIPTS / name), *arguments],
            cwd=REPO_ROOT,
            env=self.environment,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=True,
        )

    def read_status(self) -> dict[str, object]:
        return json.loads((self.workspace / "jobs" / "test-video" / "status.json").read_text(encoding="utf-8"))

    def test_download_normalizes_caption_and_records_job(self) -> None:
        result = self.run_script("download-video.sh", str(self.workspace), "https://example.test/watch?v=test-video")
        job_dir = self.workspace / "jobs" / "test-video"
        status = self.read_status()
        self.assertIn("Download complete", result.stdout)
        self.assertEqual(status["state"], "needs_translation")
        self.assertEqual(status["title"], "Test Video")
        self.assertEqual(status["durationSeconds"], 125.9)
        self.assertTrue((job_dir / "source" / "video.mp4").is_file())
        self.assertTrue((job_dir / "captions" / "en.vtt").is_file())
        self.assertFalse((job_dir / "source" / "audio.m4a").exists())
        self.assertIn("local workflow ffmpeg", (job_dir / "media-info.txt").read_text(encoding="utf-8"))

    def test_one_command_entrypoint_reaches_actionable_state(self) -> None:
        result = self.run_script(
            "process-video.sh",
            str(self.workspace),
            "https://example.test/watch?v=test-video",
            "--no-transcribe",
        )
        self.assertIn("State: needs_translation", result.stdout)
        self.assertEqual(self.read_status()["state"], "needs_translation")

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
        status = json.loads((job_dir / "status.json").read_text(encoding="utf-8"))
        self.assertIn("no percentage output", result.stdout)
        self.assertEqual(status["state"], "downloading")
        self.assertEqual(status["progress"], 100.0)

    def test_import_translation_makes_job_ready_then_cleanup_preserves_player_assets(self) -> None:
        self.run_script("download-video.sh", str(self.workspace), "https://example.test/watch?v=test-video")
        translated = Path(self.temporary.name) / "translated.vtt"
        translated.write_text(SAMPLE_VTT, encoding="utf-8")
        self.run_script(
            "import-caption.sh",
            str(self.workspace),
            "test-video",
            "zh-TW",
            str(translated),
            "--source",
            "test",
            "--label",
            "繁體中文",
        )
        status = self.read_status()
        self.assertEqual(status["state"], "ready")

        job_dir = self.workspace / "jobs" / "test-video"
        (job_dir / "whisper").mkdir()
        (job_dir / "whisper" / "scratch.txt").write_text("temporary", encoding="utf-8")
        self.run_script("clean-job.sh", str(self.workspace), "test-video", "--yes")
        self.assertTrue((job_dir / "source" / "video.mp4").is_file())
        self.assertTrue((job_dir / "captions" / "zh-TW.vtt").is_file())
        self.assertFalse((job_dir / "whisper").exists())

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

    def test_uninstall_removes_stale_environment_session_descriptor(self) -> None:
        descriptor = self.workspace / ".insu-environment-session.json"
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

    def test_medium_is_the_default_local_model(self) -> None:
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
        self.assertIn('caption_state_value "$CAPTION_STATE" DEFAULT_MODEL', transcribe_source)
        self.assertIn('model_name="${model_name:-medium}"', transcribe_source)
        self.assertIn('model_name="${model_name:-medium}"', update_source)
        self.assertIn('args.model = args.model or "medium"', transcriber_source)

    def test_api_transcription_can_use_the_active_server_session_without_weakening_consent(self) -> None:
        source = (SCRIPTS / "transcribe.sh").read_text(encoding="utf-8")
        helper = (SCRIPTS / "environment_session.py").read_text(encoding="utf-8")
        self.assertIn("--allow-api-upload", source)
        self.assertIn("--consent-to-upload", source)
        self.assertIn("CAPTION_ENVIRONMENT_SESSION", source)
        self.assertIn("os.execvpe", helper)
        self.assertNotIn("print(value", helper)

        check = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "environment_session.py"),
                "--workspace",
                str(self.workspace),
                "--name",
                "OPENAI_API_KEY",
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
        self.assertIn("environment session", check.stdout)


if __name__ == "__main__":
    unittest.main()
