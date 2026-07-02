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

Added repository-wide checkpoint discipline:

- every repository-changing turn updates its relevant domain roadmap,
- every domain roadmap owns its concise completed-checkpoint summaries with
  commit IDs and titles,
- verified repository-changing turns are committed automatically, and
- the newest commit is recorded in its relevant domain roadmap on the following
  repository-changing turn because a commit cannot contain its own stable ID.

Removed the global implementation ledger introduced by checkpoint
`64eb2f9 Require documented automatic checkpoints`. A single chronological
ledger would eventually become a giant project-history document and duplicate
the focused domain records. The automatic commit rule remains, but checkpoint
history now stays with the domain it explains.

Reworked the two standing reviewer prompts after the Effect migration completed.
`typescript-diff-reviewer` and `code-quality-diff-reviewer` are now
Effect-aware reviewers for ordinary core implementation work as well as Effect
service/schema/runtime changes. Removed the migration-only reviewer prompt so
reviewer routing no longer depends on a special migration exception.

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
- This checkpoint policy is a Flarex repository workflow rule rather than a
  port of Convex runtime behavior.

## Cloudflare Differences

- The local repo includes Wrangler and Miniflare project files because Flarex
  targets Cloudflare Workers and Durable Objects directly.
- Generated Worker artifacts remain ignored because they are recreated by the
  Flarex generator and example scripts.

## Known Limitations

- No remote origin is configured yet.
- The parent Convex repository now ignores `custom/cloudflare-executor/`.
- A domain roadmap's implementation history intentionally trails its newest
  commit by one repository-changing turn because Git commit IDs are
  content-derived.
- The standing reviewers rely on the ignored local `opensrc/` cache for
  optional Effect reference material. If that cache is missing on a future
  machine, refresh `effect-TS/effect-smol` and `pingdotgg/t3code` before using
  those reference-backed review sections.

## Implementation Checkpoints

### `6096ad8` Initial Flarex Cloudflare executor prototype

Created the standalone Flarex prototype repository with its initial backend,
SDK, tests, example app, and domain roadmaps.

### `ea02381` Document parent ignore rule

Recorded the parent Convex repository ignore rule that keeps the nested Flarex
repository independent.

### `64eb2f9` Require documented automatic checkpoints

Added automatic verified checkpoint commits and initially introduced a global
implementation ledger. The automatic commit rule remains, while this turn
corrects checkpoint recording to stay domain-specific.

### `fe8ec44` Keep implementation history domain specific

Cleaned up the global chronological implementation log, leaving implementation checkpoint history domain-specific in their respective roadmaps.

### `3d0a85b` Wire hosted runtime core bindings

Started the post-migration core implementation lane by wiring hosted backend
bindings and adding the first hosted-shaped runtime integration proof.

### Pending checkpoint

Reworked `.codex/agents/typescript-diff-reviewer.toml` and
`.codex/agents/code-quality-diff-reviewer.toml` to include the Effect quality
bar from the migration-only reviewer, removed
the migration-only reviewer file, and updated `AGENTS.md` so all significant
code changes use the two standing Effect-aware reviewers.

## Verification

```sh
git status --short
git log --oneline -8
git diff --check
git -C C:\Users\Admin\Documents\github\convex-backend status --short -- .gitignore custom/cloudflare-executor
Test-Path .codex/agents/*effect*quality*checker*.toml
rg -n "legacy reviewers|Effect-TS migration changes" AGENTS.md .codex effect-ts-migration-draft -g "*.md" -g "*.toml"
```
