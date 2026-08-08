---
name: video-library
description: Start, inspect, repair, or explain an existing INSU Player localhost library. Use when a user wants to see the library homepage, check downloads or transcription jobs, reopen the player, diagnose a failed or interrupted job, inspect storage, or clean only safe intermediate files without adding a new video.
---

# INSU Video Library

Operate the durable workspace created by `$watch-video`. Do not duplicate or relocate its runtime.

## Inspect Before Acting

1. Resolve the exact workspace. Portable mode defaults to `.local/insu-player/`; otherwise use the workspace the user selected.
2. Locate the sibling canonical skill at `../watch-video/` and read its `references/workflow.md` for job states. Read `references/troubleshooting.md` when a check fails.
3. Run `../watch-video/scripts/doctor.sh WORKSPACE` before repair or cleanup.
4. Treat each job's `status.json`, history, process metadata, and log as the source of truth. Do not infer completion from file names alone.

## Start the Fixed Homepage

From a portable repository root:

```bash
scripts/portable/serve.sh 8000
```

From an installed plugin skill:

```bash
../watch-video/scripts/serve-library.sh WORKSPACE 8000
```

Open `http://127.0.0.1:8000/` in the Codex in-app browser when available. Keep the user on this page; watching must open the same-origin iframe modal.

## Recover and Clean

- Re-run the original `process-video.sh` command for interrupted work. Existing media, captions, and state are reused.
- For one job, preview `../watch-video/scripts/clean-job.sh WORKSPACE VIDEO_ID`; add `--yes` only for the exact reviewed target.
- Safe cleanup removes reproducible intermediates and preserves playable media, captions, logs, status, and progress.
- Never remove all generated media unless the user explicitly requests it; use `$player-manager` for full lifecycle removal.

Report the homepage URL, workspace, active/attention/ready counts, failed job reason, retained artifacts, and the next exact command.
