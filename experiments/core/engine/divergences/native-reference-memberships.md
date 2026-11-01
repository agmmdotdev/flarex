# Native many membership derivation

Status: **Selected derivation implemented with connected two-driver native,
policy, integrity and recovery proof; broader acceptance gates remain open.** Scope: the genuine fresh-install Payload many
and reverse-join profiles in [Native15](../slices/15-native-many-and-joins.md).
Convex pin: `db914cf06e2b06ee985646611b9e12ed7a770318`.

## Pinned mechanism

Convex arrays preserve ordered values in
[`value/array.rs`](../../../../../../crates/value/src/array.rs). Ordinary
[`IndexRegistry`](../../../../../../crates/indexing/src/index_registry.rs)
emits one old/new key per document/index, using object field traversal rather
than array membership or invented ordinal paths. Indexing an array indexes that
whole value; it is not a multikey index.

Source models explicitly maintain logical related records in the same transaction,
for example [cron jobs](../../../../../../crates/model/src/cron_jobs/mod.rs) and
[scheduled-job arguments](../../../../../../crates/model/src/scheduled_jobs/mod.rs).
[`SystemMetadataModel`](../../../../../../crates/database/src/bootstrap_model/system_metadata.rs)
allocates private IDs through the transaction generator and normal pending-document
path. [`Writes`](../../../../../../crates/database/src/writes.rs) separates bounded
system/user accounting. Source supplies ordinary indexes, pending state, suffix/
accepted-prefix validation, durability, publication and recovery; it has no
automatic Payload relationship projection or row-existence foreign key.

## Required native behavior

The admitted native profiles need ordered, distinct, bounded source arrays,
indexed incoming discovery and late target-liveness/restrict enforcement. Their
array order must survive reorder and forward population. Many membership cannot
be supplied by one ordinary scalar index on the source array. Retaining a separate
physical edge engine or changing ordinary indexing into multikey semantics would
depart further from the translation goal.

## Replacement

Keep each source array authoritative. The shared transaction owner eagerly derives
confined logical membership documents with scalar fields and ordinary indexes over
the same five physical tables. Native lowering authenticates their complete
private table/index role and identity through shared schema/build/activation and
cold reconstruction. Only many-capable definitions require these tables; no new
mandatory builtin changes unrelated scalar/optional-one bootstrap or frozen stores.

For the duplicate-free admitted profile, membership identity is declaration plus
source plus target. Match/diff existing private rows so reorder preserves allocated
child IDs; forward order remains source data, not child allocation or mutable
position identity. Use the existing trusted transaction generator and creation
clock. Private logical-record work is separately bounded and cannot consume or
expand the business-ID authority limit. Public/native capabilities do not expose
child CRUD, and no adapter owns projection SQL or a second settlement.

Public reverse reads hydrate/observe authentic source bodies and check returned
membership coherence. Late integrity reuses the existing native reference owner
without adding semantic target-body reads. Validate the complete published suffix,
accepted-unsaved prefix and final candidate, retaining actual contributing save
dependencies. Source, children, indexes and outcome settle atomically and recover
without rerunning native callbacks.

Completeness relies on fresh authenticated installation and sole all-writer
maintenance. Ordinary child-index backfill only indexes existing child documents;
it cannot fill an omitted projection. Returned malformed/orphan records refuse.
An empty reverse query cannot prove absence of arbitrary storage corruption, and
the adapter must not repair it through a scan or independent write.

## Costs, limits and required evidence

This adds logical child writes, index entries, retained revisions, bounded internal
reads and bytes. It does not add physical tables or change generic ordinary-index
semantics. Preserve the 32-target duplicate-free boundary, native root-read-only
join limits and separate business/internal accounting; repeated targets and
populated-many conversion remain outside this selected profile.

Required evidence includes genuine Local API and both join directions, stable
membership/reorder and declaration-distinct identities, correct source ordering,
pending whole-overlay behavior, late races versus genuine read conflicts, true
EOF/restrict and save dependencies, authority/accounting refusal, exact atomic
rows/indexes/outcomes, rollback/lost-ack/cold recovery and both database drivers.
Frozen scalar/optional-one identities and current consumers must stay valid.
The actual lowering/authentication owners are
[`makeCoreNativeDefinition`, `coreNativeStoredTables` and policy checks](../../../../packages/persistence-postgres/src/core/nativePolicy.ts),
the [private/system classification owner](../../../../packages/persistence-postgres/src/core/nativeTableAccess.ts),
and the existing [schema bundle](../../../../packages/persistence-postgres/src/core/schemaBundle.ts).
[`maintainNativeMemberships` and incoming traversal](../../../../packages/persistence-postgres/src/core/transaction.ts)
reuse ordinary staging, query and pending-index owners.
[`coreNativeManyTargets`/`readCoreNativeMembership`](../../../../packages/persistence-postgres/src/core/nativeReferenceProjection.ts)
own value/coherence interpretation;
[`prepareCoreNativeReferences`/`validateCoreNativeReferences`](../../../../packages/persistence-postgres/src/core/nativeReferences.ts)
extend late integrity and actual durability dependencies.

Selected paired owner/Local API scenarios cover stable membership and source
ordering, complete pending overlays, both integrity races versus real reads,
private closure/access/corruption refusal, separate business/system bounds,
atomic saves, genuine native cancellation and cold lost-ack replay. Native15's
bounded owner/consumer regressions are complete. This record does not establish native
Cloudflare hosting, arbitrary repeated memberships, conversion or performance.
