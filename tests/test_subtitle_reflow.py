import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REFLOW = ROOT / "plugins/insu-player/skills/translate-subtitles/scripts/reflow_subtitles.py"
PROOFREAD = ROOT / "plugins/insu-player/skills/proofread-subtitles/scripts/proofread_subtitles.py"


def transcript_payload(words):
    return {
        "schemaVersion": 3,
        "processor": {
            "provider": "local",
            "service": "openai-whisper",
            "model": "medium",
        },
        "language": "en",
        "engineLanguage": "en",
        "timingUnitKind": "word",
        "durationSeconds": words[-1]["end"],
        "chunks": [
            {
                "index": 0,
                "startSeconds": 0.0,
                "endSeconds": words[-1]["end"],
                "sha256": "0" * 64,
            }
        ],
        "segments": [
            {
                "id": 0,
                "start": words[0]["start"],
                "end": words[-1]["end"],
                "text": " ".join(word["word"] for word in words),
                "origin": "provider",
            }
        ],
        "words": words,
        "text": " ".join(word["word"] for word in words),
    }


class SubtitleRevisionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.transcript = self.root / "transcript.json"
        self.transcript.write_text(
            json.dumps(
                transcript_payload(
                    [
                        {"id": 0, "word": "Hello", "start": 0.0, "end": 0.5},
                        {"id": 1, "word": "world.", "start": 0.5, "end": 1.0},
                        {"id": 2, "word": "Next", "start": 1.1, "end": 1.5},
                        {"id": 3, "word": "sentence!", "start": 1.5, "end": 2.2},
                    ]
                )
            ),
            encoding="utf-8",
        )

    def tearDown(self):
        self.temporary.cleanup()

    def run_script(self, script: Path, *arguments: str, check: bool = True):
        return subprocess.run(
            [sys.executable, str(script), *arguments],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=check,
        )

    def prepare(self, mode="translate", output_language="zh-TW", script=REFLOW):
        manifest = self.root / f"{mode}.json"
        input_vtt = self.root / f"{mode}.input.vtt"
        arguments = [
            "prepare",
            "--source-transcript",
            str(self.transcript),
            "--manifest",
            str(manifest),
            "--mode",
            mode,
            "--source-language",
            "en",
            "--output-language",
            output_language,
            "--timing-source-artifact",
            "source-model-en-r1",
            "--reference-artifact",
            "source-manual-en-r1",
            "--source-output",
            str(input_vtt),
        ]
        if script == PROOFREAD:
            arguments = [
                "prepare",
                "--source-transcript",
                str(self.transcript),
                "--manifest",
                str(manifest),
                "--language",
                "en",
                "--timing-source-artifact",
                "source-model-en-r1",
                "--reference-artifact",
                "source-manual-en-r1",
                "--source-output",
                str(input_vtt),
            ]
        self.run_script(script, *arguments)
        return manifest, input_vtt

    def finish_content(self, manifest: Path, outputs: list[str]):
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        boundaries = self.root / f"{manifest.stem}.boundaries.json"
        boundaries.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "boundaryAfterUnitIds": [
                        segment["sourceUnitEnd"] for segment in payload["segments"]
                    ],
                }
            ),
            encoding="utf-8",
        )
        self.run_script(
            REFLOW,
            "record-sentence-review",
            "--manifest",
            str(manifest),
            "--boundaries",
            str(boundaries),
        )
        self.run_script(
            REFLOW,
            "record-content-processor",
            "--manifest",
            str(manifest),
        )
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        for segment, output in zip(payload["segments"], outputs, strict=True):
            segment["draftOutputText"] = output
            segment["outputText"] = output
        manifest.write_text(json.dumps(payload), encoding="utf-8")
        return payload

    def test_translation_manifest_records_model_timing_and_manual_reference(self):
        manifest, input_vtt = self.prepare()
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        self.assertEqual(payload["schemaVersion"], 5)
        self.assertEqual(payload["mode"], "translate")
        self.assertEqual(payload["sourceLanguage"], "en")
        self.assertEqual(payload["outputLanguage"], "zh-TW")
        self.assertEqual(payload["timingSourceArtifactId"], "source-model-en-r1")
        self.assertEqual(payload["sourceContentArtifactId"], "source-model-en-r1")
        self.assertEqual(payload["sourceContentKind"], "model-transcript")
        self.assertEqual(payload["referenceArtifactIds"], ["source-manual-en-r1"])
        self.assertEqual(
            payload["timingProcessor"],
            {"provider": "local", "service": "openai-whisper", "model": "medium"},
        )
        self.assertIsNone(payload["contentProcessor"])
        self.assertEqual(len(payload["segments"]), 2)
        self.assertTrue(input_vtt.read_text(encoding="utf-8").startswith("WEBVTT"))

    def test_translation_renders_synchronized_complete_sentence_tracks(self):
        manifest, _ = self.prepare()
        self.finish_content(manifest, ["哈囉 世界", "下一個 句子"])
        input_vtt = self.root / "input.vtt"
        output_vtt = self.root / "output.vtt"
        self.run_script(
            REFLOW,
            "render",
            "--manifest",
            str(manifest),
            "--input-output",
            str(input_vtt),
            "--output",
            str(output_vtt),
        )
        result = self.run_script(
            REFLOW,
            "validate-pair",
            "--input",
            str(input_vtt),
            "--output",
            str(output_vtt),
        )
        self.assertIn("Validated 2 synchronized", result.stdout)
        self.assertIn("哈囉 世界", output_vtt.read_text(encoding="utf-8"))

    def test_proofread_skill_preserves_language_and_uses_same_contract(self):
        manifest, _ = self.prepare("proofread", "en", PROOFREAD)
        payload = self.finish_content(
            manifest, ["Hello, world.", "Next sentence!"],
        )
        self.assertEqual(payload["mode"], "proofread")
        self.assertEqual(payload["sourceLanguage"], payload["outputLanguage"])

    def test_translate_mode_rejects_same_language(self):
        result = self.run_script(
            REFLOW,
            "prepare",
            "--source-transcript",
            str(self.transcript),
            "--manifest",
            str(self.root / "invalid.json"),
            "--mode",
            "translate",
            "--source-language",
            "en",
            "--output-language",
            "en",
            "--timing-source-artifact",
            "source-model-en-r1",
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("different source and output languages", result.stdout)

    def test_render_rejects_schema_four_without_compatibility(self):
        manifest = self.root / "old.json"
        manifest.write_text('{"schemaVersion": 4}', encoding="utf-8")
        result = self.run_script(
            REFLOW,
            "render",
            "--manifest",
            str(manifest),
            "--input-output",
            str(self.root / "input.vtt"),
            "--output",
            str(self.root / "output.vtt"),
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("schemaVersion 5", result.stdout)

    def test_translation_can_use_validated_proofread_text_with_original_timing(self):
        proofread, _ = self.prepare("proofread", "en", PROOFREAD)
        self.finish_content(proofread, ["Hello, world.", "Next sentence!"])
        translation = self.root / "translation-from-proofread.json"
        self.run_script(
            REFLOW,
            "prepare",
            "--source-transcript",
            str(self.transcript),
            "--manifest",
            str(translation),
            "--mode",
            "translate",
            "--source-language",
            "en",
            "--output-language",
            "ja",
            "--timing-source-artifact",
            "source-model-en-r1",
            "--source-content-artifact",
            "proofread-en-r1",
            "--source-content-manifest",
            str(proofread),
        )
        payload = json.loads(translation.read_text(encoding="utf-8"))
        self.assertEqual(payload["sourceContentArtifactId"], "proofread-en-r1")
        self.assertEqual(payload["sourceContentKind"], "proofread")
        self.assertEqual(payload["referenceArtifactIds"], ["source-manual-en-r1"])
        self.assertEqual(
            [segment["sourceText"] for segment in payload["segments"]],
            ["Hello, world.", "Next sentence!"],
        )
        self.assertRegex(payload["sourceContentChecksum"], r"^[0-9a-f]{64}$")

    def test_agent_content_processor_does_not_require_a_model(self):
        manifest, _ = self.prepare()
        payload = self.finish_content(manifest, ["哈囉 世界", "下一個 句子"])
        self.assertEqual(payload["contentProcessor"]["provider"], "agent")
        self.assertEqual(payload["contentProcessor"]["service"], "codex")
        self.assertNotIn("model", payload["contentProcessor"])

    def test_content_processor_requires_agent_reviewed_sentence_boundaries(self):
        manifest, _ = self.prepare()
        result = self.run_script(
            REFLOW,
            "record-content-processor",
            "--manifest",
            str(manifest),
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sentenceReview", result.stdout)

    def test_removed_content_provider_arguments_are_rejected(self):
        manifest, _ = self.prepare()
        result = self.run_script(
            REFLOW,
            "record-content-processor",
            "--manifest",
            str(manifest),
            "--provider",
            "openai",
            "--model",
            "gpt-test",
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unrecognized arguments", result.stdout)

    def test_implausible_single_sentence_is_rejected_after_review(self):
        transcript = self.root / "long-transcript.json"
        transcript.write_text(
            json.dumps(
                transcript_payload(
                    [
                        {
                            "id": index,
                            "word": f"word{index}",
                            "start": index * 0.2,
                            "end": index * 0.2 + 0.15,
                        }
                        for index in range(161)
                    ]
                )
            ),
            encoding="utf-8",
        )
        manifest = self.root / "long.json"
        self.run_script(
            REFLOW,
            "prepare",
            "--source-transcript",
            str(transcript),
            "--manifest",
            str(manifest),
            "--mode",
            "proofread",
            "--source-language",
            "en",
            "--output-language",
            "en",
            "--timing-source-artifact",
            "source-model-en-r1",
        )
        boundaries = self.root / "long-boundaries.json"
        boundaries.write_text(
            json.dumps(
                {"schemaVersion": 1, "boundaryAfterUnitIds": ["U000161"]}
            ),
            encoding="utf-8",
        )
        self.run_script(
            REFLOW,
            "record-sentence-review",
            "--manifest",
            str(manifest),
            "--boundaries",
            str(boundaries),
        )
        self.run_script(
            REFLOW,
            "record-content-processor",
            "--manifest",
            str(manifest),
        )
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        payload["segments"][0]["draftOutputText"] = "reviewed"
        payload["segments"][0]["outputText"] = "reviewed"
        manifest.write_text(json.dumps(payload), encoding="utf-8")
        result = self.run_script(
            REFLOW,
            "render",
            "--manifest",
            str(manifest),
            "--input-output",
            str(self.root / "long-input.vtt"),
            "--output",
            str(self.root / "long-output.vtt"),
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SOURCE_SENTENCE_IMPLAUSIBLE", result.stdout)


if __name__ == "__main__":
    unittest.main()
