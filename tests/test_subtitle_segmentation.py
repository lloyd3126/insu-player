import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REFLOW = ROOT / "plugins/insu-player/skills/translate-subtitles/scripts/reflow_subtitles.py"
SEGMENT = ROOT / "plugins/insu-player/skills/segment-subtitles/scripts/segment_subtitles.py"


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


class SubtitleSegmentationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.transcript = self.root / "transcript.json"
        self.transcript.write_text(
            json.dumps(
                transcript_payload(
                    [
                        {"id": 0, "word": "This", "start": 0.0, "end": 0.5},
                        {"id": 1, "word": "is", "start": 0.5, "end": 0.9},
                        {"id": 2, "word": "important", "start": 0.9, "end": 1.6},
                        {"id": 3, "word": "work.", "start": 1.6, "end": 2.4},
                    ]
                )
            ),
            encoding="utf-8",
        )

    def tearDown(self):
        self.temporary.cleanup()

    def run_script(self, script, *arguments, check=True):
        return subprocess.run(
            [sys.executable, str(script), *map(str, arguments)],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=check,
        )

    def content_manifest(self, mode="translate", output_language="zh-TW"):
        manifest = self.root / f"content-{mode}.json"
        self.run_script(
            REFLOW,
            "prepare",
            "--source-transcript",
            self.transcript,
            "--manifest",
            manifest,
            "--mode",
            mode,
            "--source-language",
            "en",
            "--output-language",
            output_language,
            "--timing-source-artifact",
            "source-model-en-r1",
        )
        self.run_script(
            REFLOW,
            "record-sentence-review",
            "--manifest",
            manifest,
            "--boundaries",
            self.sentence_boundaries(),
        )
        self.run_script(
            REFLOW,
            "record-content-processor",
            "--manifest",
            manifest,
        )
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        payload["segments"][0]["outputText"] = (
            "This is important work."
            if mode == "proofread"
            else "這是非常重要的工作"
        )
        manifest.write_text(json.dumps(payload), encoding="utf-8")
        return manifest

    def plan(self, mode="translate", output_language="zh-TW"):
        plan = self.root / f"plan-{mode}.json"
        self.run_script(
            SEGMENT,
            "prepare",
            "--content-manifest",
            self.content_manifest(mode, output_language),
            "--source-transcript",
            self.transcript,
            "--output",
            plan,
        )
        self.run_script(
            SEGMENT,
            "record-segmentation-processor",
            "--plan",
            plan,
        )
        return plan

    def sentence_boundaries(self):
        path = self.root / "sentence-boundaries.json"
        path.write_text(
            json.dumps({"schemaVersion": 1, "boundaryAfterUnitIds": ["U000004"]}),
            encoding="utf-8",
        )
        return path

    def align_single_piece(self, plan: Path):
        payload = json.loads(plan.read_text(encoding="utf-8"))
        piece = payload["contentUnits"][0]["pieces"][0]
        piece["sourceSpan"] = {
            "startUnitId": "U000001",
            "endUnitId": "U000004",
        }
        plan.write_text(json.dumps(payload), encoding="utf-8")

    def test_target_first_plan_freezes_then_renders_paired_tracks(self):
        plan = self.plan()
        payload = json.loads(plan.read_text(encoding="utf-8"))
        self.assertEqual(payload["contentMode"], "translate")
        self.assertEqual(payload["schemaVersion"], 4)
        self.assertEqual(payload["sourceContentArtifactId"], "source-model-en-r1")
        self.assertEqual(payload["sourceContentKind"], "model-transcript")
        self.assertEqual(payload["contentProcessor"]["provider"], "agent")
        self.assertEqual(payload["segmentationProcessor"]["service"], "codex")
        self.assertFalse(payload["targetFrozen"])
        self.align_single_piece(plan)
        self.run_script(SEGMENT, "freeze-target", "--plan", plan)
        self.run_script(SEGMENT, "record-alignment-review", "--plan", plan)
        validated = self.run_script(SEGMENT, "validate", "--plan", plan)
        self.assertIn('"valid": true', validated.stdout)
        input_vtt = self.root / "input.vtt"
        output_vtt = self.root / "output.vtt"
        self.run_script(
            SEGMENT,
            "render",
            "--plan",
            plan,
            "--input-output",
            input_vtt,
            "--output",
            output_vtt,
        )
        self.assertIn("This is important work.", input_vtt.read_text(encoding="utf-8"))
        self.assertIn("這是非常重要的工作", output_vtt.read_text(encoding="utf-8"))
        self.assertNotIn("S0001-P01", input_vtt.read_text(encoding="utf-8"))
        self.assertNotIn("S0001-P01", output_vtt.read_text(encoding="utf-8"))

    def test_internal_piece_id_cannot_be_used_as_visible_text(self):
        plan = self.plan()
        payload = json.loads(plan.read_text(encoding="utf-8"))
        payload["contentUnits"][0]["pieces"][0]["outputText"] = "S0001-P02"
        payload["contentUnits"][0]["outputFullText"] = "S0001-P02"
        plan.write_text(json.dumps(payload), encoding="utf-8")
        result = self.run_script(SEGMENT, "freeze-target", "--plan", plan, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("internal segmentation ID", result.stdout)

    def test_same_language_proofread_content_can_be_segmented(self):
        plan = self.plan("proofread", "en")
        payload = json.loads(plan.read_text(encoding="utf-8"))
        self.assertEqual(payload["sourceLanguage"], "en")
        self.assertEqual(payload["outputLanguage"], "en")
        self.assertEqual(payload["contentMode"], "proofread")

    def test_translation_from_proofreading_keeps_distinct_content_and_timing(self):
        proofread = self.content_manifest("proofread", "en")
        translation = self.root / "content-from-proofread.json"
        self.run_script(
            REFLOW,
            "prepare",
            "--source-transcript",
            self.transcript,
            "--manifest",
            translation,
            "--mode",
            "translate",
            "--source-language",
            "en",
            "--output-language",
            "fr",
            "--timing-source-artifact",
            "source-model-en-r1",
            "--source-content-artifact",
            "proofread-en-r1",
            "--source-content-manifest",
            proofread,
        )
        self.run_script(
            REFLOW,
            "record-content-processor",
            "--manifest",
            translation,
        )
        content = json.loads(translation.read_text(encoding="utf-8"))
        content["segments"][0]["outputText"] = "C'est un travail important."
        translation.write_text(json.dumps(content), encoding="utf-8")
        plan = self.root / "proofread-translation-plan.json"
        self.run_script(
            SEGMENT,
            "prepare",
            "--content-manifest",
            translation,
            "--source-transcript",
            self.transcript,
            "--output",
            plan,
        )
        payload = json.loads(plan.read_text(encoding="utf-8"))
        self.assertEqual(payload["sourceContentArtifactId"], "proofread-en-r1")
        self.assertEqual(payload["sourceContentKind"], "proofread")

    def test_frozen_target_cannot_be_changed_for_alignment_convenience(self):
        plan = self.plan()
        self.align_single_piece(plan)
        self.run_script(SEGMENT, "freeze-target", "--plan", plan)
        payload = json.loads(plan.read_text(encoding="utf-8"))
        payload["contentUnits"][0]["pieces"][0]["outputText"] += "改"
        plan.write_text(json.dumps(payload), encoding="utf-8")
        result = self.run_script(SEGMENT, "validate", "--plan", plan, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("frozen target pieces were modified", result.stdout)

    def test_risky_source_boundary_is_rejected(self):
        plan = self.plan()
        payload = json.loads(plan.read_text(encoding="utf-8"))
        unit = payload["contentUnits"][0]
        full = unit["outputFullText"]
        unit["pieces"] = [
            {
                "id": "S0001-P01",
                "outputText": full[:3],
                "sourceSpan": {"startUnitId": "U000001", "endUnitId": "U000002"},
                "allowShortTiming": True,
            },
            {
                "id": "S0001-P02",
                "outputText": full[3:],
                "sourceSpan": {"startUnitId": "U000003", "endUnitId": "U000004"},
                "allowShortTiming": True,
            },
        ]
        payload["boundaryHints"] = [
            {"afterUnitId": "U000002", "state": "blocked", "reason": "syntax"}
        ]
        plan.write_text(json.dumps(payload), encoding="utf-8")
        self.run_script(SEGMENT, "freeze-target", "--plan", plan)
        result = self.run_script(
            SEGMENT,
            "record-alignment-review",
            "--plan",
            plan,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("blocked source boundary", result.stdout)

    def test_alignment_review_is_required_and_invalidated_by_span_changes(self):
        plan = self.plan()
        self.align_single_piece(plan)
        self.run_script(SEGMENT, "freeze-target", "--plan", plan)
        missing = self.run_script(SEGMENT, "validate", "--plan", plan, check=False)
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("agent-semantic", missing.stdout)
        self.run_script(SEGMENT, "record-alignment-review", "--plan", plan)
        payload = json.loads(plan.read_text(encoding="utf-8"))
        payload["contentUnits"][0]["anchors"] = [
            {
                "sourceUnitStart": "U000001",
                "sourceUnitEnd": "U000001",
                "targetPieceId": "S0001-P01",
                "outputText": "這",
            }
        ]
        plan.write_text(json.dumps(payload), encoding="utf-8")
        stale = self.run_script(SEGMENT, "validate", "--plan", plan, check=False)
        self.assertNotEqual(stale.returncode, 0)
        self.assertIn("changed after Agent semantic review", stale.stdout)

    def test_removed_segmentation_provider_arguments_are_rejected(self):
        plan = self.root / "empty-plan.json"
        result = self.run_script(
            SEGMENT,
            "record-segmentation-processor",
            "--plan",
            plan,
            "--provider",
            "openai",
            "--model",
            "gpt-test",
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unrecognized arguments", result.stdout)


if __name__ == "__main__":
    unittest.main()
