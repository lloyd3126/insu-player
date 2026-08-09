from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SEGMENT_SCRIPT = (
    REPO_ROOT
    / "plugins"
    / "insu-player"
    / "skills"
    / "segment-subtitles"
    / "scripts"
    / "segment_subtitles.py"
)


class SubtitleSegmentationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.transcript = self.root / "transcript.json"
        self.translation = self.root / "bilingual-sentences.json"
        self.plan = self.root / "segmentation-plan.json"
        words = ["We", "built", "an", "API", "and", "improved."]
        self.transcript.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "provider": "local",
                    "model": "test",
                    "language": "en",
                    "words": [
                        {
                            "id": index,
                            "start": 1.0 + index * 0.8,
                            "end": 1.6 + index * 0.8,
                            "word": word,
                        }
                        for index, word in enumerate(words)
                    ],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        self.translation.write_text(
            json.dumps(
                {
                    "schemaVersion": 2,
                    "sourceLanguage": "en",
                    "targetLanguage": "zh-TW",
                    "sourceTranscript": str(self.transcript),
                    "translationModel": {"provider": "local", "model": "test"},
                    "outputProfile": {"punctuationPolicy": "preserve"},
                    "segments": [
                        {
                            "id": "S0001",
                            "start": "00:00:01.000",
                            "end": "00:00:05.600",
                            "sourceUnitStart": "U000001",
                            "sourceUnitEnd": "U000006",
                            "sourceText": "We built an API and improved.",
                            "draftTargetText": "我們建立 API 系統並改善速度",
                            "targetText": "我們建立 API 系統並改善速度",
                            "requiredTerms": ["API"],
                        }
                    ],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_segment(self, *arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SEGMENT_SCRIPT), *arguments],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=check,
        )

    def prepare_plan(self) -> dict[str, object]:
        self.run_segment(
            "prepare",
            "--translation-manifest",
            str(self.translation),
            "--source-transcript",
            str(self.transcript),
            "--output",
            str(self.plan),
        )
        return json.loads(self.plan.read_text(encoding="utf-8"))

    def write_split_plan(self, *, boundary_state: str = "safe") -> dict[str, object]:
        plan = self.prepare_plan()
        unit = plan["translationUnits"][0]
        unit["pieces"] = [
            {
                "id": "S0001-P01",
                "targetText": "我們建立 API 系統",
                "sourceSpan": None,
                "allowShortTiming": False,
            },
            {
                "id": "S0001-P02",
                "targetText": "並改善速度",
                "sourceSpan": None,
                "allowShortTiming": False,
            },
        ]
        plan["boundaryHints"] = [
            {
                "afterUnitId": "U000003",
                "state": boundary_state,
                "reasonCodes": ["SOURCE_CLAUSE_END"],
            }
        ]
        self.plan.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
        self.run_segment("freeze-target", "--plan", str(self.plan))
        plan = json.loads(self.plan.read_text(encoding="utf-8"))
        plan["translationUnits"][0]["pieces"][0]["sourceSpan"] = {
            "startUnitId": "U000001",
            "endUnitId": "U000003",
        }
        plan["translationUnits"][0]["pieces"][1]["sourceSpan"] = {
            "startUnitId": "U000004",
            "endUnitId": "U000006",
        }
        self.plan.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
        return plan

    def test_target_first_plan_freezes_aligns_and_renders_shared_timing(self) -> None:
        plan = self.write_split_plan()
        plan["translationUnits"][0]["anchors"] = [
            {
                "sourceUnitStart": "U000004",
                "sourceUnitEnd": "U000004",
                "targetText": "並改善",
                "targetPieceId": "S0001-P02",
            }
        ]
        self.plan.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
        validation = self.run_segment("validate", "--plan", str(self.plan))
        self.assertIn('"valid": true', validation.stdout)

        source_vtt = self.root / "en.segmented.vtt"
        target_vtt = self.root / "zh-TW.segmented.vtt"
        self.run_segment(
            "render",
            "--plan",
            str(self.plan),
            "--source-output",
            str(source_vtt),
            "--target-output",
            str(target_vtt),
        )
        source = source_vtt.read_text(encoding="utf-8")
        target = target_vtt.read_text(encoding="utf-8")
        self.assertIn("Language: en", source)
        self.assertIn("Language: zh-TW", target)
        self.assertEqual(
            [line for line in source.splitlines() if "-->" in line],
            [line for line in target.splitlines() if "-->" in line],
        )
        self.assertIn("我們建立 API 系統", target)

    def test_frozen_target_cannot_be_mutated(self) -> None:
        plan = self.write_split_plan()
        plan["translationUnits"][0]["pieces"][0]["targetText"] = "遭到修改"
        self.plan.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
        result = self.run_segment("validate", "--plan", str(self.plan), check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("frozen target pieces were modified", result.stdout)

    def test_risky_source_boundary_is_rejected(self) -> None:
        self.write_split_plan(boundary_state="risky")
        result = self.run_segment("validate", "--plan", str(self.plan), check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("uses a risky source boundary", result.stdout)

    def test_required_target_term_cannot_cross_pieces(self) -> None:
        plan = self.prepare_plan()
        unit = plan["translationUnits"][0]
        unit["requiredTerms"] = ["API"]
        unit["pieces"] = [
            {"id": "S0001-P01", "targetText": "我們建立 A", "sourceSpan": None},
            {"id": "S0001-P02", "targetText": "PI 系統並改善速度", "sourceSpan": None},
        ]
        self.plan.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
        result = self.run_segment("freeze-target", "--plan", str(self.plan), check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("splits required target term", result.stdout)

    def test_target_language_selects_a_writing_system_profile(self) -> None:
        translation = json.loads(self.translation.read_text(encoding="utf-8"))
        translation["targetLanguage"] = "ar"
        translation["segments"][0]["targetText"] = "أنشأنا واجهة برمجة وحسّنا السرعة"
        self.translation.write_text(json.dumps(translation, ensure_ascii=False), encoding="utf-8")
        plan = self.prepare_plan()
        self.assertEqual(plan["widthProfile"]["name"], "rtl")


if __name__ == "__main__":
    unittest.main()
