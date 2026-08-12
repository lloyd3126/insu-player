from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "plugins" / "insu-player" / "skills" / "player-manager" / "scripts" / "manage.py"
SPEC = importlib.util.spec_from_file_location("player_manager", SCRIPT)
assert SPEC and SPEC.loader
manager = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(manager)


class ManagerTests(unittest.TestCase):
    def test_current_checkout_is_detected(self) -> None:
        expected_version = (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()
        self.assertEqual(manager.plugin_version(), expected_version)
        self.assertEqual(manager.find_repository_root(), REPO_ROOT)
        self.assertEqual(manager.installation_mode(REPO_ROOT), "git")

if __name__ == "__main__":
    unittest.main()
