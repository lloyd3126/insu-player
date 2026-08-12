# One-shot migration data policy

The migration boundary is deliberately separate from the INSU Player runtime. A successful migration produces only current-contract data. It does not make old data readable by the application.

## Preserve when current validation succeeds

- media identity, source metadata, verified renditions, thumbnails, and duration
- current subtitle artifacts, tracks, dependency edges, selected tracks, and their files
- text summaries, mind maps, dependency edges, and active selections
- notes, note anchors, tags, and tag assignments
- playback position and selected language
- subtitle style presets and the active style
- selected transcription model ID when it still exists in the current catalog
- human-readable media status history and registered asset metadata

Every preserved row must use the current table shape. Embedded JSON and manifest files must also use the current semantic schema and pass current validators. Matching column names alone are insufficient.

## Always discard and rebuild

- session-only provider API Keys
- raw or hashed Cookie material, temporary cookie jars, signed URLs, and authorization headers
- Chrome Extension invitations, connection tokens, and pairing state
- active or completed operations and operation events
- pending download queue items, local import sessions, and media download runs
- model download runs, runtime capability cache, agent intents, subtitle run state, and subtitle pipeline run state
- PID files, inherited process state, temp directories, and resumable runtime state

Downloaded model files and workspace-local runtimes are filesystem resources outside the database migration and remain untouched.

## Legacy-only tables and values

Never silently discard a non-empty table that is absent from the current schema. The Agent must identify its former purpose and either map it to a current durable table or add an explicit drop reason to the transform bundle. That reason, row count, and bundle checksum become part of the confirmed digest.

Do not invent required values. If a legacy subtitle or summary cannot meet current processor identity, dependency, timing, checksum, or manifest rules, preserve the source media and omit the invalid derived artifact. Regenerate it later with the current skill.

## Cutover and rollback

The source database remains untouched during preview and staging. Execution requires the current server to be stopped. The script builds a new database from `current-schema.sql`, imports only approved current-shape rows, validates it against the current `job_state.py`, then performs an atomic database cutover.

The source database and sidecars are retained under `.insu-player-migrations/<digest>/source/`. A post-cutover validation failure restores them automatically. Removal of a successful rollback snapshot is a separate destructive decision.
