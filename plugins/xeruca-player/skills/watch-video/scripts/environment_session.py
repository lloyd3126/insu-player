#!/usr/bin/env python3
"""Run a command with one allowlisted value from the active INSU server session."""

from __future__ import annotations

import argparse
import json
import os
import stat
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


SESSION_DESCRIPTOR_NAME = ".insu-environment-session.json"
ALLOWED_VARIABLES = {"OPENAI_API_KEY"}


def process_is_alive(pid: object) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except (OSError, ValueError):
        return False
    return True


def load_session_descriptor(workspace: Path) -> dict[str, object]:
    workspace = workspace.resolve()
    descriptor_path = workspace / SESSION_DESCRIPTOR_NAME
    if descriptor_path.is_symlink() or not descriptor_path.is_file():
        raise RuntimeError("INSU environment session is not running")
    mode = stat.S_IMODE(descriptor_path.stat().st_mode)
    if mode & 0o077:
        raise RuntimeError("INSU environment session descriptor permissions are unsafe")
    try:
        payload = json.loads(descriptor_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("INSU environment session descriptor is invalid") from error
    host = payload.get("host")
    port = payload.get("port")
    token = payload.get("token")
    if host not in {"127.0.0.1", "localhost", "::1"} or not isinstance(port, int) or not 1 <= port <= 65535:
        raise RuntimeError("INSU environment session endpoint is invalid")
    if not isinstance(token, str) or len(token) < 32 or not process_is_alive(payload.get("pid")):
        raise RuntimeError("INSU environment session is stale")
    return payload


def fetch_environment_value(workspace: Path, name: str) -> str:
    if name not in ALLOWED_VARIABLES:
        raise RuntimeError("environment variable is not allowed")
    descriptor = load_session_descriptor(workspace)
    host = str(descriptor["host"])
    host_for_url = f"[{host}]" if ":" in host else host
    url = f"http://{host_for_url}:{descriptor['port']}/api/environment/session/{quote(name)}"
    request = Request(url, headers={"Authorization": f"Bearer {descriptor['token']}"})
    try:
        with urlopen(request, timeout=5) as response:
            payload = json.load(response)
    except (HTTPError, URLError, OSError, json.JSONDecodeError) as error:
        raise RuntimeError("environment variable is not available from the INSU session") from error
    value = payload.get("value") if isinstance(payload, dict) else None
    if not isinstance(value, str) or not value:
        raise RuntimeError("environment variable is not configured in the INSU session")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "run"))
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--name", default="OPENAI_API_KEY", choices=sorted(ALLOWED_VARIABLES))
    parser.add_argument("command", nargs=argparse.REMAINDER)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    value = fetch_environment_value(args.workspace, args.name)
    if args.action == "check":
        return 0
    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        raise SystemExit("run requires a command after --")
    environment = dict(os.environ)
    environment[args.name] = value
    os.execvpe(command[0], command, environment)
    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as error:
        raise SystemExit(f"error: {error}") from error
