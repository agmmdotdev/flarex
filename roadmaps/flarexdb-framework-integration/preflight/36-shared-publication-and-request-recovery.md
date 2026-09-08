# Shared Publication And Framework Request Recovery

## Status And Scope

Implemented as a private ownership refactor. Native Application commits and
admitted CMS and commerce commands use the same source-private publication
mechanics. CMS and commerce share uncertain-outcome routing while retaining
their domain errors, admission and completion obligations.

This contract preserves native journal/OCC execution and the frameworks'
bounded SQL execution profile. It introduces no schema, migration, package
export, public API, mixed-domain atomic command or callback retry policy.
Product scale remains separately gated by [record 35](./35-medusa-product-scale.md).

This record closes only its bounded extraction. The
[shared transaction core roadmap](../../shared-transaction-core/README.md)
tracks broader ownership reconciliation, retained boundaries, remaining
replacement/cleanup decisions and performance gates. Its completion audit
remains open; this record does not establish whole-redesign completion.

## Owners And Authority

`commitPublication/publication.ts` owns database publication time, sequence
allocation, commit header and admitted change-family writes, retained result,
transactional wake and final scope-clock advancement. Its narrow model is in
`commitPublication/scopePublicationModel.ts`. These are internal persistence
operations, not adapter-facing capabilities or a generic participant registry.
Authenticated participants retain responsibility for admission, complete facts
and their transaction-bound evidence. Structural contribution types do not
grant mutation authority.

`commerceTransaction/publication.ts` owns commerce finalization: authenticate
admission, consume the authentic closed row set once, lower relational facts,
and complete any admitted initialization. It uses the common publication
owner without depending on the native point-commit module.

`pointCommitTransaction.ts` retains native OCC, native finalization and the CMS
materialization bridge. CMS preparation and closure authentication, native
row/index/unique/relation lowering, receipt checks and preference facts remain
there. Moving that complete subsystem is a separate decomposition; these
remaining operations are not a second common publisher.

`relationalTransaction/session.ts` continues to own framework physical
settlement. `boundedRequestLifetime.ts` continues to own the shared bounded
request lifecycle. No new connection, runtime or transaction owner is added.

## Publication Invariants

All steps remain inside the existing owning transaction, with the existing
scope-clock and framework lock order. The common prefix writes the admitted
header, change families, retained outcome and wake before participant-specific
completion and the final clock advancement:

| Participant | Work between the common prefix and clock advancement |
| --- | --- |
| Native | Journal/lease cleanup and committed session transition |
| CMS | Exact preference-deletion facts |
| Commerce | Initialization evidence, when the admitted command requires it |

The prefix is not a successful settlement acknowledgement. Failure in any
remaining step rolls back the prefix and business state together. Existing
fault checkpoints, ordinals, identities, canonical bytes, SQL batching and
retention obligations remain unchanged.

The shared publisher uses domain-neutral internal failures. Native projections
restore the established point-commit corruption, resource and SQL failure
classes and passthrough discrimination; CMS retains its existing projection
through that bridge. Commerce retains its resource and statement failure
classifications. The Promise/Drizzle rollback boundary remains deliberate;
projection of a typed publication failure does not create a nested Effect
runtime or replace scoped cancellation/cleanup ownership.

## Recovery Invariants

`relationalTransaction/requestRecovery.ts` owns one shared Effect operation.
It projects the complete initial cause and performs one recovery-only re-entry
only for a keyed request with exactly one ordinary failure classified by its
participant as an uncertain transaction decision. It never retries business
execution. Defects, interruption, composite failures and unkeyed requests
retain their complete causes without recovery.

Each host retains fresh authority/binding checks, stored-outcome lookup and
refusal when no outcome exists. If recovery fails, the initial and recovery
causes are combined in that order. Commerce discards its ambiguous local event
buffer before recovery, including when another identical request supplied the
retained result. Post-acknowledgement local delivery remains commerce-owned;
this does not admit durable domain-event dispatch.

## Cleanup And Remaining Gates

The displaced common publication implementations, native-owned commerce
finalizer and duplicated host recovery branches are removed. Native error
projection wrappers remain because they preserve the established boundary.
There is one implementation of each extracted mechanic and all current
participants use it.

No table is superseded by this slice. Native journals, framework installation
and initialization data, relational facts and preference facts retain their
consumers and retention duties. Any later persisted-contract replacement must
carry reader/compactor migration, validation and obsolete-table/code removal
as explicit completion work.

Sharing publication does not make arbitrary Payload hooks or Medusa workflows
replayable native OCC callbacks. Named atomic composition, general mixed OCC,
scope-lock throughput changes, durable event delivery and broader framework
profiles retain their separate admission and conformance gates. The extraction
adds no SQL statements or transaction boundary; representative throughput and
contention claims still require a separate benchmark.
