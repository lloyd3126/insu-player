---
name: video-library
description: Start, inspect, repair, or explain an existing INSU Player localhost library. Use when a user wants to see the library homepage, check downloads or transcription jobs, reopen the player, diagnose a failed or interrupted job, inspect storage, or clean only safe intermediate files without adding a new video.
---

# INSU Video Library

Operate the durable workspace created by `$watch-video`. Do not duplicate or relocate its runtime.

## Open Before Inspecting

1. Resolve and state the exact workspace. Portable mode defaults to `.local/insu-player/`; otherwise use the project-local workspace the user selected, or `<current-project-root>/.local/insu-player/` when no path was supplied.
2. Never adopt another INSU workspace outside the current project because it is non-empty or already serving localhost. A running service is the selected library only when its PID and session descriptor are inside the resolved workspace. Another service on the requested port is a port conflict, not a workspace candidate.
3. Make opening this workspace's homepage in the Codex in-app browser the first user-visible product action. Keep it open while inspection, repair, or cleanup continues.

## Start the Selected Workspace Homepage

From a portable repository root:

```bash
scripts/portable/serve.sh 8000
```

From an installed plugin skill:

```bash
../watch-video/scripts/serve-library.sh WORKSPACE 8000
```

Open `http://127.0.0.1:8000/` in the Codex in-app browser when available. If another workspace already owns port `8000`, do not inspect, reuse, or stop it; start the selected workspace on another port such as `8010` and open that exact URL. Keep the user on this workspace's page; watching must open the same-origin iframe modal.

## Inspect While the Homepage Is Open

1. Locate the sibling canonical skill at `../watch-video/` and read its `references/workflow.md` for job states. Read `references/troubleshooting.md` when a check fails.
2. Run `../watch-video/scripts/doctor.sh WORKSPACE` before repair or cleanup.
3. Treat each job's `status.json`, history, process metadata, and log as the source of truth. Do not infer completion from file names alone.

## Recover and Clean

- Re-run the original `process-video.sh` command for interrupted work. Existing media, captions, and state are reused.
- For one job, preview `../watch-video/scripts/clean-job.sh WORKSPACE VIDEO_ID`; add `--yes` only for the exact reviewed target.
- Safe cleanup removes reproducible intermediates and preserves playable media, captions, logs, status, and progress.
- Never remove all generated media unless the user explicitly requests it; use `$player-manager` for full lifecycle removal.

Report the homepage URL, workspace, active/attention/ready counts, failed job reason, retained artifacts, and the next exact command.
