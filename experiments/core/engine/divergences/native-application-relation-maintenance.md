# Native writers maintain Application relations

Status: **Three-way source challenge and peer exchange complete / Bounded
source-CMS replacement implemented / Unmeasured**.
The [source CMS slice](../slices/04c3b-source-cms-relation-maintenance.md)
owns the exact contract and proof gates.

## Pinned mechanism and necessary difference

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`,
`Transaction::apply_validated_write` atomically applies row, index and schema
registry changes for every supported writer; unchanged index/schema validity
depends on that maintenance. Inspect
[transaction application](../../../../../../crates/database/src/transaction.rs)
and [index updates](../../../../../../crates/indexing/src/index_registry.rs).

Convex has no corresponding Payload native lifecycle or our live foreign-row,
incoming-edge and target-delete protocol. Its
[ID validator](../../../../../../crates/common/src/schemas/validator.rs)
checks encoded table identity. Flarex must additionally carry genuine Application
relation authority across its separately admitted native source profile.

## How the replacement differs

Retain the original binding's complete genuine relation port/definitions inside
the existing source CMS preparation lifetime. Existing core materialization
performs the target checks and row/edge/adjacency maintenance atomically under
the existing single CMS publisher. Application relation authority keeps its own
schema identity; existing per-table source schema mapping preserves the distinct
logical row/index/unique provenance. Authenticated relation-free variants remain
supported; foreign or failed relation loans never become absence.

Existing native transaction admission already holds the checked active head and
scope lifecycle locks through bounded business work and finalization. Preserve
that protection rather than adding another transaction/current-head policy.
Payload retains native behavior and receives no raw SQL or settlement authority.
Native commands do not become replayable Application OCC mutations.

The executing owners are
[`lendApplicationBindingRelations`](../../../../packages/persistence-postgres/src/application/activation/bindingPreparation.ts),
[`prepareSourceCmsDocumentMaterialization`](../../../../packages/persistence-postgres/src/frameworks/cmsTransaction/contribution.ts)
and the original binding handoff in the
[CMS host](../../../../packages/persistence-postgres/src/frameworks/cmsTransaction/host.ts).
[`LogicalDocumentSourcePreparation.requireControlDatabase`](../../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/documentAdmission.ts)
checks the original frozen source ports without exporting a database. Existing
logical materialization and CMS publication still own all row/edge/fact/outcome
settlement. The native source scenario exercises that actual chain.

## Data, costs and remaining limits

This replaces missing maintenance for the admitted standalone source CMS path;
mixed Application roots and full-proof CMS already use the shared relation owner.
No durable format change or deletion is selected. Correct future writes alone
cannot certify previously missed sidecars; historical coverage/repair remains a
gate before maintained-readiness reuse. Normal target validation and edge updates
are required work, not an optional cache cost. No throughput or complete-request
performance result is claimed. Runtime, database, recovery and native consumer
proof remain open until the slice records actual implementation.
