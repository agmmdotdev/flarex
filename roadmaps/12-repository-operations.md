# Repository Operations

## Goal

Flarex should be able to move as an independent project instead of remaining
only an untracked folder inside the Convex checkout.

## Current Update

Initialized the plan for `custom/cloudflare-executor` to become its own Git
repository. The repository keeps the prototype source, package metadata,
roadmaps, and lockfile together while ignoring local dependency installs,
Wrangler output, and generated example artifacts through the local
`.gitignore`.

Added `custom/cloudflare-executor/` to the parent Convex checkout's
`.gitignore` so the nested Flarex repository can remain independent until it is
moved to its own top-level location or remote.

## Why This Shape

The Flarex work is now a separate Cloudflare-native backend and SDK prototype.
Keeping it in its own repository makes future commits, branches, and remotes
independent from the upstream Convex backend checkout while still allowing the
Convex source tree to remain nearby for reference.

## Convex References

- The parent `convex-backend` checkout remains the reference source for
  Convex-inspired APIs and backend behavior.
- No new Convex source files were required for this repository-operations
  change.

## Cloudflare Differences

- The local repo includes Wrangler and Miniflare project files because Flarex
  targets Cloudflare Workers and Durable Objects directly.
- Generated Worker artifacts remain ignored because they are recreated by the
  Flarex generator and example scripts.

## Known Limitations

- No remote origin is configured yet.
- The parent Convex repository now ignores `custom/cloudflare-executor/`.
- No remote origin is configured yet.

## Verification

```sh
git status --short
git -C C:\Users\Admin\Documents\github\convex-backend status --short -- .gitignore custom/cloudflare-executor
```
