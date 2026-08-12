---
name: migrate-player-library
description: Compare an existing INSU Player workspace with the installed current data contract, create a read-only migration preview and digest, then rebuild and verify the library in staging without adding runtime compatibility code. Use when a user updates INSU Player and wants to preserve existing media, subtitles, summaries, notes, tags, styles, or playback state across a destructive schema change.
---

# Migrate INSU Player Library

Use this skill only for an explicit one-shot update migration. The application runtime remains current-contract-only. Never add `ALTER TABLE` startup logic, a legacy reader, inferred defaults, dual writes, schema coercion, or a fallback path to the server.

Read [references/data-policy.md](references/data-policy.md) before deciding which old values can survive. Old `app.db` and `jobs/**` are untrusted, read-only source material until the confirmed cutover.

## 1. Preview the exact source

Resolve the current project and its exact `<project>/.local/insu-player` workspace. Do not accept a path copied from an old prompt or arbitrary media paths.

```bash
python3 plugins/insu-player/skills/migrate-player-library/scripts/migrate_library.py preview \
  --project-root PROJECT_ROOT \
  --workspace PROJECT_ROOT/.local/insu-player
```

For an installed plugin, run the script by its absolute canonical skill path. Report in plain language:

- source and target data schema versions
- media and durable row counts
- preserved `jobs/**` size and item count
- every table copied, transformed, initialized empty, or discarded
- legacy-only data requiring an explicit drop reason
- blocking files, active processes, or invalid current artifacts
- the exact digest and `確認遷移 DIGEST`

Preview is not authorization to execute. Stop after showing the digest.

## 2. Resolve semantic blockers explicitly

Matching SQL columns do not prove that old values meet the new semantic contract. If preview reports `needs-table-transform` or `needs-media-record-transform`, create a fixed local transform input:

```bash
python3 plugins/insu-player/skills/migrate-player-library/scripts/migrate_library.py prepare-bundle \
  --project-root PROJECT_ROOT \
  --workspace PROJECT_ROOT/.local/insu-player
```

The bundle is bound to the logical source database digest and current target schema. Inspect the old rows, current schema, current validators, artifact manifests, and file checksums. Convert every emitted row to the exact current shape and meaning. Replace every `TODO` drop reason with a concrete explanation. Never guess a language, processor, checksum, timestamp, relationship, active artifact, or missing user value.

When old content cannot satisfy a current validator, exclude that derived artifact and its dependent rows from the transform bundle, preserve the original media, and report what must be regenerated after migration. Do not weaken the validator. Do not modify source media or the source database.

Run preview again after every bundle change. The new bundle checksum and resulting actions become part of a new digest.

## 3. Confirm and execute

Only after the user replies with the exact `確認遷移 DIGEST` may you:

1. Stop the exact workspace server and confirm no job process is alive.
2. Execute the confirmed plan.
3. Let the script create a fresh current-schema database in staging.
4. Validate foreign keys, current media records, subtitle manifests, checksums, and job files.
5. Atomically replace `app.db` only after staging succeeds.
6. Allow automatic rollback if post-cutover verification fails.

```bash
python3 plugins/insu-player/skills/migrate-player-library/scripts/migrate_library.py execute \
  --project-root PROJECT_ROOT \
  --workspace PROJECT_ROOT/.local/insu-player \
  --plan-digest DIGEST \
  --yes
```

The previous database is retained under `.insu-player-migrations/DIGEST/source/` as a rollback snapshot. Do not delete it in the same operation.

## 4. Restart and verify observable behavior

Start the current workspace homepage with `$video-library`, open the actual localhost URL, and then run:

```bash
python3 plugins/insu-player/skills/migrate-player-library/scripts/migrate_library.py verify \
  --project-root PROJECT_ROOT \
  --workspace PROJECT_ROOT/.local/insu-player
```

Verify the real interface as well as the command result:

- expected media count and titles appear
- representative media plays
- selected subtitles and playback state resolve
- notes, tags, summaries, mind maps, and saved subtitle styles appear when present
- no old operation resumes and no API Key, Cookie, token, PID, or temporary session is restored

Report preserved counts, discarded data, regeneration work, rollback location, and verification evidence. If anything fails, keep or restore the original database and do not claim completion.
