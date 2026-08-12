# Installation lifecycle

## Installation forms

1. Codex marketplace: registered from the GitHub repository and cached by Codex. Updating uses the official marketplace commands.
2. Git checkout: repository files are editable. Updating is allowed only with a clean worktree and a fast-forward from "origin/main".
3. Portable Release ZIP: the repository is a self-contained immutable release. A newer release is installed into a new directory and starts with its own current workspace contract.

## Update invariants

- A check does not mutate files or Codex configuration.
- An apply operation verifies provenance before replacement.
- API keys, cookies, credentials, media, and ".local/" never enter an update archive or backup of managed files.
- Portable releases do not support in-place code updates. A workspace is never silently copied into a new release. When the user explicitly wants to preserve its library, use `$migrate-player-library` from the new release to create a confirmed one-shot current-shape migration.
- Update failures leave user data in place and report the exact failed check.

## Removal invariants

- Preview is the default.
- Removing tools and caches preserves jobs unless "include library" is explicitly authorized.
- Removing a Codex plugin does not automatically delete an unrelated portable library.
- Complete portable removal means stopping processes and moving the exact extracted repository folder to Trash; never target a home directory or broad parent.

## Library reset invariants

- A library reset is different from uninstall. It preserves the repository and the complete `.agent-tools/` runtime and model tree.
- Preview is read-only and returns a digest over the exact current-project workspace, jobs inventory, logical database row counts, and the action that clears all session-only API Keys. It may report configured Key names from the masked status API but never reads or returns values.
- Execution requires the user's confirmation of that exact digest, `--plan-digest`, and `--yes`.
- Live job processes, symlinks, an unreadable database, a changed digest, or a running workspace server stop execution. Stopping that exact server destroys all API Keys held in process memory before data removal.
- Reset removes `jobs/**`, `app.db`, its WAL/SHM files, stale server descriptors, incomplete local-import files, and temporary Cookie sessions. It recreates the empty `jobs/` and transient session directories.
- After execution, restart the current workspace homepage and verify that the job count and every non-bootstrap application data table are zero, and that the masked environment status contains zero configured API Keys.
