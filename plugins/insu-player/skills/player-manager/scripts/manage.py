#!/usr/bin/env python3
"""Inspect, update, or uninstall INSU Player without silent mutations."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path


PLUGIN_NAME = "insu-player"
MARKETPLACE_NAME = "insu-player"


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
                raise SystemExit(
                    "portable releases are immutable; install the current release into a new directory"
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
