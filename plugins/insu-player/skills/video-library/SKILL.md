---
name: video-library
description: Start, inspect, repair, clean, or safely remove an owned resource from an existing INSU Player localhost library. Use when a user wants to see the library homepage, check downloads or transcription jobs, reopen the player, diagnose a failed or interrupted job, inspect storage, clean safe intermediate files, or manage a single owned resource without adding a new video.
---

# INSU Video Library

Operate the durable workspace created by `$watch-video`. Do not duplicate or relocate its runtime.

## Open Before Inspecting

1. Resolve and state the exact workspace. Portable mode defaults to `.local/insu-player/`; otherwise use the project-local workspace the user selected, or `<current-project-root>/.local/insu-player/` when no path was supplied.
2. Never adopt another INSU workspace outside the current project because it is non-empty or already serving localhost. A running service is reusable only when its live PID, `.insu-player-server.json`, and `/api/health` all identify the selected workspace's exact current build ID and status schema. If the selected workspace is running another build, stop it explicitly before restarting. The server must not auto-stop or take over a different build. Another service on the preferred port is a port conflict, not a workspace candidate.
3. Make opening this workspace's homepage in the Codex in-app browser the first user-visible product action. Keep it open while inspection, repair, or cleanup continues.

## Start the Selected Workspace Homepage

From a portable repository root:

```bash
scripts/portable/serve.sh
```

From an installed plugin skill:

```bash
../watch-video/scripts/serve-library.sh WORKSPACE
```

Open the exact URL reported by `serve-library.sh` in the Codex in-app browser when available. The server prefers port `8000`; if it is occupied, it binds an OS-selected free localhost port and writes the actual `host`, `port`, `pid`, `buildId`, and `statusSchemaVersion` to `WORKSPACE/.insu-player-server.json`. Do not guess a fallback port, inspect the service occupying `8000`, or stop it. Keep the user on this workspace's page; watching must open the same-origin iframe modal.

## Inspect While the Homepage Is Open

1. Locate the sibling canonical skill at `../watch-video/` and read its `references/workflow.md` for job states. Read `references/troubleshooting.md` when a check fails.
2. Run `../watch-video/scripts/doctor.sh WORKSPACE` before repair or cleanup.
3. Treat each job's `status.json`, history, process metadata, and log as the source of truth. Do not infer completion from file names alone.

## Recover and Clean

- Re-run the original `process-video.sh` command for interrupted work. Existing media, captions, and state are reused.
- For one job, preview `../watch-video/scripts/clean-job.sh WORKSPACE VIDEO_ID`; add `--yes` only for the exact reviewed target.
- Safe cleanup removes reproducible intermediates and preserves playable media, captions, logs, status, and progress.
- Never remove all generated media unless the user explicitly requests it. Use `$player-manager` only for application, runtime, or whole-workspace lifecycle removal.

## Remove One Owned Resource

Read [the removal protocol](references/removal-protocol.md) completely. The INSU Player interface performs direct removal through a shared confirmation dialog and server-side preview/execute endpoints; do not ask the user to copy a removal prompt to an Agent. Accept only a registered resource kind and stable ID; never accept a browser-supplied filesystem path.

The application must perform one-video removal in three stages:

1. Opening the confirmation dialog calls `scripts/remove_library_item.py preview WORKSPACE --kind video --video-id VIDEO_ID`. The remove action stays disabled until the read-only preview finishes without blockers.
2. Clicking the destructive action authorizes only the plan digest loaded by that dialog. The browser sends the stable resource ID and digest to the same-origin server; it never sends a path.
3. The server runs `execute` with that digest and `--yes`, then runs `verify`. A changed digest or blocker fails closed and requires the user to close and reopen the dialog for a fresh preview.

An Agent performing a manual diagnostic removal may call the same three script commands, but must still show the preview and wait for explicit confirmation of its current digest before `execute`.

Do not silently stop a live processing command. Ask the user before stopping it, then generate a fresh preview. Permanent removal is not recoverable without a separate backup or reprocessing an authorized source.

Report the homepage URL, workspace, active/attention/ready counts, failed job reason, retained or removed artifacts, removal verification when applicable, and the next exact command.
