# Product Installation Reconstruction Cost

Status: shared-owner reconstruction correction implemented.
This supports the fresh Product schema capability in [record 26](./26-medusa-product-schema-and-relationships.md). It does not admit Product services, change runtime mutation authority or introduce database metadata tables.

## Problem And Owner

Ten Product models produce thirteen tables and an 85-step structural plan. The previous reconstruction path repeatedly measured, encoded, hashed and restored the same plan and its growing receipt/event graph. A shared database fixture alone cannot remove that repeated work. CPU sampling identified canonical reconstruction, repeated driver-row decoding and stack/span allocation in per-node helper calls.

The owner is the shared persistence migration coordinator and its relational physical-value verifier. Product remains an adapter-owned schema input. Increasing deadlines or skipping integrity checks is not the correction.

## Verification And Read Lifetimes

Each coordinator operation owns pure verification state. Exact owned bytes, digest and closed value kind must match before immutable canonical values can be reused. Retention is bounded to one plan of at most 8 MiB, 512 name assignments totaling at most 2 MiB, 512 immutable ledger frames totaling at most 2 MiB, and 4096 canonical captures totaling at most 4 MiB. Derived plan-sidecar projections belong to that same one-plan entry. Replacing the plan or settling the operation releases them; cancellation also clears state inherited by a child context. The driver callback bridge carries only this pure verification state.

Stored row projections, byte lengths, locators, assignment inventory and every sidecar column remain authenticated against actual SQL results. SQL exact-byte comparison avoids retransmitting a matching large plan, and exact ordered sidecar comparison avoids decoding the same redundant projections in JavaScript. An unmatched projection follows the original rejection path. Restored plans receive distinct step wrappers before authority registration; canonical-frame reuse cannot merge per-plan execution authority.

Database graph reuse remains confined to a read-only pass and its exact transaction, issued authority and validation policy. At most 512 successful references are retained. Reader-specific keys may omit diagnostic operation labels where they do not affect validation; failures remain uncached and preserve the current operation. Event-node reuse includes every detached root-row projection. Receipt closures and event predecessor checks still authenticate their complete dependencies and traversal bounds.

Event predecessor transport is batched in windows of 32. Known event receipt subjects are read by global digest in batches of 32, preserving missing/duplicate detection before full closure validation. Receipt dependency sidecars use a bounded attempt-level query with the original bounded fallback for larger inventories. No raw inventory or restored database reference survives a write.

Mutable heads, lease decisions, collision locks and compare-and-swap predicates remain fresh. Connected head/dependency preparation shares a read-only pass that settles before the guarded update; post-write restoration uses a new pass. No transaction-wide database cache or process-global verification cache is introduced.

Per-node memo lookup, peek and canonical-capture helpers use the installed Effect untraced helper because their stack allocation is a measured hot path. Repository operations retain named tracing and typed errors. Ordinary driver records avoid an exception-based Date probe; intrinsic validation still handles tagged, cross-realm and unusual Date objects without invoking tag getters.

## Acceptance And Reproduction

The complete Product harness uses one shared conformance body for PGlite and ordinary-role PostgreSQL. Installation and fresh-profile reopening must finish within its 90-second cancellable setup budget; incomplete setup skips dependent assertions. The original Vitest hook bound remains 120 seconds to permit settlement and cleanup.

Run the Product installation through its dedicated Vitest configuration. Set FLAREX_TEST_DRIVER to postgres and provide FLAREX_POSTGRES_DATABASE_URL for native PostgreSQL; the default is PGlite. FLAREX_PRODUCT_MEASURE_STEPS=1 selects the repeatable two-step measurement, and FLAREX_PRODUCT_TIMINGS=1 reports full-run batch timings. The measurement mode is not database acceptance.

Preservation includes changed bytes with an old digest, changed row/sidecar projections, strict resource bounds, cancellation, separate transactions, cold restoration, fresh-head/CAS behavior, and existing Currency/Payload canonical and runtime contracts. General Product service behavior and production/Cloudflare claims remain separate gates.
