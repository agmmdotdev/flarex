# Schema model and document ID reuse

Scope: per-transaction schema-model construction and the shared v6 ID codec,
proved through the existing Product creation workflow. Baseline `e499353dc`.
Source pin `db914cf06e2b06ee985646611b9e12ed7a770318`.

Status: implemented with local Product measurement. The selected replacement
reuses one transaction-owned schema model and issues branded IDs from the
existing canonical proof. Full native and deployed-host performance gates
remain with the [core goal](../GOAL.md).

The independent schema and ID challenges inspected executing owners, the
accepted transaction boundary and pinned Convex. Peer exchange resolved two
boundaries. The schema model reads the transaction's live registry through
accessors, so reuse the model within that transaction and run every existing
enforcement operation. A raw string must still pass canonical decoding before
receiving a developer ID brand. An apparent typed-array length is insufficient
to justify fixed-width encoding because a caller can shadow that property.

| Responsibility | Pinned mechanism | Selected replacement and witness |
| --- | --- | --- |
| Document schema enforcement | `database/src/bootstrap_model/schema/mod.rs::SchemaModel::new` borrows a transaction and namespace | Retain one lazily constructed model in the existing Core transaction. Its reads, failure order and validation writes still run for each document. Exercise schema models, live application upgrades and native Product workflows. |
| V6 encoding and decoding | `value/src/id_v6.rs` uses bounded scratch storage and a canonical re-encode comparison | Replace byte property definitions with fixed typed byte storage. Issue the brand from the already validated canonical representation. Check source vectors, malformed IDs, byte ownership, and poisoned same-realm intrinsics. Refresh the affected generated Worker kernels. |

Keep table selection live, retain active/staged/proposed validation order and
preserve the transaction's dependencies, rollback and publication. Keep ID
format, checksum, canonicality, table/authority separation and old-ID
normalization. A branded string never proves that its row or table is usable.
No storage migration is needed because persisted IDs and encodings are identical.

Representation adaptations are recorded in [schema-model reuse](../divergences/transaction-schema-model-reuse.md)
and [document ID buffers](../divergences/document-id-typed-buffers.md).
