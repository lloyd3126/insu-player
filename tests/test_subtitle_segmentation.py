import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REFLOW = ROOT / "plugins/insu-player/skills/translate-subtitles/scripts/reflow_subtitles.py"
SEGMENT = ROOT / "plugins/insu-player/skills/segment-subtitles/scripts/segment_subtitles.py"


class SubtitleSegmentationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.transcript = self.root / "transcript.json"
        self.transcript.write_text(
            json.dumps(
                {
                    "schemaVersion": 2,
                    "provider": "local",
                    "model": "medium",
                    "language": "en",
                    "engineLanguage": "en",
                    "words": [
                        {"id": 0, "word": "This", "start": 0.0, "end": 0.5},
                        {"id": 1, "word": "is", "start": 0.5, "end": 0.9},
                        {"id": 2, "word": "important", "start": 0.9, "end": 1.6},
                        {"id": 3, "word": "work.", "start": 1.6, "end": 2.4},
                    ],
                }
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
            "record-content-processor",
            "--manifest",
            manifest,
            "--provider",
            "agent",
            "--service",
            "codex",
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
            "--provider",
            "agent",
            "--service",
            "codex",
        )
        return plan

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
        self.assertEqual(payload["schemaVersion"], 3)
        self.assertEqual(payload["contentProcessor"]["provider"], "agent")
        self.assertEqual(payload["segmentationProcessor"]["service"], "codex")
        self.assertFalse(payload["targetFrozen"])
        self.align_single_piece(plan)
        self.run_script(SEGMENT, "freeze-target", "--plan", plan)
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

    def test_same_language_proofread_content_can_be_segmented(self):
        plan = self.plan("proofread", "en")
        payload = json.loads(plan.read_text(encoding="utf-8"))
        self.assertEqual(payload["sourceLanguage"], "en")
        self.assertEqual(payload["outputLanguage"], "en")
        self.assertEqual(payload["contentMode"], "proofread")

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
        result = self.run_script(SEGMENT, "validate", "--plan", plan, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("blocked source boundary", result.stdout)


if __name__ == "__main__":
    unittest.main()
