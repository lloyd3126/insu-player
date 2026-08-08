#!/usr/bin/env python3
"""Inspect, update, or uninstall INSU Player without silent mutations."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PLUGIN_NAME = "insu-player"
MARKETPLACE_NAME = "insu-player"
LATEST_RELEASE_API = "https://api.github.com/repos/lloyd3126/insu-player/releases/latest"


def plugin_root() -> Path:
    return Path(__file__).resolve().parents[3]


def find_repository_root() -> Path | None:
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "VERSION").is_file() and (candidate / ".agents" / "plugins" / "marketplace.json").is_file():
            return candidate
    return None


def plugin_version() -> str:
    payload = json.loads((plugin_root() / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
    return str(payload["version"])


def installation_mode(root: Path | None) -> str:
    if root and (root / ".git").is_dir():
        return "git"
    if root and (root / "MANIFEST.sha256").is_file():
        return "portable"
    return "plugin"


def run(command: list[str], *, cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=check,
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_manifest(path: Path) -> dict[str, str]:
    entries: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip():
            continue
        digest, separator, relative = raw_line.partition("  ")
        if not separator or len(digest) != 64:
            raise ValueError(f"invalid manifest line: {raw_line!r}")
        relative = relative.removeprefix("./")
        candidate = Path(relative)
        if candidate.is_absolute() or ".." in candidate.parts or relative.startswith(".local/"):
            raise ValueError(f"unsafe manifest path: {relative!r}")
        entries[relative] = digest
    return entries


def verify_manifest(root: Path, manifest: Path) -> list[str]:
    failures: list[str] = []
    for relative, expected in parse_manifest(manifest).items():
        target = root / relative
        if target.is_symlink():
            failures.append(f"symlink: {relative}")
        elif not target.is_file():
            failures.append(f"missing: {relative}")
        elif sha256(target) != expected:
            failures.append(f"modified: {relative}")
    return failures


def managed_target(root: Path, relative: str) -> Path:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        target.parent.resolve().relative_to(root.resolve())
    except ValueError as error:
        raise RuntimeError(f"managed path escapes through a symlink: {relative}") from error
    if target.is_symlink():
        raise RuntimeError(f"refusing to overwrite managed symlink: {relative}")
    return target


def latest_release() -> dict[str, Any]:
    request = urllib.request.Request(
        LATEST_RELEASE_API,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "insu-player-updater"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    assets = payload.get("assets") if isinstance(payload, dict) else None
    if not isinstance(assets, list):
        raise RuntimeError("latest GitHub release has no assets")
    archive = next((item for item in assets if str(item.get("name", "")).endswith("-portable.zip")), None)
    checksum = next((item for item in assets if str(item.get("name", "")).endswith("-portable.zip.sha256")), None)
    if not archive or not checksum:
        raise RuntimeError("latest release is missing the portable ZIP or checksum")
    return {
        "version": str(payload.get("tag_name", "")).removeprefix("v"),
        "archive": archive["browser_download_url"],
        "checksum": checksum["browser_download_url"],
    }


def download(url: str, target: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "insu-player-updater"})
    with urllib.request.urlopen(request, timeout=60) as response, target.open("wb") as handle:
        shutil.copyfileobj(response, handle)


def expected_checksum(path: Path) -> str:
    value = path.read_text(encoding="utf-8").strip().split()[0]
    if len(value) != 64 or any(character not in "0123456789abcdefABCDEF" for character in value):
        raise ValueError("invalid SHA-256 checksum file")
    return value.lower()


def version_key(value: str) -> tuple[int, ...]:
    core = value.removeprefix("v").split("-", 1)[0]
    try:
        return tuple(int(part) for part in core.split("."))
    except ValueError as error:
        raise ValueError(f"unsupported release version: {value!r}") from error


def portable_update(
    root: Path,
    *,
    apply: bool,
    archive_path: Path | None = None,
    checksum_path: Path | None = None,
) -> dict[str, Any]:
    current_version = (root / "VERSION").read_text(encoding="utf-8").strip()
    old_manifest = root / "MANIFEST.sha256"
    failures = verify_manifest(root, old_manifest)
    if failures:
        raise RuntimeError("portable files changed; update stopped:\n" + "\n".join(failures[:20]))

    release: dict[str, Any] | None = None
    if archive_path is None:
        release = latest_release()
        if version_key(str(release["version"])) <= version_key(current_version):
            return {
                "mode": "portable",
                "status": "current",
                "currentVersion": current_version,
                "latestVersion": release["version"],
            }
        if not apply:
            return {
                "mode": "portable",
                "currentVersion": current_version,
                "latestVersion": release["version"],
                "action": "rerun with --apply to verify and install while preserving .local",
            }
    elif checksum_path is None:
        raise RuntimeError("--archive requires --checksum")

    if not apply:
        return {
            "mode": "portable",
            "currentVersion": current_version,
            "archive": str(archive_path),
            "action": "rerun with --apply to install",
        }

    local_root = root / ".local" / "player-manager"
    local_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="update-", dir=local_root) as temporary:
        staging = Path(temporary)
        archive = staging / "release.zip"
        checksum = staging / "release.zip.sha256"
        if archive_path:
            shutil.copy2(archive_path, archive)
            shutil.copy2(checksum_path, checksum)
        else:
            assert release is not None
            download(str(release["archive"]), archive)
            download(str(release["checksum"]), checksum)
        if sha256(archive) != expected_checksum(checksum):
            raise RuntimeError("release ZIP SHA-256 does not match its checksum asset")

        extract_root = staging / "extract"
        with zipfile.ZipFile(archive) as bundle:
            total_size = 0
            for info in bundle.infolist():
                candidate = Path(info.filename)
                if candidate.is_absolute() or ".." in candidate.parts:
                    raise RuntimeError(f"unsafe path in release ZIP: {info.filename}")
                total_size += info.file_size
                if total_size > 250 * 1024 * 1024:
                    raise RuntimeError("release ZIP expands beyond the 250 MB safety limit")
            bundle.extractall(extract_root)
        package_dirs = [path for path in extract_root.iterdir() if path.is_dir()]
        if len(package_dirs) != 1:
            raise RuntimeError("portable ZIP must contain exactly one top-level directory")
        incoming = package_dirs[0]
        incoming_manifest = incoming / "MANIFEST.sha256"
        incoming_failures = verify_manifest(incoming, incoming_manifest)
        if incoming_failures:
            raise RuntimeError("incoming release manifest failed:\n" + "\n".join(incoming_failures[:20]))

        old_entries = parse_manifest(old_manifest)
        new_entries = parse_manifest(incoming_manifest)
        backup = local_root / "backups" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        for relative in sorted(set(old_entries) | {"MANIFEST.sha256"}):
            source = root / relative
            if source.is_file():
                target = backup / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)

        for relative in sorted(set(old_entries) - set(new_entries), reverse=True):
            target = root / relative
            if target.is_file():
                target.unlink()
        for relative in sorted(new_entries):
            source = incoming / relative
            target = managed_target(root, relative)
            shutil.copy2(source, target)
        shutil.copy2(incoming_manifest, root / "MANIFEST.sha256")

    return {
        "mode": "portable",
        "currentVersion": current_version,
        "installedVersion": (root / "VERSION").read_text(encoding="utf-8").strip(),
        "backup": str(backup),
        "preserved": str(root / ".local"),
    }


def git_update(root: Path, *, apply: bool) -> dict[str, Any]:
    dirty = run(["git", "status", "--porcelain"], cwd=root).stdout.strip()
    if dirty:
        raise RuntimeError("Git worktree has local changes; update stopped so Codex can review them")
    current = run(["git", "rev-parse", "HEAD"], cwd=root).stdout.strip()
    remote_output = run(["git", "ls-remote", "origin", "refs/heads/main"], cwd=root).stdout.strip()
    if not remote_output:
        raise RuntimeError("origin/main could not be resolved")
    remote = remote_output.split()[0]
    if current == remote:
        return {"mode": "git", "status": "current", "commit": current}
    if not apply:
        return {"mode": "git", "status": "update-available", "current": current, "remote": remote}
    run(["git", "fetch", "origin", "main"], cwd=root)
    ancestor = run(["git", "merge-base", "--is-ancestor", current, remote], cwd=root, check=False)
    if ancestor.returncode != 0:
        raise RuntimeError("origin/main is not a fast-forward update; update stopped")
    run(["git", "pull", "--ff-only", "origin", "main"], cwd=root)
    return {"mode": "git", "status": "updated", "previous": current, "current": remote}


def plugin_update(*, apply: bool) -> dict[str, Any]:
    commands = [
        ["codex", "plugin", "marketplace", "upgrade", MARKETPLACE_NAME, "--json"],
        ["codex", "plugin", "add", f"{PLUGIN_NAME}@{MARKETPLACE_NAME}", "--json"],
    ]
    if not apply:
        return {"mode": "plugin", "action": "rerun with --apply", "commands": [" ".join(item) for item in commands]}
    results = [run(command).stdout.strip() for command in commands]
    return {"mode": "plugin", "status": "updated", "results": results}


def uninstall(*, mode: str, root: Path | None, apply: bool, include_library: bool, remove_marketplace: bool) -> dict[str, Any]:
    if mode == "plugin":
        commands = [["codex", "plugin", "remove", f"{PLUGIN_NAME}@{MARKETPLACE_NAME}", "--json"]]
        if remove_marketplace:
            commands.append(["codex", "plugin", "marketplace", "remove", MARKETPLACE_NAME, "--json"])
        if apply:
            results = [run(command).stdout.strip() for command in commands]
            return {"mode": mode, "status": "removed", "results": results}
        return {"mode": mode, "action": "rerun with --apply", "commands": [" ".join(item) for item in commands]}

    assert root is not None
    portable_uninstall = root / "scripts" / "portable" / "uninstall.sh"
    command = [str(portable_uninstall)]
    if include_library:
        command.append("--include-generated")
    if apply:
        command.append("--yes")
    result = run(command, cwd=root)
    return {
        "mode": mode,
        "runtimeCleanup": result.stdout.strip(),
        "repositoryPreserved": str(root),
        "next": "After explicit confirmation, move this exact repository folder to Trash for complete removal.",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("status")

    update_parser = subparsers.add_parser("update")
    update_parser.add_argument("--mode", choices=("auto", "git", "plugin", "portable"), default="auto")
    update_parser.add_argument("--apply", action="store_true")
    update_parser.add_argument("--archive", type=Path)
    update_parser.add_argument("--checksum", type=Path)

    uninstall_parser = subparsers.add_parser("uninstall")
    uninstall_parser.add_argument("--mode", choices=("auto", "git", "plugin", "portable"), default="auto")
    uninstall_parser.add_argument("--apply", action="store_true")
    uninstall_parser.add_argument("--include-library", action="store_true")
    uninstall_parser.add_argument("--remove-marketplace", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    root = find_repository_root()
    detected = installation_mode(root)
    if args.command == "status":
        payload = {
            "plugin": PLUGIN_NAME,
            "version": plugin_version(),
            "mode": detected,
            "repositoryRoot": str(root) if root else None,
            "portableData": str(root / ".local") if root else None,
        }
    else:
        mode = detected if args.mode == "auto" else args.mode
        if mode in {"git", "portable"} and root is None:
            raise SystemExit(f"{mode} mode requires a repository or portable release root")
        if args.command == "update":
            if mode == "git":
                payload = git_update(root, apply=args.apply)
            elif mode == "portable":
                payload = portable_update(
                    root,
                    apply=args.apply,
                    archive_path=args.archive.resolve() if args.archive else None,
                    checksum_path=args.checksum.resolve() if args.checksum else None,
                )
            else:
                payload = plugin_update(apply=args.apply)
        else:
            payload = uninstall(
                mode=mode,
                root=root,
                apply=args.apply,
                include_library=args.include_library,
                remove_marketplace=args.remove_marketplace,
            )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
