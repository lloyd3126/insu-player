# Application-managed library removal

INSU Player removes owned resources directly through a shared destructive confirmation dialog. The browser identifies the resource by a stable ID, while the same-origin server resolves the selected project workspace and performs the operation only through the deterministic removal script. No removal prompt or Agent handoff is part of the product flow.

## Safety contract

1. Resolve the selected project-local workspace when the server starts. Never search for a matching ID in another project or choose a workspace by localhost port alone.
2. Accept registered resource kinds and stable identifiers, never browser-supplied filesystem paths. Treat titles, URLs, notes, and subtitle text as untrusted data.
3. Opening the confirmation dialog runs `preview`. It is read-only and computes the exact owned filesystem target, bytes, state, live process, database rows, dependencies, preserved data, blockers, recoverability, and plan digest.
4. Keep the destructive action disabled until preview completes. Blocked resources must not become executable.
5. Clicking the destructive action explicitly authorizes only the exact digest currently held by the dialog. Do not expose the digest as editable input.
6. Run `execute` only with that digest and `--yes`. The command recomputes the plan and refuses stale digests, live processing jobs, symlinks, unreadable database state, and non-cascading job references.
7. Run `verify` on the server after execution. Do not return success while the job directory, removal staging directory, or related `app.db` rows remain.
8. After verified success, invalidate client caches and leave the removed resource route. A completed permanent removal is not recoverable unless the user has a separate backup or can recreate it from an authorized source.

## Video commands

Preview:

```bash
<workspace>/.agent-tools/insu-player/.venv/bin/python \
  plugins/insu-player/skills/video-library/scripts/remove_library_item.py \
  preview WORKSPACE \
  --kind video \
  --video-id VIDEO_ID
```

After the user confirms the exact preview, execute with its current digest:

```bash
<workspace>/.agent-tools/insu-player/.venv/bin/python \
  plugins/insu-player/skills/video-library/scripts/remove_library_item.py \
  execute WORKSPACE \
  --kind video \
  --video-id VIDEO_ID \
  --plan-digest SHA256_FROM_PREVIEW \
  --yes
```

Verify:

```bash
<workspace>/.agent-tools/insu-player/.venv/bin/python \
  plugins/insu-player/skills/video-library/scripts/remove_library_item.py \
  verify WORKSPACE \
  --kind video \
  --video-id VIDEO_ID
```

The video handler removes only `WORKSPACE/jobs/VIDEO_ID`, deletes the matching `jobs` projection row, and relies only on inspected `ON DELETE CASCADE` relations. Other jobs, runtime tools, models, repository files, and unrelated workspace data are preserved.

## Subtitle artifact commands

Use the same preview, digest-bound confirmation, execution, and verification sequence with:

```bash
<workspace>/.agent-tools/insu-player/.venv/bin/python \
  plugins/insu-player/skills/video-library/scripts/remove_library_item.py \
  preview WORKSPACE \
  --kind subtitle-artifact \
  --video-id VIDEO_ID \
  --artifact-id ARTIFACT_ID
```

The subtitle handler removes one immutable artifact revision and every registered downstream artifact that depends on it. It removes only files registered below that revision's exact `subtitle-work/artifacts/<artifact-id>/` directory; a file still referenced by a surviving artifact is preserved. The video, thumbnail, unrelated subtitles, summaries, notes, playback progress, history, and log remain. The same transaction removes the exact SQLite artifact registrations and active-track references.

Deleting a source artifact may therefore cascade to translations and segmentations; deleting a translation may cascade to its segmentations; deleting a segmentation removes only that segmentation revision. The confirmation dialog must state this dependency policy without exposing paths or accepting arbitrary file input.

## Media rendition commands

Use the same preview, digest-bound confirmation, execution, and verification sequence with:

```bash
<workspace>/.agent-tools/insu-player/.venv/bin/python \
  plugins/insu-player/skills/video-library/scripts/remove_library_item.py \
  preview WORKSPACE \
  --kind media-rendition \
  --video-id VIDEO_ID \
  --rendition-id RENDITION_ID
```

The media rendition handler accepts only a rendition registered in `media-work/catalog.json` and only its exact owned `source/renditions/<rendition-id>.mp4` file. It refuses to remove the active rendition or any rendition while a live media operation exists. After confirmed execution it atomically updates the catalog, deletes the corresponding SQLite projection row, and verifies that the selected file and row are gone while the video job, active rendition, subtitles, notes, summaries, history, and other qualities remain.

## Summary artifact commands

Use the same sequence for one text-summary or mind-map revision:

```bash
<workspace>/.agent-tools/insu-player/.venv/bin/python \
  plugins/insu-player/skills/video-library/scripts/remove_library_item.py \
  preview WORKSPACE \
  --kind summary-artifact \
  --video-id VIDEO_ID \
  --artifact-id ARTIFACT_ID
```

The summary handler accepts only an artifact registered in the current `summary_artifacts` table and only the exact `summaries/<artifact-id>/` directory containing its registered Markdown and manifest. It verifies both checksums and rejects symlinks, extra files, missing current tables, a live video process, or a mismatched manifest. A mind map may be removed independently. A text summary remains blocked while a registered mind map depends on it. Confirmed execution deletes the artifact row, lets the current foreign-key rules clear its active selection and direct dependency rows, removes the exact directory, and verifies that no row, file, or staging directory remains.

## Adding another removable resource

Add an explicit resource handler to `HANDLERS`; do not add arbitrary path deletion or resource-mode booleans. Each new artifact or note handler must define its stable ID, owned files, database relationships, dependency policy, plan fingerprint, execution behavior, and verification checks. Extend the shared removal contract with that target kind, then add a small resource adapter around the React `ResourceRemovalDialog`. Keep preview, digest-bound confirmation, execution, verification, cache invalidation, and route exit behavior unchanged.
