# Trigger.dev source notice

The files under `upstream/` are a selective, unmodified source import from
Trigger.dev commit `f10bc23785e569e5d917318cf2033aabdbe96a0b`.

Trigger.dev's repository-level source is licensed under Apache License 2.0.
The complete upstream license is retained at `upstream/LICENSE`. The imported
`@trigger.dev/core` package also retains its package-local MIT `LICENSE`.

The compatibility harness outside `upstream/` is Flarex-owned. It does not
change the license of the imported source and does not imply endorsement by or
affiliation with Trigger.dev.

The harness-level `test-timings.json` is a path-prefixed projection of the
run-engine entries in the pinned commit's root timing data. It changes only CI
shard placement and is not part of the imported source.
