# Maintained Application relation readiness

Status: **Pinned source and independent challenge complete / Connected owner
replacement not started / Unmeasured**. The
[slice contract](../slices/04c3a-maintained-relation-readiness.md) owns prerequisites
and remaining decisions. This record does not accept weaker relation guarantees.

## Pinned mechanism

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`,
`SchemaModel::submit_pending` reuses the exact current active schema document,
and `IndexModel::identical_or_replaced` preserves an identical current physical
index identity. Actual deployment separately checks current index eligibility.
Atomic write/index/schema maintenance and transactional metadata dependencies
preserve validity after the original build frontier. Historical overwritten
schema validity is not resurrected.

Inspect [schema](../../../../../../crates/database/src/bootstrap_model/schema/mod.rs),
[indexes](../../../../../../crates/database/src/bootstrap_model/index.rs),
[transaction application](../../../../../../crates/database/src/transaction.rs),
[index maintenance](../../../../../../crates/indexing/src/index_registry.rs),
and [deployment](../../../../../../crates/application/src/deploy_config.rs)
before implementation. These are source-grounded findings, not an upstream test
pass.

## Why a difference is necessary

Flarex Application relations additionally enforce live foreign-row existence,
incoming membership and target-delete restrictions. Convex
[ID validation](../../../../../../crates/common/src/schemas/validator.rs)
checks encoded table identity and does not supply this protocol. Our canonical
readiness roots and physical/semantic child receipts also have their own durable
correlation and provenance. Current schema equality cannot replace these owners.

## Intended adaptation and guarantees

Follow Convex's maintained current identity rather than rebuilding an unchanged
serving index at every commit frontier. The existing private serving/readiness
owners must authenticate the exact current active root, full canonical child set,
historical lineage and current enabled physical attempt/authority. A derived new
revision keeps the truthful original relation frontier. Final activation checks
the genuine reference again and retains all fresh candidate, ordinary-index,
unique, ownership and execution-authority gates.

Every relevant writer must atomically maintain the sidecars. Application and
full-proof CMS already used that owner; the bounded
[source-bound standalone V3 Payload replacement](./native-application-relation-maintenance.md)
now carries its genuine relation preparation/materialization handoff. This is a
core correction, not adapter SQL or a permanent profile exclusion. Mixed-root
maintenance alone did not prove standalone publication, and correct future
writes do not prove historical sidecar coverage or repair.

Changed semantics and rollback require fresh current-data validation. The exact
provenance and bounded receipt contract for revalidating an original `create`
schema after another schema served remain open. Neither an old semantic receipt,
an active-schema ID alone, nor globally relaxed frontier comparisons are selected.

## Consumers, durable data and costs

The affected consumers are Application deployment/readiness and Standard relation
mutations, plus supported native writers sharing their bound endpoint tables.
No historical outcomes, journals or readiness rows are deleted by this record.
Any new provenance format needs an explicit durable compatibility disposition.
The same-current path should retain physical identity and avoid a fresh semantic
scan when maintenance is proven; changed/rollback validation retains its scan and
lifecycle costs. No complete-request performance or deployment-scale result is
claimed.
