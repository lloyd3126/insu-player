#!/usr/bin/env python3
"""Run a command while mirroring percentage progress into SQLite operations."""

from __future__ import annotations

import argparse
import re
import signal
import subprocess
import time
from collections import deque
from pathlib import Path

from job_state import patch_status, utc_now


PERCENT_PATTERN = re.compile(r"(?<!\d)(100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--job-dir", required=True, type=Path)
    parser.add_argument("--state", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--message", required=True)
    parser.add_argument("--success-message")
    parser.add_argument("--progress-start", type=float, default=0.0)
    parser.add_argument("--progress-end", type=float, default=100.0)
    parser.add_argument("--allow-failure", action="store_true")
    parser.add_argument("--redact-value", action="append", default=[])
    parser.add_argument("command", nargs=argparse.REMAINDER)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        raise SystemExit("no command supplied after --")
    if not 0 <= args.progress_start <= args.progress_end <= 100:
        raise SystemExit("progress range must satisfy 0 <= start <= end <= 100")

    def mapped_progress(percent: float) -> float:
        span = args.progress_end - args.progress_start
        return args.progress_start + span * max(0.0, min(100.0, percent)) / 100.0

    log_dir = args.job_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "workflow.log"

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        errors="replace",
        bufsize=1,
    )
    started_at = utc_now()
    patch_status(
        args.job_dir,
        {
            "state": args.state,
            "stage": args.stage,
            "message": args.message,
            "progress": args.progress_start,
            "lastError": None,
            "process": {
                "pid": process.pid,
                "startedAt": started_at,
                "command": Path(command[0]).name,
            },
        },
        record_history=True,
    )

    recent_lines: deque[str] = deque(maxlen=12)
    last_progress = -1.0
    last_update = 0.0
    progress = args.progress_start

    try:
        assert process.stdout is not None
        with log_path.open("a", encoding="utf-8") as log_handle:
            log_handle.write(f"\n[{utc_now()}] START {Path(command[0]).name}\n")
            for raw_line in process.stdout:
                line = raw_line.rstrip("\r\n")
                for secret in args.redact_value:
                    if secret:
                        line = line.replace(secret, "[redacted-source-url]")
                print(line, flush=True)
                log_handle.write(line + "\n")
                log_handle.flush()
                if line:
                    recent_lines.append(line)

                match = PERCENT_PATTERN.search(line)
                now = time.monotonic()
                if match:
                    progress = mapped_progress(float(match.group(1)))
                    if progress >= last_progress + 0.5 or now - last_update >= 2.0:
                        patch_status(
                            args.job_dir,
                            {
                                "state": args.state,
                                "stage": args.stage,
                                "message": args.message,
                                "progress": progress,
                                "process": {
                                    "pid": process.pid,
                                    "startedAt": started_at,
                                    "command": Path(command[0]).name,
                                },
                            },
                        )
                        last_progress = progress
                        last_update = now
                elif now - last_update >= 10.0:
                    patch_status(
                        args.job_dir,
                        {
                            "state": args.state,
                            "stage": args.stage,
                            "message": args.message,
                            "progress": progress,
                            "process": {
                                "pid": process.pid,
                                "startedAt": started_at,
                                "command": Path(command[0]).name,
                            },
                        },
                    )
                    last_update = now

            return_code = process.wait()
            log_handle.write(f"[{utc_now()}] EXIT {return_code}\n")
    except KeyboardInterrupt:
        if process.poll() is None:
            process.send_signal(signal.SIGINT)
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=8)
        patch_status(
            args.job_dir,
            {
                "state": "interrupted",
                "stage": args.stage,
                "message": "工作已由使用者中斷。可從此階段繼續",
                "process": None,
                "lastError": "interrupted by user",
            },
            record_history=True,
        )
        return 130

    if return_code == 0:
        patch_status(
            args.job_dir,
            {
                "state": args.state,
                "stage": args.stage,
                "message": args.success_message or args.message,
                "progress": args.progress_end,
                "process": None,
            },
        )
        return 0

    error_message = "\n".join(recent_lines) or f"command exited with status {return_code}"
    if args.allow_failure:
        patch_status(
            args.job_dir,
            {
                "state": args.state,
                "stage": args.stage,
                "message": f"{args.message}（未完成）",
                "process": None,
                "lastError": error_message,
            },
        )
        return return_code

    patch_status(
        args.job_dir,
        {
            "state": "failed",
            "stage": args.stage,
            "message": f"{args.message}失敗",
            "process": None,
            "lastError": error_message,
        },
        record_history=True,
    )
    return return_code


if __name__ == "__main__":
    raise SystemExit(main())
