---
name: player-manager
description: Inspect, safely update, diagnose, or remove INSU Player across a Git checkout, Codex marketplace installation, or portable Release ZIP. Use when a user asks whether INSU is current, wants Codex to self-update, needs installation health, or wants complete removal.
---

# INSU Player Manager

Detect the installation mode and use the matching update lifecycle. Checks are read-only; mutations require the user's explicit request and "--apply".

## Inspect

~~~bash
python3 plugins/insu-player/skills/player-manager/scripts/manage.py status
python3 plugins/insu-player/skills/player-manager/scripts/manage.py update
~~~

For an installed plugin cache, execute the script using the skill's absolute path. Report the detected mode, current version, update availability, dirty files, and preserved data boundary.

## Update

- Git checkout: require a clean worktree, fetch "origin/main", and allow only a fast-forward pull.
- Codex plugin: run the official marketplace upgrade, then refresh `insu-player@insu-player`.
- Portable ZIP: download the latest GitHub release, verify the ZIP checksum and internal manifest, refuse modified managed files, back up old managed files, and preserve the entire ".local/" tree.

~~~bash
python3 plugins/insu-player/skills/player-manager/scripts/manage.py update --apply
~~~

After code or plugin updates, tell the user to start a new Codex task or reload the workspace so skill discovery uses the new snapshot. Never silently schedule or background an update.

## Remove

Preview first:

~~~bash
python3 plugins/insu-player/skills/player-manager/scripts/manage.py uninstall
~~~

For a Codex installation, "--apply" removes the plugin; "--remove-marketplace" also removes its marketplace registration. For Git/portable mode, cleanup delegates to the workflow uninstaller. "--include-library" is destructive and requires explicit authorization.

The manager does not delete its own repository folder. For complete removal, stop the local server and jobs, run the authorized cleanup, resolve the exact repository root, then ask before moving that one folder to Trash. Report whether videos and subtitles were retained.

Read [references/lifecycle.md](references/lifecycle.md) before changing updater behavior or release layout.

## Reset the Current Project Library

Use this clean-break operation only when the user explicitly asks to rebuild the current project's entire INSU Player library. It removes videos, subtitles, session-only API Keys, job history, playback state, and `app.db`, while preserving repository code and the workspace-local Bun, Python, Whisper, FFmpeg, yt-dlp, and model downloads.

Create the read-only preview first:

```bash
python3 plugins/insu-player/skills/player-manager/scripts/reset_library.py preview \
  --project-root PROJECT_ROOT \
  --workspace PROJECT_ROOT/.local/insu-player
```

Report the exact targets, configured API Key names without values, and digest, then stop. Do not treat the original reset request as confirmation of a digest that did not yet exist. After the user replies with `確認重建 DIGEST`, stop the workspace-owned server so every session-only API Key is destroyed, execute the exact plan, restart the homepage, and verify zero jobs plus zero configured API Keys:

```bash
python3 plugins/insu-player/skills/player-manager/scripts/reset_library.py execute \
  --project-root PROJECT_ROOT \
  --workspace PROJECT_ROOT/.local/insu-player \
  --plan-digest DIGEST \
  --yes

python3 plugins/insu-player/skills/player-manager/scripts/reset_library.py verify \
  --project-root PROJECT_ROOT \
  --workspace PROJECT_ROOT/.local/insu-player
```

The script accepts only the exact current-project workspace, refuses symlinks and live job processes, and requires the server to be stopped before execution. It does not migrate or preserve old library contracts.
