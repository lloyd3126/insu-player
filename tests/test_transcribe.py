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
from types import SimpleNamespace
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "plugins" / "insu-player" / "skills" / "transcribe-media" / "scripts" / "transcribe_media.py"
SPEC = importlib.util.spec_from_file_location("transcribe_media", SCRIPT)
assert SPEC and SPEC.loader
transcribe_media = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(transcribe_media)


class TranscriptionTests(unittest.TestCase):
    def test_language_adapter_normalizes_bcp47_and_respects_model_capabilities(self) -> None:
        self.assertEqual(transcribe_media.canonical_language_tag("EN-us"), "en-US")
        self.assertEqual(transcribe_media.canonical_language_tag("zh-hant-tw"), "zh-Hant-TW")
        self.assertEqual(transcribe_media.engine_language_code("en-US"), "en")
        self.assertEqual(transcribe_media.engine_language_code("zh-Hant-TW"), "zh")
        self.assertEqual(transcribe_media.engine_language_code("pt-BR"), "pt")
        self.assertEqual(transcribe_media.engine_language_code("jv-ID"), "jw")
        self.assertEqual(transcribe_media.engine_language_code("fil-PH"), "tl")
        self.assertIsNone(transcribe_media.engine_language_code("und"))
        self.assertIsNone(transcribe_media.engine_language_code(None))
        with self.assertRaisesRegex(ValueError, "does not accept language"):
            transcribe_media.engine_language_code("yue-HK")
        with self.assertRaisesRegex(ValueError, "invalid BCP 47"):
            transcribe_media.canonical_language_tag("en_US")

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

    def test_word_timestamps_are_normalized(self) -> None:
        words = transcribe_media.normalize_words(
            [
                {"start": 0.1, "end": 0.4, "word": " Hello"},
                {"start": 0.5, "end": 0.9, "word": "world."},
            ],
            offset=60,
        )
        self.assertEqual(
            words,
            [
                {"id": 0, "start": 60.1, "end": 60.4, "word": "Hello"},
                {"id": 1, "start": 60.5, "end": 60.9, "word": "world."},
            ],
        )

    def test_openai_requires_explicit_upload_consent_and_environment_key(self) -> None:
        args = Namespace(consent_to_upload=False, model="whisper-1")
        with self.assertRaisesRegex(RuntimeError, "consent-to-upload"):
            transcribe_media.transcribe_openai(args)
        args.consent_to_upload = True
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "OPENAI_API_KEY"):
                transcribe_media.transcribe_openai(args)

    def test_openai_requests_segment_and_word_timestamps(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            input_path = root / "audio.m4a"
            chunk = root / "chunk.mp3"
            ffmpeg = root / "ffmpeg"
            for path in (input_path, chunk, ffmpeg):
                path.write_bytes(b"audio")
            requests: list[dict[str, object]] = []

            class FakeTranscriptions:
                def create(self, *, file: object, **request: object) -> dict[str, object]:
                    requests.append(request)
                    return {
                        "language": "en",
                        "duration": 2.0,
                        "segments": [{"start": 0.0, "end": 2.0, "text": "Hello world."}],
                        "words": [
                            {"start": 0.0, "end": 0.7, "word": "Hello"},
                            {"start": 0.8, "end": 2.0, "word": "world."},
                        ],
                    }

            fake_client = SimpleNamespace(audio=SimpleNamespace(transcriptions=FakeTranscriptions()))
            fake_openai = SimpleNamespace(OpenAI=lambda: fake_client)
            args = Namespace(
                consent_to_upload=True,
                model="whisper-1",
                language="en-US",
                output_dir=root,
                input=input_path,
                ffmpeg=ffmpeg,
                chunk_seconds=600,
            )
            with (
                patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}, clear=True),
                patch.dict(sys.modules, {"openai": fake_openai}),
                patch.object(transcribe_media, "prepare_api_chunks", return_value=[chunk]),
            ):
                segments, words, language, chunks = transcribe_media.transcribe_openai(args)

            self.assertEqual(requests[0]["timestamp_granularities"], ["segment", "word"])
            self.assertEqual(requests[0]["language"], "en")
            self.assertEqual(words[-1]["word"], "world.")
            self.assertEqual(segments[0]["text"], "Hello world.")
            self.assertEqual(language, "en-US")
            self.assertEqual(chunks, 1)

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
printf '%s\n' '{"language":"en","segments":[{"start":0.0,"end":2.0,"text":"Test line.","words":[{"start":0.0,"end":1.0,"word":"Test"},{"start":1.0,"end":2.0,"word":"line."}]}]}' > "$output/result.json"
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
            self.assertEqual(payload["schemaVersion"], 2)
            self.assertEqual(payload["provider"], "local")
            self.assertEqual(payload["model"], "tiny")
            self.assertEqual(payload["language"], "en")
            self.assertEqual(payload["engineLanguage"], "en")
            self.assertEqual([word["word"] for word in payload["words"]], ["Test", "line."])
            self.assertIn("Test line", (output / "transcript.vtt").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
