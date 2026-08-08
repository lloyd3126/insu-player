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
