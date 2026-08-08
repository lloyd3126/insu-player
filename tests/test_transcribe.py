from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "plugins" / "xeruca-player" / "skills" / "transcribe-media" / "scripts" / "transcribe_media.py"
SPEC = importlib.util.spec_from_file_location("transcribe_media", SCRIPT)
assert SPEC and SPEC.loader
transcribe_media = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(transcribe_media)


class TranscriptionTests(unittest.TestCase):
    def test_timestamp_and_vtt_preserve_segment_timeline(self) -> None:
        segments = transcribe_media.normalize_segments(
            [
                {"start": 0, "end": 1.25, "text": " Hello "},
                {"start": 61.5, "end": 63, "text": "World"},
            ],
            offset=600,
        )
        vtt = transcribe_media.segments_to_vtt(segments)
        self.assertIn("00:10:00.000 --> 00:10:01.250", vtt)
        self.assertIn("00:11:01.500 --> 00:11:03.000", vtt)
        self.assertTrue(vtt.startswith("WEBVTT"))

    def test_openai_requires_explicit_upload_consent_and_environment_key(self) -> None:
        args = Namespace(consent_to_upload=False, model="whisper-1")
        with self.assertRaisesRegex(RuntimeError, "consent-to-upload"):
            transcribe_media.transcribe_openai(args)
        args.consent_to_upload = True
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "OPENAI_API_KEY"):
                transcribe_media.transcribe_openai(args)

    def test_local_provider_writes_normalized_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            media = root / "audio.wav"
            media.write_bytes(b"fake")
            whisper = root / "whisper"
            whisper.write_text(
                """#!/bin/sh
set -eu
output=''
previous=''
for argument in "$@"; do
  if [ "$previous" = '--output_dir' ]; then output="$argument"; fi
  previous="$argument"
done
mkdir -p "$output"
printf '%s\n' '{"language":"en","segments":[{"start":0.0,"end":2.0,"text":"Test line"}]}' > "$output/result.json"
""",
                encoding="utf-8",
            )
            whisper.chmod(whisper.stat().st_mode | stat.S_IXUSR)
            output = root / "output"
            subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    str(media),
                    "--output-dir",
                    str(output),
                    "--provider",
                    "local",
                    "--model",
                    "tiny",
                    "--whisper-cli",
                    str(whisper),
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                check=True,
            )
            payload = json.loads((output / "transcript.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["provider"], "local")
            self.assertEqual(payload["model"], "tiny")
            self.assertEqual(payload["language"], "en")
            self.assertIn("Test line", (output / "transcript.vtt").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
