# Translate finalized operations and versioned persistence

Reference upgrade: the active pin is now `db914cf06e2b06ee985646611b9e12ed7a770318`; see
[the upgrade assessment](../CONVEX-REFERENCE-UPGRADE.md). The original source challenge and
implementation evidence below retain their old pin and are not new-pin
conformance. Revalidate affected contracts before dispatching runtime work.

Current dispatch: the [fresh Application cutover](./06a-application-persistence-cutover.md)
completed its independent db914cf06 challenge and peer exchange; connected
fresh-target implementation is in place. The wider slice remains open. The original
preparation checkpoint below retains its old source identity and proof limits.

Original preparation status: **Independent current-core, accepted-direction and pinned-Convex
challenge plus peer exchange complete; connected contract preparation selected;
runtime replacement unstarted**. Concrete caller/data conversion and native
enforcement contracts below remain prerequisites before dispatching runtime
workers. This record does not activate a schema or claim completion.

## Authority and outcome

Follow the [accepted translation plan](../REFACTOR.md#core-and-physical-schema-translation-plan),
[goal](../GOAL.md), [five-table persistence baseline](../../../../design-notes/flarexdb-shared-logical-storage.md#five-table-physical-starting-point)
and [shared schema lifecycle](../../../../design-notes/flarexdb-shared-schema-lifecycle.md).
The destination is the current packages/apps, not another experimental engine.
Reference Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`; the source challenge
also checked the current Flarex working graph and accepted baseline `cad83d21a`.
The pin identifies Git source objects. Local source links below are navigation:
if the enclosing Convex checkout moves, inspect `git show <pin>:<path>` rather
than treating its current `HEAD` as this reference.

Replace the executing chain:

```text
closed Application or native operation
  -> immutable finalized transaction and profile-owned settlement evidence
  -> shared acceptance and document/index changes
  -> fenced atomic five-table persistence
  -> safe publication and timestamp-correct historical reads
```

The target physical families are `documents`, `indexes`, `leases`, `read_only`
and `persistence_globals`, with the pinned shared PostgreSQL access paths.
Private catalog, schema, build/activation, migration, outcome/event, claim and
relation state defaults to logical documents and indexes. Existing physical
families are conversion inputs or explicitly named transitional consumers,
not permanent batch extensions. An additional family requires a demonstrated
DO/native need and its own [divergence record](../divergences/README.md).

This is a connected replacement of transaction/persistence responsibilities.
Changing DDL alone or wrapping the current SQL command engine does not achieve
it. Internal interfaces, installers and adapter choreography may change; preserve
required behavior, trust, identities, durable outcomes and named data.

## Source challenge and resolved disagreements

Independent agents inspected current executing owners, the accepted direction
and actual pinned Convex owners, then exchanged counterexamples. They converged
on the shared batch/read boundary with these corrections:

- A temporary save concurrency of one can stage the physical cutover. It is
  migration sequencing, not a permanent divergence or completion of the accepted
  overlapping-save architecture. Name its owner and removal gate.
- Serialization does not make current projections snapshot-correct. An operation
  fixed at `S` needs history even if another operation publishes serially at
  `S+1`. Filtering a latest pointer by timestamp cannot recover its overwritten
  predecessor. Retained native transaction-bound profiles must be named; do not
  silently advertise fixed-snapshot support for them.
- Finalization and metadata-at-snapshot semantics belong in the first contract.
  Full RAM registry structures may stage, but current live epoch checks alone
  are not the versioned catalog owner.
- The pin supports any subset of independent pending saves surviving a crash.
  It does not require a dense sequence of successful assigned timestamps.
- Outcome/event-only publications require durable discovery in the first
  cutover, including while saving remains serial. Private versioned records are
  the closest pinned mechanism; keeping old physical outcome/event tables is
  not the default alternative under the five-table target.
- A built index entry uses the source document revision timestamp. Its index
  definition need not have existed at that earlier timestamp; availability is
  resolved at the reading operation's snapshot.

## Current owner to pinned mechanism

| Current owner | Pinned mechanism and treatment |
| --- | --- |
| `finiteRoot`, `rootEvaluator`, `freezeClosedRoot`, native closure handoffs | Reuse audited closed-operation, first-original/final-write, exact dependency and accounting semantics. Replace the SQL-shaped frozen handoff with finalized transaction state and separate profile settlement evidence. |
| `finitePublication`, `durablePublication`, `acceptApplicationPublication`, logical materialization | Replace acceptance/materialization choreography through the shared transaction and atomic persistence owners. Preserve fencing, authentication, outcomes, native contributions and singular settlement. |
| `appRows`, `appIndexEntries`, Application query snapshots and finite/native ordinary-index readers | Replace independent membership/body hydration with versioned point lookup and exact index/document timestamp hydration. Remove migrated membership-head/no-op proofs. |
| Catalog admission/definitions/readiness and Application/framework activation | Translate engine meaning into private logical records and versioned registries with trusted bootstrap. Preserve genuine external deployment/artifact and split-placement authority. A1/A2's proposed normalized layout is not the destination. |
| Commit facts/feed, outcomes/events, cache refresh and compaction | Preserve their real delivery/recovery/history duties through common logs and private records; remove displaced duplicate directories and physical families after their consumers migrate. Reuse interval coverage/cache algorithms. |

The actual Standard caller already executes finite local state and freezes it
for settlement. Do not recreate that frontend or assert every syscall still
requires a durable receipt. The replacement must change the shared downstream
owner, not merely add another frontend API.

## Transaction, batch and reads

One operation owns a fixed committed snapshot, exact point/range/metadata reads,
first committed original and final pending documents, per-call accounting and
closed nested/lifecycle state. Finalization excludes in-flight work and transfers
immutable state; it cannot leave mutable request-owned state available to the
committer. Native outer owners retain their own effect/replay/rollback meaning;
sharing persistence does not establish one universal transaction API.

Derive durable ordinary-index changes from coalesced original/final documents:
old-key tombstones followed by final live positions, including unchanged keys.
The live position and document share the commit timestamp. Preserve full encoded
key ordering and document-ID tie-breakers, long-key handling, scope confinement,
exact values and deletion history. Snapshot-selected catalog dependencies must
justify interpreting a finalized write against accepted metadata.

An atomic batch includes required private request/outcome/event records as well
as application records. A no-app-row mutation with a durable outcome is not an
empty transaction. Events without a request outcome need their own discoverable
private record. Durable maximum discovery includes system documents; retention
cannot remove the sole progress witness before the necessary repeatable bound
is safely persisted. `persistence_globals` remains the small persistence
bootstrap/checkpoint owner, not a second catalog or workflow store.

Ordinary-index reads resolve enabled metadata at the operation snapshot, select
the eligible index revision, and hydrate its exact document timestamp. Existing
history cannot simply be relabeled: reconstruct required retained live index
versions from document history or select an explicit supported cutover floor
with the named-data/reader disposition. No implicit history loss is authorized.

## Bootstrap, builds and retention

Translate the pin's noncircular bootstrap: trusted built-in system definitions
and reserved identities, small persistence anchors for table/index discovery,
then private table/index documents and registry reconstruction. Framework or
Task installation cannot be needed to interpret the catalog that installs it.
Prove interrupted initialization, replay, write-disable enforcement and ownership
replacement through the actual persistence fence.

Initial logical installation/replay, required readiness and activation join the
selected consumer. Empty-table enablement may be bounded; a populated index
requires a real backfill/concurrent-write contract. Online updates maintain
registered ordinary indexes while Backfilling. Backfill entries retain source
document revision timestamps, so an older write cannot replace a newer version.
Retention/build completion must preserve exact hydration anchors and resumability.
General populated-data evolution remains at its existing sequencing owner.

## Writer and reader closure

Inventory and migrate every writer of each replaced family, including:

- Finite and retained durable Application publication.
- Standalone/borrowed CMS, including source-bound CMS; logical/atomic commerce;
  cross-domain commands; the checkpointed system-source writer if retained or
  activated through the translated owner. Its current experiment is not a
  completed Task integration or a permanent API requirement.
- Intrinsic/ordinary index builders, strong-reference maintenance and repairs.
- Outcome/event/feed delivery, cache reconstruction and historical compaction.

Private logical claims and relations must preserve supported uniqueness,
endpoint/deletion policies and exact-value behavior through shared dependencies
and acceptance. Their representation alone supplies no enforcement. Distinguish
authoritative acceptance checks from data disclosed to a reader at `S`.
Search/JSON and other native current projections need their actual profile and
historical replacement named before their fixed-snapshot cutover. Do not use
an unrelated unavailable feature to block a correctly bounded consumer; do not
leave a writer updating the displaced representation behind the new reader.

For each retained path, name its consumer/data, current authority, why it cannot
yet move, prerequisite and removal gate. Activated callers use one authoritative
representation; no compatibility facade or dual-write fallback merely to retain
old internals. Platform physical upgrades, logical installation/evolution and
producer-defined conversions retain separate duties within the shared lifecycle.

## Save order and recovery handoff

The final target retains committed plus accepted-pending conflict checks,
bounded overlapping saves and ordered normal publication/acknowledgement.
Operation B executes at the published snapshot, not A's unsaved snapshot. Its
first-original/`prev_ts` refers to its own committed document history, not the
preceding globally assigned commit. Dependencies and pending conflict checks
prevent B from relying on A's uncommitted engine state.

After uncertainty, fence/drain predecessor work, reconcile all in-flight durable
outcomes and reconstruct actual persisted data/metadata at a safe repeatable
timestamp. The pin derives that timestamp from durable document maximum and
the persistence repeatable bound under valid ownership. Do not fabricate missing
successful slots or raise the repeatable bound when an arbitrary later save
finishes. Normal ordered acknowledgement and raw durable outcome discovery have
distinct eligibility. The exact Flarex fencing/readiness protocol remains a
runtime prerequisite before overlapping saves are activated.

Temporary serial sequencing has a named follow-up: remove scope-clock save
serialization and dense feed/outcome/event/unique-owner assumptions together
with the pending-conflict, publication and bootstrap replacement. It does not
close that milestone or a throughput gate.

## Contract preparation and proof gates

The five target SQL names already exist in
[legacyPersistence.ts](../../../../packages/persistence-postgres/src/database/schema/legacyPersistence.ts)
with legacy deployment-keyed formats. They cannot be treated as compatible new
tables or overwritten by fresh-install DDL. Trace the existing
[document writer](../../../../packages/persistence-postgres/src/storage/documents/documents.ts),
[index writer](../../../../packages/persistence-postgres/src/storage/indexes/indexEntries.ts),
[commit owner](../../../../packages/persistence-postgres/src/commit/commits.ts)
and [runtime facade](../../../../packages/persistence-postgres/src/database/runtimePersistence.ts).
Distinguish their old `lease.ts` sequencer from the pinned persistence lease.
Those writers and actual proof seed/teardown callers need a common
cutover/exclusion contract.
An old helper export alone supplies no external compatibility obligation.
The separate Task schema/generation experiment is checkpointed and superseded
as a destination; its unimplemented lease-column/trigger proposal is not an
accepted migration or a second namespace authority.

Before runtime workers, record the actual first caller/writer closure, portable
finalized/batch contract, trusted private schema/bootstrap definitions, physical
name/namespace mapping and legacy-writer exclusion, logical native enforcement,
and exact retained-data conversion/removal plan. Reserve platform migrations
with the other active owners; do not mutate their in-flight schema/journal work.
The retained-attempt disposition remains with its existing owner, preserving
historical evidence and committed outcomes after reconciliation.

Preserve current duplicate-body, signed-program retry, nested-failure and native
effect/replay behavior unless the affected decision explicitly changes it.
These policies and lazy-key error timing are not automatic DO divergences.
Resolve an actual guarantee conflict at its owner, without preserving obstructing
internal interfaces or requiring unrelated future topics to be finished.

Required source-derived traces include same-key body changes; key moves and
deletes; missing/partial ranges; repeated writes and insert/delete accounting;
metadata races; accepted unsaved conflicts; old backfill racing newer updates;
late index installation over old documents; hydration after restart/compaction;
outcome/event-only recovery; identical identities in different scopes; stale
owners and unknown COMMIT. Before overlap activation, prove B saved before A,
cold misses excluding unpublished B, B surviving A's confirmed absence, and all
in-flight outcome reconciliation without repeating native effects.

The retained pinned tree supplies source and pause seams but no retained
executable transaction/committer/PostgreSQL tests for these cases. New tests are
source-derived conformance evidence, not claimed passing upstream tests. Run
actual owner/consumer checks, PGlite, ordinary-role PostgreSQL and required
Cloudflare-host proofs, reviews, cleanup and complete-request measurements.
Replication remains deferred.

## Pinned source owners

- [Transaction/FinalTransaction](../../../../../../crates/database/src/transaction.rs),
  [Writes](../../../../../../crates/database/src/writes.rs),
  [TransactionIndex](../../../../../../crates/database/src/transaction_index.rs).
- [Committer](../../../../../../crates/database/src/committer.rs),
  [WriteLog/PendingWrites](../../../../../../crates/database/src/write_log.rs),
  [database bootstrap](../../../../../../crates/database/src/database.rs),
  and persistence timestamp discovery in `crates/common/src/persistence.rs`
  at the recorded pin.
- [IndexRegistry](../../../../../../crates/indexing/src/index_registry.rs),
  [PostgreSQL writer/fence](../../../../../../crates/postgres/src/lib.rs),
  [SQL access paths and hydration](../../../../../../crates/postgres/src/sql.rs).
- [Index writer](../../../../../../crates/database/src/database_index_workers/index_writer.rs),
  [build/retention ordering](../../../../../../crates/database/src/database_index_workers/mod.rs),
  [private request outcomes](../../../../../../crates/model/src/session_requests/mod.rs).
