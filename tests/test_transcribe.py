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
        self.assertEqual(
            transcribe_media.provider_language_parameter("xai", "en-US"), "en"
        )
        with self.assertRaisesRegex(ValueError, "xAI speech-to-text"):
            transcribe_media.provider_language_parameter("xai", "yue-HK")
        with self.assertRaisesRegex(ValueError, "does not accept language"):
            transcribe_media.engine_language_code("yue-HK")
        with self.assertRaisesRegex(ValueError, "invalid BCP 47"):
            transcribe_media.canonical_language_tag("en_US")

    def test_cloud_language_detection_normalizes_names_and_engine_aliases(self) -> None:
        self.assertEqual(
            transcribe_media.detected_language_from_payload(
                "openai", {"language": "english"}
            ),
            "en",
        )
        self.assertEqual(
            transcribe_media.detected_language_from_payload(
                "groq", {"language": "Tagalog"}
            ),
            "fil",
        )
        self.assertEqual(
            transcribe_media.detected_language_from_payload(
                "openrouter", {"language": "jw"}
            ),
            "jv",
        )
        with self.assertRaisesRegex(ValueError, "does not accept language"):
            transcribe_media.detected_language_from_payload(
                "openai", {"language": "klingon"}
            )

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
        args = Namespace(
            provider="openai",
            consent_to_audio_upload=False,
            model="whisper-1",
        )
        with self.assertRaisesRegex(RuntimeError, "consent-to-audio-upload"):
            transcribe_media.transcribe_cloud(args)
        args.consent_to_audio_upload = True
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "OPENAI_API_KEY"):
                transcribe_media.transcribe_cloud(args)

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
                provider="openai",
                consent_to_audio_upload=True,
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
                segments, words, language, engine_language, chunks = (
                    transcribe_media.transcribe_cloud(args)
                )

            self.assertEqual(requests[0]["timestamp_granularities"], ["segment", "word"])
            self.assertEqual(requests[0]["language"], "en")
            self.assertEqual(words[-1]["word"], "world.")
            self.assertEqual(segments[0]["text"], "Hello world.")
            self.assertEqual(language, "en-US")
            self.assertEqual(engine_language, "en")
            self.assertEqual(len(chunks), 1)

    def test_openai_auto_detection_reuses_valid_chunk_results_without_reupload(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            input_path = root / "audio.m4a"
            ffmpeg = root / "ffmpeg"
            input_path.write_bytes(b"audio")
            ffmpeg.write_bytes(b"ffmpeg")
            calls = 0

            def prepare_chunks(
                input_file: Path,
                ffmpeg_file: Path,
                chunk_dir: Path,
                chunk_seconds: int,
            ) -> list[Path]:
                del input_file, ffmpeg_file, chunk_seconds
                chunk_dir.mkdir(parents=True, exist_ok=True)
                chunk = chunk_dir / "chunk-0000.mp3"
                chunk.write_bytes(b"chunk")
                return [chunk]

            def transcribe_chunk(*args: object, **kwargs: object) -> dict[str, object]:
                nonlocal calls
                del args, kwargs
                calls += 1
                return {
                    "language": "english",
                    "duration": 2.0,
                    "segments": [
                        {"start": 0.0, "end": 2.0, "text": "Hello world."}
                    ],
                    "words": [
                        {"start": 0.0, "end": 0.7, "word": "Hello"},
                        {"start": 0.8, "end": 2.0, "word": "world."},
                    ],
                }

            args = Namespace(
                provider="openai",
                consent_to_audio_upload=True,
                model="whisper-1",
                language="und",
                output_dir=root / "output",
                input=input_path,
                ffmpeg=ffmpeg,
                chunk_seconds=600,
            )
            with (
                patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}, clear=True),
                patch.object(transcribe_media, "prepare_api_chunks", side_effect=prepare_chunks),
                patch.object(transcribe_media, "transcribe_chunk", side_effect=transcribe_chunk),
            ):
                first = transcribe_media.transcribe_cloud(args)
                second = transcribe_media.transcribe_cloud(args)

            self.assertEqual(first[2:4], ("en", "en"))
            self.assertEqual(second[2:4], ("en", "en"))
            self.assertEqual(calls, 1)
            segments, words, language, engine_language, chunks = first
            transcribe_media.write_artifacts(
                args.output_dir,
                segments,
                words,
                provider="openai",
                model="whisper-1",
                language=language,
                engine_language=engine_language,
                chunks=chunks,
            )
            transcript = json.loads(
                (args.output_dir / "transcript.json").read_text(encoding="utf-8")
            )
            self.assertEqual(transcript["schemaVersion"], 3)
            self.assertEqual(
                transcript["processor"],
                {
                    "provider": "openai",
                    "service": "audio/transcriptions",
                    "model": "whisper-1",
                },
            )
            self.assertEqual(transcript["language"], "en")
            self.assertEqual(transcript["engineLanguage"], "en")

    def test_every_cloud_contract_requires_word_timing(self) -> None:
        contracts = {
            "openai": "whisper-1",
            "groq": "whisper-large-v3",
            "elevenlabs": "scribe_v2",
            "xai": None,
            "openrouter": "openai/whisper-large-v3",
        }
        for provider, model in contracts.items():
            identity = transcribe_media.processor_identity(provider, model)
            self.assertEqual(identity["provider"], provider)
            self.assertEqual(identity["model"], model)
        with self.assertRaisesRegex(ValueError, "word timing is locked"):
            transcribe_media.validate_model("openrouter", "groq/whisper-large-v3")
        with self.assertRaisesRegex(ValueError, "word timestamps"):
            transcribe_media.normalize_words([])

    def test_every_cloud_provider_rejects_a_response_without_words(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            input_path = root / "audio.m4a"
            chunk = root / "chunk.mp3"
            ffmpeg = root / "ffmpeg"
            for path in (input_path, chunk, ffmpeg):
                path.write_bytes(b"audio")
            contracts = {
                "openai": ("whisper-1", "OPENAI_API_KEY"),
                "groq": ("whisper-large-v3", "GROQ_API_KEY"),
                "elevenlabs": ("scribe_v2", "ELEVENLABS_API_KEY"),
                "xai": (None, "XAI_API_KEY"),
                "openrouter": ("openai/whisper-large-v3", "OPENROUTER_API_KEY"),
            }
            for provider, (model, key_name) in contracts.items():
                output = root / provider
                output.mkdir()
                language_payload = (
                    {"language_code": "en"}
                    if provider == "elevenlabs"
                    else {"language": "English" if provider == "xai" else "en"}
                )
                args = Namespace(
                    provider=provider,
                    consent_to_audio_upload=True,
                    model=model,
                    language=None,
                    output_dir=output,
                    input=input_path,
                    ffmpeg=ffmpeg,
                    chunk_seconds=600,
                )
                with (
                    self.subTest(provider=provider),
                    patch.dict(os.environ, {key_name: "test-key"}, clear=True),
                    patch.object(transcribe_media, "prepare_api_chunks", return_value=[chunk]),
                    patch.object(
                        transcribe_media,
                        "transcribe_chunk",
                        return_value={
                            **language_payload,
                            "duration": 1.0,
                            "segments": [
                                {"start": 0.0, "end": 1.0, "text": "No words"}
                            ],
                        },
                    ),
                ):
                    with self.assertRaisesRegex(ValueError, "word timestamps"):
                        transcribe_media.transcribe_cloud(args)

    def test_groq_adapter_requests_word_timestamps(self) -> None:
        from transcription_providers import groq_provider

        with tempfile.TemporaryDirectory() as temporary:
            audio_path = Path(temporary) / "audio.mp3"
            audio_path.write_bytes(b"audio")
            requests: list[dict[str, object]] = []

            class FakeTranscriptions:
                def create(self, *, file: object, **request: object) -> dict[str, object]:
                    del file
                    requests.append(request)
                    return {"words": [{"text": "hello", "start": 0, "end": 1}]}

            fake_groq = SimpleNamespace(
                Groq=lambda: SimpleNamespace(
                    audio=SimpleNamespace(transcriptions=FakeTranscriptions())
                )
            )
            with patch.dict(sys.modules, {"groq": fake_groq}):
                groq_provider.transcribe(
                    audio_path, model="whisper-large-v3", language="en"
                )

            self.assertEqual(requests[0]["response_format"], "verbose_json")
            self.assertEqual(
                requests[0]["timestamp_granularities"], ["segment", "word"]
            )

    def test_elevenlabs_adapter_requests_word_timestamps(self) -> None:
        from transcription_providers import elevenlabs_provider

        with tempfile.TemporaryDirectory() as temporary:
            audio_path = Path(temporary) / "audio.mp3"
            audio_path.write_bytes(b"audio")
            requests: list[dict[str, object]] = []

            class FakeSpeechToText:
                def convert(self, *, file: object, **request: object) -> dict[str, object]:
                    del file
                    requests.append(request)
                    return {"words": [{"text": "hello", "start": 0, "end": 1}]}

            fake_client_module = SimpleNamespace(
                ElevenLabs=lambda: SimpleNamespace(speech_to_text=FakeSpeechToText())
            )
            with patch.dict(
                sys.modules,
                {
                    "elevenlabs": SimpleNamespace(),
                    "elevenlabs.client": fake_client_module,
                },
            ):
                elevenlabs_provider.transcribe(
                    audio_path, model="scribe_v2", language="en"
                )

            self.assertEqual(requests[0]["timestamps_granularity"], "word")

    def test_xai_adapter_keeps_file_after_options_and_returns_words(self) -> None:
        from transcription_providers import xai_provider

        with tempfile.TemporaryDirectory() as temporary:
            audio_path = Path(temporary) / "audio.mp3"
            audio_path.write_bytes(b"audio")
            requests: list[dict[str, object]] = []

            class FakeResponse:
                def raise_for_status(self) -> None:
                    return None

                def json(self) -> dict[str, object]:
                    return {"words": [{"text": "hello", "start": 0, "end": 1}]}

            def fake_post(url: str, **request: object) -> FakeResponse:
                requests.append({"url": url, **request})
                return FakeResponse()

            with (
                patch.dict(os.environ, {"XAI_API_KEY": "test-key"}, clear=True),
                patch.dict(sys.modules, {"httpx": SimpleNamespace(post=fake_post)}),
            ):
                payload = xai_provider.transcribe(audio_path, model=None, language="en")

            self.assertEqual(
                requests[0]["data"],
                [("format", "true"), ("language", "en"), ("filler_words", "true")],
            )
            self.assertIn("file", requests[0]["files"])
            self.assertEqual(payload["words"][0]["text"], "hello")

    def test_openrouter_adapter_requests_and_requires_word_timestamps(self) -> None:
        from transcription_providers import openrouter_provider

        with tempfile.TemporaryDirectory() as temporary:
            audio_path = Path(temporary) / "audio.mp3"
            audio_path.write_bytes(b"audio")
            clients: list[dict[str, object]] = []
            requests: list[dict[str, object]] = []

            class FakeTranscriptions:
                def create(self, *, file: object, **request: object) -> dict[str, object]:
                    del file
                    requests.append(request)
                    return {"words": [{"word": "hello", "start": 0, "end": 1}]}

            def fake_openai(**options: object) -> SimpleNamespace:
                clients.append(options)
                return SimpleNamespace(
                    audio=SimpleNamespace(transcriptions=FakeTranscriptions())
                )

            with (
                patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key"}, clear=True),
                patch.dict(sys.modules, {"openai": SimpleNamespace(OpenAI=fake_openai)}),
            ):
                openrouter_provider.transcribe(
                    audio_path, model="openai/whisper-large-v3", language="en"
                )

            self.assertEqual(clients[0]["base_url"], "https://openrouter.ai/api/v1")
            self.assertEqual(
                requests[0]["timestamp_granularities"], ["segment", "word"]
            )

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
            self.assertEqual(payload["schemaVersion"], 3)
            self.assertEqual(
                payload["processor"],
                {"provider": "local", "service": "openai-whisper", "model": "tiny"},
            )
            self.assertEqual(payload["language"], "en")
            self.assertEqual(payload["engineLanguage"], "en")
            self.assertEqual([word["word"] for word in payload["words"]], ["Test", "line."])
            self.assertIn("Test line", (output / "transcript.vtt").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
