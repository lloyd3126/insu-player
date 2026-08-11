import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SUMMARY_VALIDATOR = (
    ROOT
    / "plugins/insu-player/skills/summarize-video/scripts/validate_summary.py"
)
MINDMAP_VALIDATOR = (
    ROOT
    / "plugins/insu-player/skills/map-video-summary/scripts/validate_mindmap.py"
)


class SummaryToolTests(unittest.TestCase):
    def run_validator(self, script: Path, content: str, *arguments: str):
        with tempfile.TemporaryDirectory() as temporary_directory:
            content_file = Path(temporary_directory) / "artifact.md"
            content_file.write_text(content, encoding="utf-8")
            return subprocess.run(
                ["python3", str(script), *arguments, "--content-file", str(content_file)],
                cwd=ROOT,
                check=False,
                capture_output=True,
                text=True,
            )

    def test_text_summary_validator_emits_the_current_import_contract(self):
        result = self.run_validator(
            SUMMARY_VALIDATOR,
            "# 重點摘要\n\n這是根據字幕整理的完整摘要。",
            "--kind",
            "text",
            "--video-id",
            "demo-video",
            "--language",
            "zh-TW",
            "--title",
            "重點摘要",
            "--source-subtitle-artifact-id",
            "demo-proofread-en-r1",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            json.loads(result.stdout),
            {
                "kind": "text",
                "languageCode": "zh-TW",
                "title": "重點摘要",
                "content": "# 重點摘要\n\n這是根據字幕整理的完整摘要。",
                "sourceSubtitleArtifactId": "demo-proofread-en-r1",
            },
        )

    def test_mindmap_validator_accepts_only_same_video_timestamp_links(self):
        arguments = (
            "--kind",
            "mindmap",
            "--video-id",
            "demo-video",
            "--language",
            "zh-TW",
            "--title",
            "重點心智圖",
            "--source-summary-artifact-id",
            "demo-text-zh-TW-r1",
        )
        valid = self.run_validator(
            MINDMAP_VALIDATOR,
            "# 重點心智圖\n- [第一部分](/player/demo-video?time=12.5)\n  - 核心觀點",
            *arguments,
        )
        self.assertEqual(valid.returncode, 0, valid.stderr)
        self.assertEqual(json.loads(valid.stdout)["kind"], "mindmap")

        external = self.run_validator(
            MINDMAP_VALIDATOR,
            "# 重點心智圖\n- [外部連結](https://example.test)",
            *arguments,
        )
        self.assertNotEqual(external.returncode, 0)
        self.assertIn("same-video timestamp", external.stderr)

    def test_mindmap_validator_rejects_embedded_html(self):
        result = self.run_validator(
            MINDMAP_VALIDATOR,
            "# 重點心智圖\n- <script>alert(1)</script>",
            "--kind",
            "mindmap",
            "--video-id",
            "demo-video",
            "--language",
            "zh-TW",
            "--title",
            "重點心智圖",
            "--source-summary-artifact-id",
            "demo-text-zh-TW-r1",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsafe mind map content", result.stderr)


if __name__ == "__main__":
    unittest.main()
