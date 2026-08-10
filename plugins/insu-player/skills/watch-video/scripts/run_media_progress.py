#!/usr/bin/env python3
"""Run one rendition download while mirroring percentage progress into its catalog."""

from __future__ import annotations

import argparse
import re
import signal
import subprocess
import sys
import time
from collections import deque
from pathlib import Path


PERCENT_PATTERN = re.compile(r"(?<!\d)(100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%")


def update(
    args: argparse.Namespace,
    *,
    state: str,
    stage: str,
    progress: float,
    message: str,
    error: str | None = None,
    pid: int | None = None,
) -> None:
    command = [
        sys.executable,
        str(args.catalog_script),
        "run-update",
        "--job-dir",
        str(args.job_dir),
        "--video-id",
        args.video_id,
        "--run-id",
        args.run_id,
        "--requested-height",
        str(args.requested_height),
        "--state",
        state,
        "--stage",
        stage,
        "--progress",
        str(progress),
        "--message",
        message,
    ]
    if error:
        command.extend(["--error", error])
    if pid:
        command.extend(["--pid", str(pid)])
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job-dir", required=True, type=Path)
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--requested-height", required=True, type=int)
    parser.add_argument("--catalog-script", required=True, type=Path)
    parser.add_argument("--message", required=True)
    parser.add_argument("--success-message", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    command = args.command[1:] if args.command and args.command[0] == "--" else args.command
    if not command:
        raise SystemExit("no command supplied after --")

    run_directory = args.job_dir / "media-work" / "runs" / args.run_id
    run_directory.mkdir(parents=True, exist_ok=True)
    log_path = run_directory / "workflow.log"
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        errors="replace",
        bufsize=1,
    )
    update(
        args,
        state="downloading",
        stage="downloading",
        progress=0,
        message=args.message,
        pid=process.pid,
    )
    recent: deque[str] = deque(maxlen=12)
    progress = 0.0
    last_update = 0.0
    try:
        assert process.stdout is not None
        with log_path.open("a", encoding="utf-8") as log:
            for raw_line in process.stdout:
                line = raw_line.rstrip("\r\n")
                print(line, flush=True)
                log.write(line + "\n")
                log.flush()
                if line:
                    recent.append(line)
                match = PERCENT_PATTERN.search(line)
                now = time.monotonic()
                if match:
                    progress = float(match.group(1))
                if (match and now - last_update >= 0.5) or now - last_update >= 5:
                    update(
                        args,
                        state="downloading",
                        stage="downloading",
                        progress=progress,
                        message=args.message,
                        pid=process.pid,
                    )
                    last_update = now
        return_code = process.wait()
    except KeyboardInterrupt:
        if process.poll() is None:
            process.send_signal(signal.SIGINT)
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=8)
        update(
            args,
            state="interrupted",
            stage="downloading",
            progress=progress,
            message="畫質下載已中斷",
            error="interrupted by user",
        )
        return 130

    if return_code == 0:
        update(
            args,
            state="validating",
            stage="validating",
            progress=100,
            message=args.success_message,
        )
        return 0

    error = "\n".join(recent) or f"download command exited with status {return_code}"
    update(
        args,
        state="failed",
        stage="downloading",
        progress=progress,
        message="畫質下載失敗",
        error=error,
    )
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
