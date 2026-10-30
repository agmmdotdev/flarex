# Fresh Application transaction and persistence cutover

Status: **Current-pin independent challenge and peer exchange complete;
connected fresh-target implementation; broader activation gates open**.
This is a bounded portion of [slice 06](./06-convex-persistence-translation.md),
under the [goal](../GOAL.md) and [translation plan](../REFACTOR.md).
Reference: Convex db914cf06e2b06ee985646611b9e12ed7a770318; Flarex challenge
checkpoint 9575cf617 plus the preserved shared graph, with Task documentation
boundary 2a677dc00. Git owns execution/review receipts, not this design record.

## Selected consumer and storage

Migrate the existing Standard users:deleteThroughInternal nested mutation/replay
and its caught-child-failure counterpart, using applicationNativeMutationHarness,
makeApplicationMutationTestLive and the actual MiniflareApplicationWorkerLoader.
This loads emitted user code through LOADER; the trusted core initially runs in
the test host. The separate handwritten broad Worker stub is not actual-host proof.
The selected Worker RPC admits unbounded index scans. Nonempty legacy encoded
bounds fail closed: their full-tuple row-ID sentinel does not include the new
implicit developer-ID key. Translate the shared Application bound compiler and
its equality/inclusive/exclusive controls before enabling bounded RPC reads.
The portable engine's correctly encoded interval support is a separate layer.
App-DO lifecycle/coordination remains a later required gate. The initial trusted
host closes its old instance before cold reopen. A SQL write fence alone does
not notify an old RAM owner that new read admission is unsafe; concurrent owner-
replacement/read readiness needs the actual host lifecycle protocol before
app-owner activation, rather than an invented per-hit SQL check.

Use one trusted platform PostgreSQL namespace, flarex_core, with the five shared
tables and the pinned multitenant instance_name discriminator. A disposable
fixture may provision its own installation namespace; no SQL schema is created
per logical app. The trusted target descriptor binds every selected-target
metadata/data/outcome/claim/read/recovery operation. Installation is explicit
platform maintenance, never hidden framework startup DDL.

Existing five-name legacy formats in their old namespace remain untouched.
The new target cannot use the old global migrator, runtime facade, unfenced
single-row writer, old lease sequencer, materializer or membership/body readers.
Prove actual ordinary-role old-writer exclusion. An absent deployment row is not
evidence of an unused namespace. The preserved orphan/racing-writer witness
remains a separate old-target obligation; this fresh target does not fix it.

No existing data is reset or converted. Retained old scopes, H05 seeds/teardown,
legacy invocation/freshness/live-query consumers and native/current/search
consumers retain their named old targets until their connected replacement and
explicit data disposition. This is staging toward one engine, not a fallback
selected after a new-target failure. Remove those paths as their consumers move.

## Contracts before runtime cutover

- SQL-free persistence records use bigint timestamps, opaque 16-byte internal
  IDs, snapshot-specific IndexRef, write mode and predecessor evidence. The PG
  adapter persists logical index identity; mode/prev require no extra PG columns.
- Translate pinned v6 public IDs (u32 table number, internal ID, VInt/base32/
  checksum/version). Replace the fresh fixture's table:UUID literal. Whole old
  ID/value/key envelopes are not verified equivalents and cannot pass unchanged.
- Persist the full document, including _id/_creationTime, as UTF-8 Convex internal
  JSON. Preserve value meaning rather than claim identical Rust/JS number spelling.
  Ordinary keys concatenate self-delimiting indexed-field sort bytes and the
  developer-ID string sort key. Missing differs from null. Keep full keys, their
  SHA-256, 2500-byte prefix and optional suffix; no inherited 2KiB cap.
- Translate the complete long-prefix buffered/reordered scan with exact-timestamp
  document hydration, snapshot-specific metadata and retention validation.
  Initial retain-all history stages deletion safely; it does not implement GC.
  The initial physical reader verifies retention floors in SQL around reads.
  Convex leader retention validation uses local bounds (retention.rs); translate
  that owner and its GC/fencing protocol before claiming the final hot path.
  These conservative SQL checks are temporary scaffolding, not a justified
  permanent deviation or evidence that read overhead has been removed.
- Reuse finite in-flight refusal, closed graph and consume-once semantics; replace
  the SQL-shaped downstream handoff with finalized transaction state and separate
  profile evidence. No resolved SQL targets, row-intent codecs or materializer
  callbacks enter the portable final record.
- Preserve auth/grant-before-outcome-disclosure. The grant signs program/schema/
  request/revocation, not a snapshot. Persist the logical claim before selecting
  the body snapshot, then retain the exact signed program/manifest identity.
  The body snapshot owns its active table validators and indexes, as in Convex;
  signed schema identity does not authorize writes under an obsolete validator.
  Claim, body, outcome discovery and cold replay use the same trusted target.
- Pack schema/validator payloads, program metadata and replay results through
  their existing canonical JSON/value owners, matching the source serialized
  payload mechanism. Payload nesting budgets remain separate from the shallow
  containing document; its 32 MiB/private and depth-16 limits still apply.
  Mutation arguments retain their general-value profile and existing argument
  budget instead of inheriting stored-document limits.
- Private catalog, claim/outcome and required event records use shared documents
  and indexes. Outcome-only commits are real writes and reconstruct progress.
  Bootstrap must be noncircular and fenced before admitting snapshots.
- Implement committed-log prevalidation plus residual-suffix/all-pending checks,
  indexed pending keys, bounded batch work and ordered publication. A temporary
  save concurrency of one is a removable configuration bound; it does not close
  overlapping-save, group-uncertainty or complete-goal performance gates.
- Entry-fixed function/schema metadata replaces unrelated immutable-head
  reselection. Real grant/scope revocation, credentials, deadlines, ownership and
  history eligibility retain their actual enforcing owners and writer closure.

Transaction state also needs the [operation exclusion adaptation](../divergences/transaction-operation-exclusion.md)
that translates Rust exclusive mutable access across asynchronous reads.

## Coordinated ownership

- Codec owner: new flarex-protocol/src/document-id.ts, document-value.ts,
  index-key.ts and paired source-derived vector tests. Reuse verified scalar/byte
  primitives; preserve upstream source/license provenance for copied code.
- Portable engine owner: new persistence-postgres/src/core/ contract, transaction,
  snapshot/registry, write-log, committer and private bootstrap owners, plus their
  focused tests. No SQL, Cloudflare or old materializer/session imports.
- Physical owner: new database/schema/corePersistence.ts and
  database/corePersistence/ modules, plus test/core persistence fixtures/scenarios.
  Own fully qualified five-table Drizzle/SQL, leases, globals, exact reads and
  atomic writes. Existing driver lifetime primitives are audited reuse candidates.
- Consumer owner: Standard ApplicationMutationSystem and new selected-target fixture (test/application/applicationCoreMutationFixture.ts)
  and existing harness/query construction,
  artifactRuntime/ApplicationWorkerCore emitted runtime and generated refresh,
  finite close/finalize integration and the
  matching system-test entries. The old source-bundle fixture supplies an optional
  probe through its existing generator; its default source is unchanged.
  New selected-target calls cannot secretly use
  finitePublication, appRows, independent membership hydration or old outcomes.
- Coordinator: this contract, shared package exports/manifests and integration;
  sequence any overlapping changes and preserve unrelated shared work.

The portable engine owner publishes its exact typed persistence/caller contracts
before dependent workers wire implementations. Responsibilities do not imply a
new package, service registry or transaction per module. Unsupported capabilities
fail closed; the first users graph requires no native decimal/relation extension.

## Required proof and removal gates

Run PGlite and ordinary-role PostgreSQL separately: atomic document/index/private
outcome rollback, same-key body rewrite, moves/deletes/absence, both scan directions
and long-prefix pagination, source-revision backfill, snapshot metadata, interrupted
bootstrap, stale/read-only lease races, outcome-only replay/cold reconstruction,
unknown acknowledgement and same IDs in distinct instances. Prove real Standard
nested Worker mutation/replay and sticky failure through the new owner, including
closed/foreign/fabricated finalization refusal and cold historical reads.

Prevalidation races and accepted unsaved conflicts need controlled persistence
pauses. Before overlap activation additionally prove B saved before A, hidden
unpublished B, sparse successful survival and every in-flight/grouped outcome
reconciled without repeating native effects. Required reviews/lint/typechecks,
actual owner/consumer regressions and resource cleanup remain goal gates.
A standalone kernel or new final-record facade does not complete this slice.
The connected implementation does not establish full app-DO support or measured
performance. Staged schema validation, populated migrations, index builders and
history GC remain required later work under the full goal.
