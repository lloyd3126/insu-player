#!/usr/bin/env python3
"""Same-origin local video library with Range support and local UI state."""

from __future__ import annotations

import argparse
import errno
import json
import math
import mimetypes
import os
import re
import signal
import sys
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from job_state import ACTIVE_STATES, VIDEO_ID_PATTERN, load_status


TRACK_LABELS = {
    "zh-TW": "繁體中文",
    "zh-Hant": "繁體中文",
    "en": "English",
    "ja": "日本語",
    "ko": "한국어",
    "source": "原文",
}
RANGE_PATTERN = re.compile(r"^bytes=(\d*)-(\d*)$")
MAX_JSON_BODY = 4096


def parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def process_is_alive(pid: object) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except (OSError, ValueError):
        return False
    return True


def tail_text(path: Path, line_count: int = 160) -> str:
    if not path.is_file():
        return ""
    with path.open("rb") as handle:
        handle.seek(0, os.SEEK_END)
        position = handle.tell()
        block_size = 8192
        data = b""
        while position > 0 and data.count(b"\n") <= line_count:
            read_size = min(block_size, position)
            position -= read_size
            handle.seek(position)
            data = handle.read(read_size) + data
    return b"\n".join(data.splitlines()[-line_count:]).decode("utf-8", "replace")


class LibraryApplication:
    def __init__(self, workspace: Path, library_template: Path, player_template: Path):
        self.workspace = workspace.resolve()
        self.jobs_root = self.workspace / "jobs"
        self.library_template = library_template.resolve()
        self.player_template = player_template.resolve()
        self.size_cache: dict[str, tuple[float, int]] = {}

    def job_dir(self, video_id: str) -> Path:
        if not VIDEO_ID_PATTERN.fullmatch(video_id):
            raise ValueError("invalid video ID")
        return self.jobs_root / video_id

    @staticmethod
    def safe_job_file(job_dir: Path, path: Path) -> Path | None:
        if not path.is_file():
            return None
        try:
            path.resolve().relative_to(job_dir.resolve())
        except (OSError, ValueError):
            return None
        return path

    def job_size(self, job_dir: Path) -> int:
        video_id = job_dir.name
        cached = self.size_cache.get(video_id)
        now = time.monotonic()
        if cached and now - cached[0] < 30:
            return cached[1]
        total = 0
        for root, _, filenames in os.walk(job_dir):
            for filename in filenames:
                path = Path(root) / filename
                try:
                    if path.is_file() and not path.is_symlink():
                        total += path.stat().st_size
                except OSError:
                    continue
        self.size_cache[video_id] = (now, total)
        return total

    def caption_paths(self, job_dir: Path) -> dict[str, Path]:
        caption_dir = job_dir / "captions"
        if not caption_dir.is_dir():
            return {}
        tracks: dict[str, Path] = {}
        for path in caption_dir.glob("*.vtt"):
            language = path.stem
            if re.fullmatch(r"[A-Za-z0-9_-]+", language) and self.safe_job_file(job_dir, path):
                tracks[language] = path
        return dict(sorted(tracks.items()))

    def video_path(self, job_dir: Path) -> Path | None:
        path = job_dir / "source" / "video.mp4"
        return self.safe_job_file(job_dir, path)

    def thumbnail_path(self, job_dir: Path) -> Path | None:
        for suffix in ("jpg", "jpeg", "png", "webp"):
            path = job_dir / "source" / f"thumbnail.{suffix}"
            if self.safe_job_file(job_dir, path):
                return path
        return None

    def playback_state(self, job_dir: Path) -> dict[str, object]:
        state_path = job_dir / "ui-state.json"
        if not state_path.is_file():
            return {"time": 0.0, "duration": None, "updatedAt": None}
        try:
            payload = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {"time": 0.0, "duration": None, "updatedAt": None}
        time_value = payload.get("time")
        duration = payload.get("duration")
        if not isinstance(time_value, (int, float)) or not math.isfinite(time_value) or time_value < 0:
            time_value = 0.0
        if not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
            duration = None
        return {
            "time": float(time_value),
            "duration": float(duration) if duration is not None else None,
            "updatedAt": payload.get("updatedAt"),
        }

    def save_playback_state(self, video_id: str, payload: object) -> dict[str, object]:
        if not isinstance(payload, dict):
            raise ValueError("JSON body must be an object")
        job_dir = self.job_dir(video_id)
        if not job_dir.is_dir():
            raise FileNotFoundError(job_dir)
        time_value = payload.get("time")
        duration = payload.get("duration")
        if not isinstance(time_value, (int, float)) or isinstance(time_value, bool) or not math.isfinite(time_value):
            raise ValueError("time must be a finite number")
        if time_value < 0:
            raise ValueError("time must be non-negative")
        if duration is not None:
            if not isinstance(duration, (int, float)) or isinstance(duration, bool) or not math.isfinite(duration) or duration <= 0:
                raise ValueError("duration must be a positive finite number or null")
            if time_value > duration + 5:
                raise ValueError("time is beyond duration")
        normalized = {
            "time": round(float(time_value), 3),
            "duration": round(float(duration), 3) if duration is not None else None,
            "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        state_path = job_dir / "ui-state.json"
        temp_path = job_dir / f".ui-state.json.{os.getpid()}.{threading.get_ident()}.tmp"
        temp_path.write_text(json.dumps(normalized, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        os.replace(temp_path, state_path)
        self.size_cache.pop(video_id, None)
        return normalized

    def summarize_job(self, job_dir: Path, *, include_history: bool = False) -> dict[str, object]:
        if not job_dir.is_dir():
            raise FileNotFoundError(job_dir)
        try:
            status = load_status(job_dir)
        except Exception as error:
            status = {
                "videoId": job_dir.name,
                "title": job_dir.name,
                "sourceUrl": "",
                "state": "failed",
                "stage": "status",
                "progress": 0,
                "message": "狀態檔無法讀取",
                "updatedAt": None,
                "lastError": str(error),
                "history": [],
                "subtitleTracks": {},
            }

        video_id = job_dir.name
        if status.get("videoId") != video_id:
            status["state"] = "failed"
            status["message"] = "status.json 的 videoId 與資料夾名稱不一致"
            status["lastError"] = f"expected {video_id!r}, got {status.get('videoId')!r}"
        video = self.video_path(job_dir)
        captions = self.caption_paths(job_dir)
        thumbnail = self.thumbnail_path(job_dir)
        state = str(status.get("state") or "queued")
        effective_state = state
        message = str(status.get("message") or "")

        if state in ACTIVE_STATES:
            process = status.get("process") if isinstance(status.get("process"), dict) else {}
            updated_at = parse_timestamp(str(status.get("updatedAt") or ""))
            stale_seconds = None
            if updated_at:
                stale_seconds = (datetime.now(timezone.utc) - updated_at).total_seconds()
            if not process_is_alive(process.get("pid")) and (stale_seconds is None or stale_seconds > 45):
                effective_state = "interrupted"
                message = "工作程序已停止；可由 Agent 從目前階段繼續"
        if state == "ready" and video is None:
            effective_state = "failed"
            message = "狀態顯示完成，但找不到 video.mp4"

        result: dict[str, object] = {
            "videoId": video_id,
            "title": status.get("title") or video_id,
            "sourceUrl": status.get("sourceUrl") or "",
            "state": state,
            "effectiveState": effective_state,
            "stage": status.get("stage") or state,
            "progress": status.get("progress") or 0,
            "message": message,
            "createdAt": status.get("createdAt"),
            "updatedAt": status.get("updatedAt"),
            "completedAt": status.get("completedAt"),
            "lastError": status.get("lastError"),
            "watchable": video is not None,
            "captionCodes": list(captions),
            "subtitleTracks": status.get("subtitleTracks") or {},
            "transcription": status.get("transcription"),
            "sizeBytes": self.job_size(job_dir),
            "thumbnailUrl": f"/thumbnails/{video_id}" if thumbnail else None,
            "watchUrl": f"/watch/{video_id}/?embed=1" if video else None,
            "hasLog": (job_dir / "logs" / "workflow.log").is_file(),
            "playback": self.playback_state(job_dir),
        }
        if include_history:
            result["history"] = status.get("history") or []
            result["assets"] = status.get("assets") or {}
        return result

    def list_jobs(self) -> list[dict[str, object]]:
        if not self.jobs_root.is_dir():
            return []
        jobs = [
            self.summarize_job(path)
            for path in self.jobs_root.iterdir()
            if path.is_dir() and VIDEO_ID_PATTERN.fullmatch(path.name)
        ]
        jobs.sort(key=lambda item: str(item.get("updatedAt") or ""), reverse=True)
        return jobs

    def player_config(self, video_id: str) -> dict[str, object]:
        job_dir = self.job_dir(video_id)
        summary = self.summarize_job(job_dir)
        if not summary["watchable"]:
            raise FileNotFoundError(job_dir / "source" / "video.mp4")
        captions = self.caption_paths(job_dir)
        tracks = [
            {
                "code": code,
                "label": TRACK_LABELS.get(code, code),
                "src": f"/captions/{video_id}/{code}.vtt",
            }
            for code in captions
        ]
        default_language = "zh-TW" if "zh-TW" in captions else ("en" if "en" in captions else (next(iter(captions), "off")))
        return {
            "videoId": video_id,
            "title": summary["title"],
            "kicker": "Local library · iframe screening",
            "video": {"src": f"/media/{video_id}/video", "type": "video/mp4"},
            "defaultLanguage": default_language,
            "captions": tracks,
            "playback": summary["playback"],
        }


class LibraryRequestHandler(BaseHTTPRequestHandler):
    server_version = "LocalVideoLibrary/1.0"
    protocol_version = "HTTP/1.1"
    application: LibraryApplication

    def log_message(self, format_string: str, *args: object) -> None:
        sys.stderr.write(f"[{self.log_date_time_string()}] {format_string % args}\n")

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; "
            "connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'",
        )
        super().end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        self.route_request(head_only=True)

    def do_GET(self) -> None:  # noqa: N802
        self.route_request(head_only=False)

    def do_PUT(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        parts = [part for part in path.split("/") if part]
        try:
            if len(parts) != 4 or parts[:2] != ["api", "jobs"] or parts[3] != "playback":
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_JSON_BODY:
                self.send_error(HTTPStatus.BAD_REQUEST, "invalid JSON body size")
                return
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            result = self.application.save_playback_state(parts[2], payload)
            self.send_json(result, head_only=False)
        except FileNotFoundError as error:
            self.send_error(HTTPStatus.NOT_FOUND, str(error))
        except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as error:
            self.send_error(HTTPStatus.BAD_REQUEST, str(error))
        except Exception as error:  # pragma: no cover - defensive HTTP boundary
            self.log_error("write request failed: %s", error)
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR)

    def route_request(self, *, head_only: bool) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        try:
            if path in {"/", "/index.html"}:
                self.send_file(self.application.library_template / "index.html", head_only=head_only, cache="no-store")
                return
            if path == "/assets/library.css":
                self.send_file(self.application.library_template / "library.css", head_only=head_only, cache="no-store")
                return
            if path == "/assets/library.js":
                self.send_file(self.application.library_template / "library.js", head_only=head_only, cache="no-store")
                return
            if path == "/api/health":
                self.send_json({"status": "ok"}, head_only=head_only)
                return
            if path == "/api/jobs":
                self.send_json({"jobs": self.application.list_jobs(), "serverTime": datetime.now(timezone.utc).isoformat()}, head_only=head_only)
                return

            parts = [part for part in path.split("/") if part]
            if len(parts) == 3 and parts[:2] == ["api", "jobs"]:
                video_id = parts[2]
                payload = self.application.summarize_job(self.application.job_dir(video_id), include_history=True)
                self.send_json(payload, head_only=head_only)
                return
            if len(parts) == 4 and parts[:2] == ["api", "jobs"] and parts[3] == "log":
                video_id = parts[2]
                query = parse_qs(parsed.query)
                requested = int(query.get("lines", ["160"])[0])
                lines = max(20, min(500, requested))
                log = tail_text(self.application.job_dir(video_id) / "logs" / "workflow.log", lines)
                self.send_json({"videoId": video_id, "log": log}, head_only=head_only)
                return
            if len(parts) == 2 and parts[0] == "watch":
                job_dir = self.application.job_dir(parts[1])
                summary = self.application.summarize_job(job_dir)
                if not summary["watchable"]:
                    raise FileNotFoundError(job_dir / "source" / "video.mp4")
                if not path.endswith("/"):
                    suffix = f"?{parsed.query}" if parsed.query else ""
                    self.redirect(f"/watch/{parts[1]}/{suffix}")
                    return
                self.send_file(self.application.player_template / "index.html", head_only=head_only, cache="no-store")
                return
            if len(parts) == 3 and parts[0] == "watch" and parts[2] == "index.html":
                self.application.summarize_job(self.application.job_dir(parts[1]))
                self.send_file(self.application.player_template / "index.html", head_only=head_only, cache="no-store")
                return
            if len(parts) == 3 and parts[0] == "watch" and parts[2] == "config.js":
                config = self.application.player_config(parts[1])
                script = "window.XERUCA_PLAYER_CONFIG = " + json.dumps(config, ensure_ascii=False) + ";\n"
                self.send_bytes(script.encode("utf-8"), "text/javascript; charset=utf-8", head_only=head_only, cache="no-store")
                return
            if len(parts) == 3 and parts[0] == "media" and parts[2] == "video":
                video = self.application.video_path(self.application.job_dir(parts[1]))
                if video is None:
                    self.send_error(HTTPStatus.NOT_FOUND)
                else:
                    self.send_file(video, head_only=head_only, cache="private, max-age=3600", allow_range=True)
                return
            if len(parts) == 3 and parts[0] == "captions" and parts[2].endswith(".vtt"):
                language = parts[2][:-4]
                caption = self.application.caption_paths(self.application.job_dir(parts[1])).get(language)
                if caption is None:
                    self.send_error(HTTPStatus.NOT_FOUND)
                else:
                    self.send_file(caption, head_only=head_only, cache="no-store")
                return
            if len(parts) == 2 and parts[0] == "thumbnails":
                thumbnail = self.application.thumbnail_path(self.application.job_dir(parts[1]))
                if thumbnail is None:
                    self.send_error(HTTPStatus.NOT_FOUND)
                else:
                    self.send_file(thumbnail, head_only=head_only, cache="private, max-age=3600")
                return
            self.send_error(HTTPStatus.NOT_FOUND)
        except (FileNotFoundError, ValueError, KeyError, json.JSONDecodeError) as error:
            self.send_error(HTTPStatus.NOT_FOUND, str(error))
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
        except OSError as error:
            if error.errno in {errno.EPIPE, errno.ECONNRESET, errno.ECONNABORTED, errno.ENOBUFS}:
                self.close_connection = True
                return
            self.log_error("request failed: %s", error)
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR)
        except Exception as error:  # pragma: no cover - defensive HTTP boundary
            self.log_error("request failed: %s", error)
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR)

    def redirect(self, location: str) -> None:
        self.send_response(HTTPStatus.TEMPORARY_REDIRECT)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_json(self, payload: object, *, head_only: bool) -> None:
        body = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        self.send_bytes(body, "application/json; charset=utf-8", head_only=head_only, cache="no-store")

    def send_bytes(self, body: bytes, content_type: str, *, head_only: bool, cache: str) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def send_file(self, path: Path, *, head_only: bool, cache: str, allow_range: bool = False) -> None:
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        size = path.stat().st_size
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        range_header = self.headers.get("Range") if allow_range else None
        start = 0
        end = size - 1
        status = HTTPStatus.OK

        if range_header:
            match = RANGE_PATTERN.fullmatch(range_header.strip())
            if not match or (not match.group(1) and not match.group(2)):
                self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                return
            if match.group(1):
                start = int(match.group(1))
                end = int(match.group(2)) if match.group(2) else size - 1
            else:
                suffix_length = int(match.group(2))
                start = max(0, size - suffix_length)
            if start >= size or end < start:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            end = min(end, size - 1)
            status = HTTPStatus.PARTIAL_CONTENT

        length = max(0, end - start + 1)
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", cache)
        if allow_range:
            self.send_header("Accept-Ranges", "bytes")
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if head_only:
            return

        with path.open("rb") as handle:
            handle.seek(start)
            remaining = length
            while remaining > 0:
                chunk = handle.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    self.close_connection = True
                    return
                except OSError as error:
                    if error.errno in {errno.EPIPE, errno.ECONNRESET, errno.ECONNABORTED, errno.ENOBUFS}:
                        self.close_connection = True
                        return
                    raise
                remaining -= len(chunk)


def build_parser() -> argparse.ArgumentParser:
    script_dir = Path(__file__).resolve().parent
    skill_root = script_dir.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    parser.add_argument("--pid-file", type=Path)
    parser.add_argument("--library-template", type=Path, default=skill_root / "assets" / "library")
    parser.add_argument("--player-template", type=Path, default=skill_root / "assets" / "player")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("refusing to bind beyond localhost")
    if not 1 <= args.port <= 65535:
        raise SystemExit("port must be between 1 and 65535")
    if args.workspace.resolve() == Path("/") or args.workspace.resolve() == Path.home().resolve():
        raise SystemExit("choose a dedicated workspace, not the filesystem root or home directory")
    workspace = args.workspace.resolve()
    pid_file = args.pid_file.resolve() if args.pid_file else None
    if pid_file is not None:
        try:
            pid_file.relative_to(workspace)
        except ValueError as error:
            raise SystemExit("pid file must stay inside the workspace") from error
        if pid_file.is_file():
            try:
                existing_pid = int(pid_file.read_text(encoding="utf-8").strip())
            except (OSError, ValueError):
                existing_pid = 0
            if process_is_alive(existing_pid):
                raise SystemExit(f"library server is already running with pid {existing_pid}")
    for required in (
        args.library_template / "index.html",
        args.library_template / "library.css",
        args.library_template / "library.js",
        args.player_template / "index.html",
    ):
        if not required.is_file():
            raise SystemExit(f"template file not found: {required}")

    args.workspace.mkdir(parents=True, exist_ok=True)
    (args.workspace / "jobs").mkdir(exist_ok=True)
    application = LibraryApplication(args.workspace, args.library_template, args.player_template)
    LibraryRequestHandler.application = application
    server = ThreadingHTTPServer((args.host, args.port), LibraryRequestHandler)
    server.daemon_threads = True

    def stop_server(signum: int, _frame: object) -> None:
        print(f"\nreceived signal {signum}; stopping", file=sys.stderr)
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop_server)
    if pid_file is not None:
        temp_pid_file = pid_file.with_name(f".{pid_file.name}.{os.getpid()}.tmp")
        temp_pid_file.write_text(f"{os.getpid()}\n", encoding="utf-8")
        os.replace(temp_pid_file, pid_file)
    print(f"Local video library: http://{args.host}:{args.port}/")
    print(f"Workspace: {application.workspace}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if pid_file is not None:
            try:
                if int(pid_file.read_text(encoding="utf-8").strip()) == os.getpid():
                    pid_file.unlink()
            except (FileNotFoundError, OSError, ValueError):
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
