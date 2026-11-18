# Maintained Application relation readiness

Status: **Pinned source and independent peer challenge complete; A1/A2 owner
boundaries selected; runtime unstarted; complete-flow performance unmeasured**.
The [parent](../slices/04c3a-maintained-relation-readiness.md),
[A1 certification](../slices/04c3a1-serving-certification.md) and
[A2 maintenance continuation](../slices/04c3a2-maintenance-baseline-recovery.md)
own construction and proof gates.

## Pinned mechanism

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`, schema submission reuses
only the exact current active/pending/validated schema identity. Overwritten
validity does not certify rollback. Current index selection separately retains
actual matching physical identities; all registered indexes participate in
ordinary write maintenance, and table-index metadata dependencies fence writers
that began before registration. Backfill retains its real snapshot and cursor.

Inspected owners are [schema submission](../../../../../../crates/database/src/bootstrap_model/schema/mod.rs),
[index selection](../../../../../../crates/database/src/bootstrap_model/index.rs),
[index maintenance](../../../../../../crates/indexing/src/index_registry.rs),
[metadata write dependencies](../../../../../../crates/database/src/writes.rs),
and [backfill](../../../../../../crates/database/src/database_index_workers/mod.rs).
The forward revision-stream helper has no executing caller at the pin. No
upstream test run or live catch-up proof is claimed.

## Why Flarex needs an explicit certificate

Convex's encoded ID/table validation is not Flarex's live-target, version,
incoming-adjacency and native delete-integrity contract. Flarex also has immutable
readiness per revision, separately persisted physical/semantic receipts and a
historical gap in supported native writer maintenance. Today's corrected writer
cannot certify a past sidecar or missed R03 add/delete cycle.

Authenticate the exact current enabled physical attempt, scope authority and
historical lineage separately. Preserve physical S. New semantic codec-2
receipts distinguish evolution from serving certification and record actual
coverage U, retaining old codec-1 bytes/decoder. Evolution keeps its real origin
constraints; serving permits its own physical origin without inventing an
evolution predecessor. Use the existing active-head readiness commitment union
for genuine Legacy/relation/policy bases, not six fields with a manufactured
relation digest. This preserves the already admitted Legacy-to-R02 transition.

For authentic initial absence, the existing physical owner may certify the
complete exact target set at S = locked U; its build already validated sources,
live targets and versions. Cold reconstruction is enough, so no duplicate scan
or producer-age discriminator is added. Otherwise run the existing bounded
nondestructive semantic kernel at fixed U. A zero target set needs genuine
canonical completeness evidence rather than an inference from missing rows.

Before activation, new proof must still match current U and observed head.
Only an actually active certified baseline enables the cheap same-current
maintained bridge with its truthful historical children/frontier. Independent
index, unique, candidate, ownership and execution checks remain strict.
Historical physical-only roots are not certified by code age or schema equality.

## Fresh publication, final issuance and old reads

A readiness root cannot be replaced for an already-readied revision. Reuse real
source/schema contents through a new analysis registration, candidate and
inactive revision, then genuine relation publication/task registration. Do not
reuse an old candidate/analysis identity or fabricate changed source bytes.

Reuse the fold's existing in-transaction settle/insert/issue body and the
existing activation finalizer. A narrow prepared-fold/catalog handoff issues
and activates the fresh immutable root in the accepting transaction. Catalog
exclusion precedes authority/clock exclusion; colocated control uses the same
transaction, while separate control retains its actual outer catalog lease.
This avoids a write between separate settle/activation transactions stranding
a revision at an obsolete U. It introduces no second finalizer or public raw
transaction callback.

A genuine new baseline head fences prior incoming observations through the
existing activation sequence/head dependency check. Carry coverage U through
the actual incoming capability before data, cache or receipt exposure in journal,
Application query and CMS consumers. Refuse old snapshots; never retarget them.
Do not reconstruct historical commit headers or R03 children. Query-sync keeps
its existing head authority.

## Selected maintenance recovery

Ordinary nondestructive audit/deployment needs no maintenance or pending row.
Destructive serving repair, or an explicitly selected installer-spanning duty,
uses the real installation owner. Its process-local phase and replaceable job,
and an enabled physical build alone, cannot encode completed baseline activation.

Persist the smallest target-local per-scope duty before selected audit/cleanup:
scope primary key, fresh immutable target revision with restricting FK, and
nullable predecessor activation sequence/head digest present or absent together.
The exact tuple plus existing target publication is intent; reauthenticate its
scope authority. Extra mode/job/U/attempt or premature final-request hash is
unnecessary. Retain referenced publication/candidate data while pending.

Reuse bounded cleanup/build, actual maintenance target ownership, mechanical
settlement and the same activation finalizer. Derive the existing canonical
activation request after genuine readiness exists. Clear pending atomically
only with the exact new current head, certified root and floor. Historical
activation replay alone cannot clear it. Unknown settlement remains draining;
a successor reconciles before recapturing U or cleaning again. Every PG/PGlite
reopen/init gate must reject pending duties. No cross-database atomic clear or
counterfeit PGlite PostgreSQL token is selected.

## Consumers, data and costs

Affected consumers are required Application deployment/readiness and incoming
reads plus supported native writers sharing relation endpoints. Preserve native
business behavior, historical records and all independent authority gates.
Dangling targets fail validation; automatic business-data deletion/restoration
is not selected.

Certified current reuse avoids scans and retains physical identity. Fresh
rollback/current audit retains bounded scan/restart costs because inactive or
historically uncertified relation maintenance is not proven. Destructive repair
has actual drain/build/activation costs. These are explicit proof limits, not a
claim of busy-app deployment throughput or complete-flow capacity. Required
both-driver, concurrency, recovery, host, review and performance gates remain
open with the parent goal. Replication remains deferred.
