# Installation lifecycle

## Installation forms

1. Codex marketplace: registered from the GitHub repository and cached by Codex. Updating uses the official marketplace commands.
2. Git checkout: repository files are editable. Updating is allowed only with a clean worktree and a fast-forward from "origin/main".
3. Portable Release ZIP: the repository is a self-contained workspace. Managed files are recorded in "MANIFEST.sha256"; mutable tools, models, caches, jobs, media, captions, logs, playback state, and updater backups live below ".local/".

## Update invariants

- A check does not mutate files or Codex configuration.
- An apply operation verifies provenance before replacement.
- API keys, cookies, credentials, media, and ".local/" never enter an update archive or backup of managed files.
- Modified managed files stop a portable update for Agent review.
- Portable updates verify both the release ZIP checksum and its internal manifest.
- Obsolete managed files may be removed only after a backup is written inside ".local/player-manager/backups/".
- Update failures leave user data in place and report the exact failed check.

## Removal invariants

- Preview is the default.
- Removing tools and caches preserves jobs unless "include library" is explicitly authorized.
- Removing a Codex plugin does not automatically delete an unrelated portable library.
- Complete portable removal means stopping processes and moving the exact extracted repository folder to Trash; never target a home directory or broad parent.
