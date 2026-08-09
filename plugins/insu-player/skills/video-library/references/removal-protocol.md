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

## Adding another removable resource

Add an explicit resource handler to `HANDLERS`; do not add arbitrary path deletion or resource-mode booleans. Each subtitle, summary, segmentation, or note handler must define its stable ID, owned files, database relationships, dependency policy, plan fingerprint, execution behavior, and verification checks. Extend the shared removal contract with that target kind, then add a small resource adapter around the React `ResourceRemovalDialog`. Keep preview, digest-bound confirmation, execution, verification, cache invalidation, and route exit behavior unchanged.
