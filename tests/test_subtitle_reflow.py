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
TRANSLATE_SCRIPT = (
    REPO_ROOT
    / "plugins"
    / "insu-player"
    / "skills"
    / "translate-subtitles"
    / "scripts"
    / "reflow_subtitles.py"
)
WATCH_SCRIPTS = REPO_ROOT / "plugins" / "insu-player" / "skills" / "watch-video" / "scripts"


SAMPLE_TRANSCRIPT = {
    "schemaVersion": 1,
    "provider": "local",
    "model": "tiny",
    "language": "en",
    "segments": [
        {"id": 0, "start": 1.0, "end": 2.0, "text": "Hello, world."},
        {"id": 1, "start": 2.0, "end": 3.5, "text": "This works."},
    ],
    "words": [
        {"id": 0, "start": 1.0, "end": 1.4, "word": "Hello,"},
        {"id": 1, "start": 1.5, "end": 1.9, "word": "world."},
        {"id": 2, "start": 2.0, "end": 2.4, "word": "This"},
        {"id": 3, "start": 2.5, "end": 3.5, "word": "works."},
    ],
}


class SubtitleReflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source_transcript = self.root / "transcript.json"
        self.manifest = self.root / "bilingual.json"
        self.english_vtt = self.root / "en.final.vtt"
        self.chinese_vtt = self.root / "zh-TW.final.vtt"
        self.source_transcript.write_text(json.dumps(SAMPLE_TRANSCRIPT), encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_reflow(self, *arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(TRANSLATE_SCRIPT), *arguments],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=check,
        )

    def prepare_manifest(self) -> dict[str, object]:
        self.run_reflow(
            "prepare",
            "--source-transcript",
            str(self.source_transcript),
            "--manifest",
            str(self.manifest),
            "--english-output",
            str(self.english_vtt),
        )
        return json.loads(self.manifest.read_text(encoding="utf-8"))

    def render_pair(self) -> dict[str, object]:
        payload = self.prepare_manifest()
        segments = payload["segments"]
        self.assertIsInstance(segments, list)
        translations = [("你好，世界。", "你好，世界。"), ("這可以運作。", "這能正常運作。")]
        for segment, (draft, polished) in zip(segments, translations):
            segment["draftTraditionalChinese"] = draft
            segment["traditionalChinese"] = polished
        self.manifest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        self.run_reflow(
            "render",
            "--manifest",
            str(self.manifest),
            "--english-output",
            str(self.english_vtt),
            "--traditional-chinese-output",
            str(self.chinese_vtt),
        )
        return payload

    def test_model_word_timing_builds_complete_sentences_and_shared_cues(self) -> None:
        payload = self.render_pair()
        segments = payload["segments"]
        self.assertEqual(
            [(segment["start"], segment["end"], segment["english"]) for segment in segments],
            [
                ("00:00:01.000", "00:00:02.000", "Hello, world."),
                ("00:00:02.000", "00:00:03.500", "This works."),
            ],
        )
        english = self.english_vtt.read_text(encoding="utf-8")
        chinese = self.chinese_vtt.read_text(encoding="utf-8")
        self.assertIn("Hello world", english)
        self.assertIn("This works", english)
        self.assertIn("你好 世界", chinese)
        self.assertIn("這能正常運作", chinese)
        display_text = "\n".join(
            line
            for line in (english + chinese).splitlines()
            if line
            and "-->" not in line
            and not line.startswith(("WEBVTT", "Kind:", "Language:", "S0"))
        )
        for punctuation in (",", ".", "，", "。"):
            self.assertNotIn(punctuation, display_text)
        english_timings = [line for line in english.splitlines() if "-->" in line]
        chinese_timings = [line for line in chinese.splitlines() if "-->" in line]
        self.assertEqual(english_timings, chinese_timings)
        result = self.run_reflow(
            "validate-pair",
            "--english",
            str(self.english_vtt),
            "--traditional-chinese",
            str(self.chinese_vtt),
        )
        self.assertIn("Validated 2 synchronized bilingual cues", result.stdout)

    def test_render_rejects_internal_translation_markers(self) -> None:
        payload = self.prepare_manifest()
        for segment in payload["segments"]:
            segment["draftTraditionalChinese"] = "初稿"
            segment["traditionalChinese"] = "正常翻譯"
        payload["segments"][0]["traditionalChinese"] = "錯誤 XQZCUEZ 標記"
        self.manifest.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        result = self.run_reflow(
            "render",
            "--manifest",
            str(self.manifest),
            "--english-output",
            str(self.english_vtt),
            "--traditional-chinese-output",
            str(self.chinese_vtt),
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("internal cue marker", result.stdout)

    def test_pair_import_preserves_old_tracks_and_marks_job_ready(self) -> None:
        self.render_pair()
        workspace = self.root / "workspace"
        runtime_python = workspace / ".agent-tools" / "insu-player" / ".venv" / "bin" / "python"
        runtime_python.parent.mkdir(parents=True)
        os.symlink(sys.executable, runtime_python)
        job_dir = workspace / "jobs" / "video-id"
        captions = job_dir / "captions"
        source = job_dir / "source"
        captions.mkdir(parents=True)
        source.mkdir()
        (source / "video.mp4").write_bytes(b"video")
        old_english = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOld English\n"
        old_chinese = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n舊字幕\n"
        (captions / "en.vtt").write_text(old_english, encoding="utf-8")
        (captions / "zh-TW.vtt").write_text(old_chinese, encoding="utf-8")
        subprocess.run(
            [
                sys.executable,
                str(WATCH_SCRIPTS / "job_state.py"),
                "init",
                "--job-dir",
                str(job_dir),
                "--video-id",
                "video-id",
                "--source-url",
                "https://example.test/video",
                "--title",
                "Video",
            ],
            cwd=REPO_ROOT,
            stdout=subprocess.PIPE,
            check=True,
        )
        result = subprocess.run(
            [
                str(WATCH_SCRIPTS / "import-bilingual-captions.sh"),
                str(workspace),
                "video-id",
                str(self.english_vtt),
                str(self.chinese_vtt),
                "--force",
            ],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=True,
        )
        status = json.loads((job_dir / "status.json").read_text(encoding="utf-8"))
        self.assertIn("shared sentence timing", result.stdout)
        self.assertEqual((captions / "en.pre-reflow.vtt").read_text(encoding="utf-8"), old_english)
        self.assertEqual((captions / "zh-TW.pre-reflow.vtt").read_text(encoding="utf-8"), old_chinese)
        self.assertEqual((captions / "en.vtt").read_text(encoding="utf-8"), self.english_vtt.read_text(encoding="utf-8"))
        self.assertEqual((captions / "zh-TW.vtt").read_text(encoding="utf-8"), self.chinese_vtt.read_text(encoding="utf-8"))
        self.assertEqual(status["state"], "ready")
        self.assertEqual(status["subtitleTracks"]["en"]["source"], "agent-sentence-reflow")
        self.assertEqual(status["subtitleTracks"]["zh-TW"]["source"], "agent-sentence-reflow")

    def test_local_model_transcription_creates_sentence_plan_for_translation(self) -> None:
        workspace = self.root / "model-workspace"
        runtime = workspace / ".agent-tools" / "insu-player"
        runtime_python = runtime / ".venv" / "bin" / "python"
        runtime_whisper = runtime / ".venv" / "bin" / "whisper"
        runtime_ytdlp = runtime / ".venv" / "bin" / "yt-dlp"
        runtime_bin = runtime / "bin"
        runtime_python.parent.mkdir(parents=True)
        runtime_bin.mkdir(parents=True)
        os.symlink(sys.executable, runtime_python)

        fake_whisper = '''#!/bin/sh
set -eu
output=''
previous=''
for argument in "$@"; do
  if [ "$previous" = '--output_dir' ]; then output="$argument"; fi
  previous="$argument"
done
mkdir -p "$output"
printf '%s\n' '{"language":"en","segments":[{"start":0.0,"end":2.0,"text":"Hello, world.","words":[{"start":0.0,"end":0.8,"word":"Hello,"},{"start":0.9,"end":2.0,"word":"world."}]}]}' > "$output/result.json"
'''
        runtime_whisper.write_text(fake_whisper, encoding="utf-8")
        for executable in (runtime_whisper, runtime_ytdlp, runtime_bin / "deno", runtime_bin / "ffmpeg"):
            if not executable.exists():
                executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            executable.chmod(executable.stat().st_mode | stat.S_IXUSR)

        job_dir = workspace / "jobs" / "video-id"
        source = job_dir / "source"
        source.mkdir(parents=True)
        (source / "video.mp4").write_bytes(b"video")
        (source / "audio.m4a").write_bytes(b"audio")
        subprocess.run(
            [
                sys.executable,
                str(WATCH_SCRIPTS / "job_state.py"),
                "init",
                "--job-dir",
                str(job_dir),
                "--video-id",
                "video-id",
                "--source-url",
                "https://example.test/video",
                "--title",
                "Video",
            ],
            cwd=REPO_ROOT,
            stdout=subprocess.PIPE,
            check=True,
        )
        subprocess.run(
            [
                str(WATCH_SCRIPTS / "transcribe.sh"),
                str(workspace),
                "video-id",
                "--provider",
                "local",
                "--model",
                "tiny",
                "--language",
                "en",
                "--track",
                "en",
            ],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=True,
        )

        status = json.loads((job_dir / "status.json").read_text(encoding="utf-8"))
        manifest = json.loads((job_dir / "subtitle-work" / "bilingual-sentences.json").read_text(encoding="utf-8"))
        self.assertEqual(status["state"], "needs_translation")
        self.assertEqual(status["subtitleWorkflow"]["stage"], "draft_translation")
        self.assertEqual(status["subtitleWorkflow"]["provider"], "local")
        self.assertEqual(status["subtitleWorkflow"]["model"], "tiny")
        self.assertEqual(status["subtitleTracks"]["en"]["source"], "local-model-sentence-reflow")
        self.assertEqual(manifest["sourceFormat"], "model-word-transcript")
        self.assertEqual(manifest["sourceProvider"], "local")
        self.assertIn("Hello world", (job_dir / "captions" / "en.vtt").read_text(encoding="utf-8"))

    def test_translation_download_skips_all_youtube_subtitles_for_model_transcription(self) -> None:
        workspace = self.root / "download-workspace"
        runtime = workspace / ".agent-tools" / "insu-player"
        runtime_python = runtime / ".venv" / "bin" / "python"
        runtime_ytdlp = runtime / ".venv" / "bin" / "yt-dlp"
        runtime_bin = runtime / "bin"
        runtime_python.parent.mkdir(parents=True)
        runtime_bin.mkdir(parents=True)
        os.symlink(sys.executable, runtime_python)

        invocation_log = self.root / "yt-dlp-invocations.txt"
        fake_ytdlp = f'''#!/usr/bin/env python3
import json
import pathlib
import sys

arguments = sys.argv[1:]
with open({str(invocation_log)!r}, "a", encoding="utf-8") as handle:
    handle.write(" ".join(arguments) + "\\n")

def option(name):
    return arguments[arguments.index(name) + 1]

if "--dump-single-json" in arguments:
    print(json.dumps({{"id": "video-id", "title": "Video"}}))
elif "--write-subs" in arguments or "--write-auto-subs" in arguments:
    raise SystemExit("translation mode must not request source subtitles")
elif "--write-thumbnail" in arguments:
    output = option("--output").replace("%(ext)s", "jpg")
    path = pathlib.Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"jpeg")
    print("[download] 100.0%")
elif "--recode-video" in arguments:
    output = option("--output").replace("%(ext)s", "mp4")
    path = pathlib.Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"video")
    print("[download] 100.0%")
elif "--extract-audio" in arguments:
    output = option("--output").replace("%(ext)s", "m4a")
    path = pathlib.Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"audio")
    print("[download] 100.0%")
else:
    raise SystemExit("unexpected fake yt-dlp invocation")
'''
        runtime_ytdlp.write_text(fake_ytdlp, encoding="utf-8")
        runtime_ytdlp.chmod(runtime_ytdlp.stat().st_mode | stat.S_IXUSR)
        for executable, source in (
            (runtime_bin / "deno", "#!/bin/sh\nexit 0\n"),
            (runtime_bin / "ffmpeg", "#!/bin/sh\nprintf 'media info\\n' >&2\nexit 0\n"),
        ):
            executable.write_text(source, encoding="utf-8")
            executable.chmod(executable.stat().st_mode | stat.S_IXUSR)

        subprocess.run(
            [
                str(WATCH_SCRIPTS / "download-video.sh"),
                str(workspace),
                "https://example.test/video",
                "--translate",
                "zh-TW",
            ],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=True,
        )
        job_dir = workspace / "jobs" / "video-id"
        status = json.loads((job_dir / "status.json").read_text(encoding="utf-8"))
        raw_captions = job_dir / "youtube-captions"
        self.assertEqual(list(raw_captions.iterdir()), [])
        self.assertFalse((job_dir / "subtitle-work" / "bilingual-sentences.json").exists())
        self.assertEqual(status["state"], "needs_transcription")
        self.assertEqual(status["subtitleTracks"], {})
        self.assertEqual(status["subtitleWorkflow"]["source"], "model")
        self.assertEqual(status["subtitleWorkflow"]["stage"], "awaiting_model")
        invocations = invocation_log.read_text(encoding="utf-8")
        self.assertNotIn("--write-subs", invocations)
        self.assertNotIn("--write-auto-subs", invocations)
        self.assertNotIn("--sub-format json3", invocations)
        self.assertNotIn("--sub-format vtt", invocations)


if __name__ == "__main__":
    unittest.main()
