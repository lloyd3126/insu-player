from __future__ import annotations

import json
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = REPO_ROOT / "plugins" / "xeruca-player"
EXPECTED_SKILLS = {
    "watch-video",
    "video-library",
    "transcribe-media",
    "translate-subtitles",
    "player-manager",
}


class ProductBoundaryTests(unittest.TestCase):
    def test_plugin_and_repository_bridges_expose_the_same_five_skills(self) -> None:
        canonical = {path.name for path in (PLUGIN_ROOT / "skills").iterdir() if path.is_dir()}
        bridges = {path.name for path in (REPO_ROOT / ".agents" / "skills").iterdir() if path.is_dir()}
        self.assertEqual(canonical, EXPECTED_SKILLS)
        self.assertEqual(bridges, EXPECTED_SKILLS)
        for name in EXPECTED_SKILLS:
            bridge = (REPO_ROOT / ".agents" / "skills" / name / "SKILL.md").read_text(encoding="utf-8")
            self.assertIn(f"plugins/xeruca-player/skills/{name}/SKILL.md", bridge)

    def test_version_and_plugin_manifest_agree(self) -> None:
        version = (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()
        manifest = json.loads((PLUGIN_ROOT / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(version, manifest["version"])
        self.assertEqual(manifest["name"], "xeruca-player")
        self.assertIn("$watch-video", manifest["interface"]["defaultPrompt"])

    def test_library_and_player_assets_keep_the_xeruca_product_contract(self) -> None:
        library = (PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "library" / "index.html").read_text(encoding="utf-8")
        styles = (PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "library" / "library.css").read_text(encoding="utf-8")
        player = (PLUGIN_ROOT / "skills" / "watch-video" / "assets" / "player" / "index.html").read_text(encoding="utf-8")
        self.assertIn("XERUCA PLAYER", library)
        self.assertIn("Call in a video.", library)
        self.assertIn('id="player-dialog"', library)
        self.assertIn('id="player-frame"', library)
        self.assertIn("--claw: #ff6542", styles)
        self.assertIn("Xeruca Player", player)
        self.assertIn("window.XERUCA_PLAYER_CONFIG", player)
        self.assertNotIn("my-agent-playbook", library + styles + player)


if __name__ == "__main__":
    unittest.main()
