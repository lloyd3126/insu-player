from __future__ import annotations

import os
import stat
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


class PortableReleaseTests(unittest.TestCase):
    def test_release_archive_is_clean_and_has_portable_entrypoints(self) -> None:
        version = (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "dist"
            environment = dict(os.environ, XERUCA_RELEASE_SOURCE="working-tree")
            subprocess.run(
                [str(REPO_ROOT / "scripts" / "build-release.sh"), str(output)],
                cwd=REPO_ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=environment,
                check=True,
            )
            archive = output / f"xeruca-player-v{version}-portable.zip"
            checksum = archive.with_suffix(archive.suffix + ".sha256")
            self.assertTrue(archive.is_file())
            self.assertTrue(checksum.is_file())
            with zipfile.ZipFile(archive) as bundle:
                names = bundle.namelist()
                prefix = f"xeruca-player-v{version}/"
                self.assertIn(prefix + "START-HERE.md", names)
                self.assertIn(prefix + "CHANGELOG.md", names)
                self.assertIn(prefix + "VERSION", names)
                self.assertIn(prefix + "MANIFEST.sha256", names)
                self.assertIn(prefix + "scripts/portable/setup.sh", names)
                self.assertIn(prefix + "scripts/portable/update.sh", names)
                self.assertIn(prefix + ".agents/plugins/marketplace.json", names)
                self.assertIn(prefix + ".agents/skills/watch-video/SKILL.md", names)
                self.assertIn(prefix + "plugins/xeruca-player/.codex-plugin/plugin.json", names)
                forbidden_parts = {".git", ".local", "dist", "__pycache__"}
                self.assertFalse(any(forbidden_parts.intersection(Path(name).parts) for name in names))
                self.assertFalse(any(name.endswith((".mp4", ".pt", ".pyc", ".pyo")) for name in names))
                mode = bundle.getinfo(prefix + "scripts/portable/setup.sh").external_attr >> 16
                self.assertTrue(mode & stat.S_IXUSR)

    def test_portable_workspace_is_derived_from_repository_root(self) -> None:
        result = subprocess.run(
            ["bash", "-c", ". scripts/portable/common.sh; printf '%s\\n' \"$PORTABLE_WORKSPACE\""],
            cwd=REPO_ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            check=True,
        )
        expected = REPO_ROOT / ".local" / "xeruca-player"
        self.assertEqual(Path(result.stdout.strip()), expected)


if __name__ == "__main__":
    unittest.main()
