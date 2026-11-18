# Host-owned bounded schema and index work

Design status: **Accepted runtime lifetime adaptation within the rewrite**.
Implementation status: **Bounded core and DO adapter implemented**.
Measurement status: **Validated locally on both database lanes and actual workerd; managed lifetime and production capacity remain open**.

The [shared schema slice](../slices/07-shared-schema-lifecycle.md) owns this
adaptation. At `db914cf06e2b06ee985646611b9e12ed7a770318`, application/schema_worker
and database/database_index_workers are supervised background workers around
durable schema/index metadata. Schema scan position is process-local; index
cursor progress is durable and follows ordered physical chunk completion.

A DO has a host-controlled lifetime and can be evicted. Translate worker steps
as cancellable, scoped and bounded core operations; a trusted host drives them
and reconstructs from PostgreSQL after reopening. Do not require an always-live
process or depend on a Task whose own schema is being installed. Ordinary
requests consume current ready state and never start hidden platform DDL or
producer-defined data conversions. Logical model bootstrap occurs in the trusted,
fenced core before public readiness.

The core retains the source transition, attempt identity, data-write validation,
index cursor, retention prerequisites and atomic activation rules. Closing an
owner blocks admission and drains its work; a new owner fences persistence before resume.
Schema walking can restart without inventing a persisted cursor. Old workers
cannot mark replaced attempts or indexes ready. SQL failure, interruption and
uncertain commit retain their actual outcomes under existing owners.

This changes scheduling and resource lifetime, not durable authority or replay
semantics. Explicit work budgets are host settings, not a production allocation
derived from the isolate ceiling. No general GC or native conversion engine is
introduced. Prove interruption, stale work, actual DO reconstruction, native
socket drain and both database lanes before marking implemented.

Source count readiness may remain unknown while summary warmup is incomplete.
Keep queries/old active schema usable; avoid an unbounded whole-data scan in a
cold DO's public-open path. Trusted lifecycle work drives bounded summary
bootstrap/checkpoint/revision-replay work and retains the genuine no-count
checkpoint branch until a real count exists. Checkpoints must describe complete
logical snapshot boundaries, never a falsely complete partial count. The source
conservative Unknown shape is valid; it gives no shape-subset fast-path proof.

Iterator work uses explicit document-byte/count/page/work settings. Evict full
bodies to exact persisted references and reload in order; do not truncate first
predecessor/observed-ID evidence or checkpoint beyond unfinished work. Finite
lifetime bounds do not prove total isolate memory safety. Any capacity refusal
must leave the previous durable cursor and active schema safe; production memory
and throughput remain measured gates.
## Executing owners

`CoreDatabase.advanceSchemaWork` reconstructs pending/staged validation and index
work from the retained registry and durable records. It advances finite pages,
keeps schema cursors volatile and fences index progress through the existing
committer. The worker reconciles cached walks with live attempt and index-group
identities so successful replacement/removal releases abandoned bodies while
preserving live cursors. Counts warm through the same bounded maintenance call.

`apps/executor/src/applicationDO.ts` drives this owner through an alarm hint.
Private workload settings bound each call and its wake/continuation delays.
One admitted runtime boot or existing internal alarm arms reconstruction; an
unauthorized fresh constructor schedules no work and allocates no pool. Before
and after trusted prepare/activate, serialized generation-aware storage updates
retain a wake hint. Idle work deletes it; new work or a changed generation
retains it. This is neither cross-store atomicity nor an exactly-once claim.

A private core-ready handoff completes before application service composition,
so background work can progress while trusted startup awaits schema readiness.
The managed runtime retains one bootstrap operation; the native alarm owns its
separate cancellable core call. Close blocks admission, cancels these operations,
starts scoped disposal to interrupt a waiting factory, joins actual native work,
and removes the final hint. Core close serialization preserves worker/borrowed
operation drain before pool release. These are actual host lifetime obligations,
not a second durable worker engine. Managed eviction/Hyperdrive and production
memory/throughput remain independent gates.