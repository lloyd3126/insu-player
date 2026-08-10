import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REFLOW = ROOT / "plugins/insu-player/skills/translate-subtitles/scripts/reflow_subtitles.py"
PROOFREAD = ROOT / "plugins/insu-player/skills/proofread-subtitles/scripts/proofread_subtitles.py"


class SubtitleRevisionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.transcript = self.root / "transcript.json"
        self.transcript.write_text(
            json.dumps(
                {
                    "provider": "local",
                    "model": "medium",
                    "language": "en",
                    "words": [
                        {"id": 0, "word": "Hello", "start": 0.0, "end": 0.5},
                        {"id": 1, "word": "world.", "start": 0.5, "end": 1.0},
                        {"id": 2, "word": "Next", "start": 1.1, "end": 1.5},
                        {"id": 3, "word": "sentence!", "start": 1.5, "end": 2.2},
                    ],
                }
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
        self.run_script(
            REFLOW,
            "record-content-model",
            "--manifest",
            str(manifest),
            "--provider",
            "local",
            "--model",
            "llama-3.2",
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
        self.assertEqual(payload["schemaVersion"], 3)
        self.assertEqual(payload["mode"], "translate")
        self.assertEqual(payload["sourceLanguage"], "en")
        self.assertEqual(payload["outputLanguage"], "zh-TW")
        self.assertEqual(payload["timingSourceArtifactId"], "source-model-en-r1")
        self.assertEqual(payload["referenceArtifactIds"], ["source-manual-en-r1"])
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

    def test_render_rejects_schema_two_without_compatibility(self):
        manifest = self.root / "old.json"
        manifest.write_text('{"schemaVersion": 2}', encoding="utf-8")
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
        self.assertIn("schemaVersion 3", result.stdout)


if __name__ == "__main__":
    unittest.main()
