from __future__ import annotations

import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "plugins" / "insu-player" / "skills" / "player-manager" / "scripts" / "manage.py"
SPEC = importlib.util.spec_from_file_location("player_manager", SCRIPT)
assert SPEC and SPEC.loader
manager = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(manager)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_manifest(root: Path, relatives: list[str]) -> None:
    lines = [f"{digest(root / relative)}  ./{relative}" for relative in sorted(relatives)]
    (root / "MANIFEST.sha256").write_text("\n".join(lines) + "\n", encoding="utf-8")


class ManagerTests(unittest.TestCase):
    def test_current_checkout_is_detected(self) -> None:
        expected_version = (REPO_ROOT / "VERSION").read_text(encoding="utf-8").strip()
        self.assertEqual(manager.plugin_version(), expected_version)
        self.assertEqual(manager.find_repository_root(), REPO_ROOT)
        self.assertEqual(manager.installation_mode(REPO_ROOT), "git")

    def test_manifest_rejects_parent_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "MANIFEST.sha256"
            manifest.write_text(f"{'0' * 64}  ../outside\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unsafe"):
                manager.parse_manifest(manifest)

    def test_manifest_rejects_managed_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            outside = root / "outside"
            outside.write_text("outside\n", encoding="utf-8")
            link = root / "managed"
            link.symlink_to(outside)
            (root / "MANIFEST.sha256").write_text(f"{digest(outside)}  ./managed\n", encoding="utf-8")
            self.assertEqual(manager.verify_manifest(root, root / "MANIFEST.sha256"), ["symlink: managed"])

    def test_version_comparison_prevents_release_downgrades(self) -> None:
        self.assertGreater(manager.version_key("0.2.0"), manager.version_key("0.1.9"))
        self.assertEqual(manager.version_key("v1.2.3"), (1, 2, 3))

    def test_portable_update_preserves_local_data_and_removes_obsolete_managed_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            current = base / "current"
            current.mkdir()
            (current / "VERSION").write_text("0.1.0\n", encoding="utf-8")
            (current / "obsolete.txt").write_text("old\n", encoding="utf-8")
            write_manifest(current, ["VERSION", "obsolete.txt"])
            (current / ".local").mkdir()
            (current / ".local" / "user-data.txt").write_text("keep\n", encoding="utf-8")

            incoming = base / "insu-player-v0.2.0"
            incoming.mkdir()
            (incoming / "VERSION").write_text("0.2.0\n", encoding="utf-8")
            (incoming / "fresh.txt").write_text("new\n", encoding="utf-8")
            write_manifest(incoming, ["VERSION", "fresh.txt"])
            archive = base / "release.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                for path in incoming.rglob("*"):
                    if path.is_file():
                        bundle.write(path, path.relative_to(base))
            checksum = base / "release.zip.sha256"
            checksum.write_text(f"{digest(archive)}  release.zip\n", encoding="utf-8")

            result = manager.portable_update(
                current,
                apply=True,
                archive_path=archive,
                checksum_path=checksum,
            )
            self.assertEqual(result["installedVersion"], "0.2.0")
            self.assertFalse((current / "obsolete.txt").exists())
            self.assertEqual((current / "fresh.txt").read_text(encoding="utf-8"), "new\n")
            self.assertEqual((current / ".local" / "user-data.txt").read_text(encoding="utf-8"), "keep\n")
            self.assertTrue(Path(result["backup"]).is_dir())


if __name__ == "__main__":
    unittest.main()
