# System Logical Installation Experiment

Design status: **Superseded as a target implementation contract** by
[translated-core Task integration](../../../../roadmaps/task-system/slices/04-translated-core-integration.md).
Implementation status: **Partial uncommitted experiment; not activated**.
Measurement status: **Required gates unmet**.

## Ownership And Disposition

The [checkpointed Task experiment](../../../../roadmaps/task-system/slices/03-system-schema-installation.md)
retains useful authority, readiness, lifetime and durable-outcome requirements.
Shared bootstrap/schema/operation/persistence owners implement them; Trigger
remains the Task lifecycle engine. The total rewrite does not require preserving
the current candidate/envelope/catalog/generation representation. No data reset
or new runtime mechanism is approved by this record.

## Pinned Convex Mechanism

Historical experiment revision: `84fbb0e70b4e857913673871cb847ad11a55f3d5`.
These observations are not recertified by the
[active source upgrade](../../REFERENCES.md#convex-source-identity).
Refresh the source challenge against that pin before runtime implementation.
Relevant pinned Git blobs are `crates/model/src/lib.rs`
`9d4fea42f7230e421506b6d63d569a2c70249645`, system-table declarations
`1b398bbc1666158470a7a5df1348d70d20ba13e5`, and system metadata
`835748183398ea7f97e9c62198c2ff3cb956c6aa`.

`crates/database/src/system_tables.rs` declares typed private metadata/indexes;
`crates/model/src/lib.rs` bootstraps them independently of developer analysis.
Transaction system-table creation requires system identity, and the guarded
system-metadata API checks system/admin identity. Its internal unchecked
`insert_metadata` is an internal owner boundary, not authority to give callers.
Application schema/index replacement excludes private system tables/indexes.
Bootstrap distinguishes new empty-table readiness from existing-table backfill.

## Checkpointed Proposal And Why It Is Superseded

The committed baseline candidate/read-source formats embed App analysis. The
experiment proposed an explicit system root, immutable source artifact and
installed obligation, source-scoped serving, fresh readiness and a separate
retention pin. It also restricted initial placement to one actual shared
catalog/target handle rather than claiming cross-database atomicity.

Those choices responded to existing APIs; they do not independently justify a
difference from the pin. The accepted rewrite replaces current core, installer,
migration and physical-schema internals where required. Private logical metadata
and progress belong above the translated five-table persistence by default.
Existing catalog layout and execution choreography cannot select the target.

## Requirements Retained For The Replacement

- Bootstrap private Task schemas without App analysis or the Task engine.
- Authenticate producer, scope, installed target and operation lifetime; namespace
  spelling and digest integrity alone grant no serving capability.
- Keep installation obligation, index/constraint readiness and execution separate;
  interrupted work and uncertain outcomes need the actual shared recovery owner.
- Preserve private data across App redeploy, while genuine stale/revoked authority
  refuses. Stale runtime preparation must not erase unresolved durable obligations.
- Keep PostgreSQL durable authority and transactions outside arbitrary handlers,
  pauses and remote effects. Preserve required native behavior and named data.

## Required Witnesses And Remaining Limits

The [legacy namespace counterexample](../../../../roadmaps/task-system/baseline/legacy-namespace-writer-closure.md)
shows why metadata absence is not a freshness proof while old writers coexist.
The common cutover must decide actual coexistence versus retirement/data
migration before extending that old physical model. No namespace column or
migration was implemented or selected.

The revised connected slice requires actual nonempty logical writes/indexed
reads, App-free bootstrap, recovery/replay, stale/forged capability refusal,
readiness withdrawal, native coexistence and retirement on PGlite and ordinary-role
PostgreSQL. Host/cache claims need actual runtime proof. No connected database,
Task runtime or performance capability is established by this experiment.
