# Shared Transaction Core

## Status And Scope

Status: active redesign tracking; accepted ownership direction, partial
implementation, ownership audit complete and R1 physical ownership implemented. The
shared publication and framework recovery extraction is complete for its bounded contract. That does
not establish that every boundary in the accepted design has been reconciled.

This domain tracks core transaction, publication and recovery ownership across
Application, Payload/CMS and Medusa/commerce; remaining ownership work;
replacement and cleanup obligations; and performance and completion gates.
Creating this roadmap does not authorize an additional implementation slice.

Framework feature admission and upstream compatibility remain in
[framework integration](../flarexdb-framework-integration/README.md). Native
OCC remains owned by the [foundation](../flarexdb-foundation/02-occ-and-transactions.md).
This roadmap coordinates changes to those owners rather than replacing their
contracts. General mixed OCC, named atomic composition, durable domain events,
public APIs and production activation retain separate decisions and gates.

## Current Sources Of Truth

- [Accepted transaction ownership](../../design-notes/flarex-db-accepted-design.md#shared-framework-transaction-ownership)
  and [framework storage architecture](../../design-notes/flarexdb-framework-storage-architecture.md)
  own cross-domain architecture and trust boundaries.
- [Shared-owner design](../../design-notes/flarexdb-commerce-occ-migration-preflight.md)
  distinguishes default consolidation from optional execution changes.
- [Execution profiles](../flarexdb-framework-integration/preflight/14-transaction-execution-profiles.md)
  and the [framework transaction contract](../flarexdb-framework-integration/04-transactions-and-commit-publication.md)
  own admitted framework participation and compatibility.
- [Record 36](../flarexdb-framework-integration/preflight/36-shared-publication-and-request-recovery.md)
  defines the completed extraction's exact scope and retained boundaries.
- The [ownership audit](./01-ownership-audit.md) links current code and decisive
  tests. Code, schemas and tests establish exact behavior; this index tracks
  redesign status. Git owns chronological implementation and verification records.

## Current Architecture

Native Application execution records exact reads and logical writes, validates
OCC and enters its existing materialization/publication transaction. CMS and
commerce use the shared relational session and bounded request lifetime while
retaining their admitted SQL execution profiles. Artifact control and relational
sessions compose one [neutral physical owner](../../packages/persistence-postgres/src/physicalSession/postgres.ts),
with owner-supplied schema views and error projections.

One source-private publisher supplies common publication mechanics. Commerce
finalization is a trusted commerce participant. CMS still authenticates and
materializes its pending native documents through the native commit module.
The framework hosts share uncertain-outcome routing and retain fresh authority,
binding, outcome lookup and participant-specific completion checks.

## Invariants And Trust Boundaries

- Core owns common settlement, publication and recovery guarantees. Framework
  adapters retain lifecycle, repository, admission and error semantics.
- Sandbox code receives restricted capabilities, never a raw database handle.
  A SQL transaction cannot span untrusted execution or external effects.
- Preserve exact native OCC dependencies and history, current lock order,
  scope/generation fencing, rollback-only nesting, cancellation and cleanup.
- Publish complete admitted facts, retained outcome and wake atomically under
  the existing owner. A publication prefix is not a commit acknowledgement.
- Uncertain settlement permits authoritative reconciliation under its contract,
  not blind replay of framework callbacks or ambiguous local events.
- Independently committed framework calls cannot silently join an atomic
  native mutation. Adapter folder names and structural types grant no authority.

## Decisions And Rationale

Shared guarantees and distinct execution profiles are the accepted destination.
The earlier proposal to require all frameworks to adopt tracked native OCC is
superseded as the default direction. Sharing infrastructure does not require
one callback interpreter or one public parameterized transaction API.

The completed audit identifies two ownership replacements. R1 removes the
framework physical resource dependency on artifact control. CMS orchestration
still lives in native commit; R2 in the [implementation proposal](./04-implementation-proposal.md)
separates that owner while preserving shared lowering and execution policies.
Existing code alone is not a compatibility obligation.

## Convex Compatibility And Flarex Divergences

Preserve the accepted Convex-inspired native snapshot, dependency validation,
atomic commit and authoritative outcome model. Trusted Payload and Medusa
commands deliberately retain bounded SQL profiles to preserve their admitted
lifecycle and repository semantics. Sandbox isolation alone does not require
replaying those commands through native OCC. The accepted execution-profile
record owns the pinned source comparison and divergence rationale.

## Implemented Capabilities

The shared relational session and bounded request lifetime predate the latest
extraction. Record 36 supplies one common publication implementation, a trusted
commerce finalization participant, shared framework uncertain-outcome routing,
and removal of the displaced implementations. The CMS materialization bridge
remains intentional within that completed slice. R1 additionally supplies the
neutral physical resource owner and removes the displaced artifact-owned
mechanics; artifact control retains its schema, decisions and exact error types.

## Known Gaps And Limitations

The audit and R1 neutral physical resource ownership are complete. R2 CMS
participant/shared Application materialization remains proposed and awaits
implementation approval. Its current coupling is an ownership gap, not an
observed atomicity failure. Other audited boundaries have explicit retention or
independent-capability dispositions.

Representative command, contention and mixed native/framework load measurements
remain outstanding. Existing test deadlines must be evaluated with setup and
environment contention distinguished from command cost. No throughput or
production-readiness claim follows from identical SQL or passing unit tests.

No schema was superseded by record 36. A deployed-catalog and durable-data
inventory is required before any future physical deletion is selected.

## Target Direction

Every common guarantee has an explicit owner; each framework participates
through narrow authenticated boundaries; every retained bridge has a reason;
and every selected replacement ends with removal of obsolete code and state.
The remaining implementation is R2 in the proposal, followed by measured
validation. Neither ownership replacement requires DDL.

## Next Correctness Gates

| Workstream | Current status | Observable exit |
| --- | --- | --- |
| Common publication and framework recovery extraction | Complete within record 36 | All current callers use the extracted owners; displaced implementations removed |
| [Ownership completion audit](./01-ownership-audit.md) | Complete for currently admitted source paths | Every responsibility and boundary classified with evidence, target owner and disposition |
| [R1 physical resource ownership](./04-implementation-proposal.md#r1-neutral-physical-resource-owner) | Implemented; bounded conformance proven | Relational and artifact consumers use neutral mechanics; displaced control-owned mechanics removed |
| [R2 CMS participant/materialization](./04-implementation-proposal.md#r2-cms-participant-and-application-materialization) | Proposed; next implementation approval | CMS orchestration leaves native OCC; both participants use one shared materializer; displaced paths removed |
| [Replacement and cleanup](./02-migration-and-cleanup.md) | R1 logic cleanup complete; R2 deletion set defined; no DDL | Each approved replacement completes its consumer switch and logic cleanup; retained state justified |
| [Performance and conformance](./03-validation-and-completion.md) | Focused extraction proof exists; broader measurement pending | Representative costs and concurrency meet explicit criteria; affected semantics preserved |
| Overall redesign reconciliation | Open | All required audit findings resolved; retained boundaries justified; independent capabilities explicitly deferred |

The next implementation is R2 after approval of its concrete proposal.
Representative measured validation remains open. Product scale remains in
[record 35](../flarexdb-framework-integration/preflight/35-medusa-product-scale.md);
it neither substitutes for this audit nor automatically depends on finishing
every separately gated capability. Update this table in place as durable status
changes; keep execution logs and test receipts outside the living roadmap.
