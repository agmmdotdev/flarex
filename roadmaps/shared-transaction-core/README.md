# Shared Transaction Core

## Status And Scope

Status: ownership audit complete and R1/R2 ownership replacements implemented.
Shared publication and framework recovery extraction is complete for its bounded
contract. The private Currency + scalar CMS + Application command is
implemented with one shared lifetime and settlement. The separate private
[atomic commerce foundation](../workflow-foundations/09-atomic-composition.md)
extends that ownership to Product and Currency installations. Broader measured validation
and additional composition profiles remain open.

The authorized [transactional storage redesign](./07-transactional-storage-redesign.md)
starts with shared Application fact batching and native latest-receipt upserts.
Those statement reductions and the dedicated commit-keyed wake are implemented
without changing framework APIs. Obsolete core wake counter/clock projections
are removed. Floor observation now bounds live leases independently of expired
backlog. Journal roots retain one final syscall counter, and write events retain
canonical bytes/digest without a JSON mirror. Terminal sessions retain request
identity and fencing while clearing argument/grant/Application authority bodies
in the same transaction. Index/unique, row representation and remaining
execution-evidence replacements remain open.

The accepted [shared logical storage redesign](../shared-logical-storage/README.md)
now owns the next cross-consumer storage correction: generic physical families
for Application, Payload and Medusa, with independent logical schemas and no
per-deployment commerce table/index allocation. Core internals may be redesigned
rather than preserving unshipped contracts through adapter workarounds.

[Runtime scalability](./09-runtime-scalability-redesign.md) supplies operation
bounds, integrity, concurrency and workflow requirements within that replacement.
Begin with the GLS1 contract/baseline and GLS2/GLS3 connected generic storage
proof; do not first expand the displaced physical commerce model. Existing
locking and admission remain in force until their coordinated replacements are
proven. Each gate includes consumer migration, cleanup and roadmap reconciliation.

This domain tracks core transaction, publication and recovery ownership across
Application, Payload/CMS and Medusa/commerce; remaining ownership work;
replacement and cleanup obligations; and performance and completion gates.
Creating this roadmap does not authorize an additional implementation slice.

Framework feature admission and upstream compatibility remain in
[framework integration](../flarexdb-framework-integration/README.md). Native
OCC remains owned by the [foundation](../flarexdb-foundation/02-occ-and-transactions.md).
This roadmap coordinates changes to those owners rather than replacing their
contracts. General mixed OCC, additional composition profiles, durable domain events,
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
- The [transactional storage redesign](./07-transactional-storage-redesign.md)
  proposes clean replacement of redundant storage and per-operation work,
  with a physical inventory, source-derived costs, and Payload/Medusa API impact.
  Its status distinguishes implemented replacements from pending slices; it does
  not reopen completed R1/R2.

## Current Architecture

Native Application execution records exact reads and logical writes, validates
OCC and enters its existing materialization/publication transaction. CMS and
commerce use the shared relational session and bounded request lifetime while
retaining their admitted SQL execution profiles. Artifact control and relational
sessions compose one [neutral physical owner](../../packages/persistence-postgres/src/physicalSession/postgres.ts),
with owner-supplied schema views and error projections.

One source-private publisher supplies common publication mechanics. Commerce
finalization is a trusted commerce participant. The source-private
[CMS participant](../../packages/persistence-postgres/src/cmsTransaction/publication.ts)
authenticates pending closures and receipts, and shares one
[Application materializer](../../packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts)
with native commit. Native OCC no longer imports CMS lifecycle policy.
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

The completed audit required two ownership replacements. R1 removes the
framework physical resource dependency on artifact control. R2 separates CMS
orchestration from native commit while preserving shared lowering and execution
policies. The [replacement contract](./04-implementation-proposal.md) owns both boundaries.
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
and removal of the displaced implementations. R1 supplies the neutral physical
resource owner; artifact control retains its schema, decisions and exact error
types. R2 replaces the CMS bridge with a CMS participant and one shared
Application materializer. Native error contracts and the existing Promise
callback projections retain their separate source-private owners.

## Known Gaps And Limitations

The ownership audit and both required replacements are implemented. Other
audited boundaries have explicit retention or independent-capability
dispositions. The shared materializer retains the existing Promise transaction
kernel contract; this refactor does not change the native execution runtime.

Representative command, contention and mixed native/framework load measurements
remain outstanding. Existing test deadlines must be evaluated with setup and
environment contention distinguished from command cost. No throughput or
production-readiness claim follows from identical SQL or passing unit tests.

No schema was superseded by record 36. Deleting existing durable or deployed
data requires an inventory of the actual obligations. Disposable development
state follows the selected clean-schema/checkpoint-reset contract; it does not
create a backward-compatibility requirement by itself.

The owner has requested a clean transactional-core design without an assumed
backward-compatibility obligation. The
[storage proposal](./07-transactional-storage-redesign.md) distinguishes necessary
history/authority from duplicated fields, body representations and per-row SQL.
It also identifies terminal-session payload retention and expired-lease backlog
as separate storage/progress obligations. Installation and app schema validation
remain outside that investigation. Pending slices do not describe implemented
behavior, and storage reductions alone do not establish measured performance.

## Target Direction

Every common guarantee has an explicit owner; each framework participates
through narrow authenticated boundaries; every retained bridge has a reason;
and every selected replacement ends with removal of obsolete code and state.
Representative measured validation remains open. Both ownership replacements
include their consumer switches and logic cleanup; neither requires DDL.

## Next Correctness Gates

| Workstream | Current status | Observable exit |
| --- | --- | --- |
| Common publication and framework recovery extraction | Complete within record 36 | All current callers use the extracted owners; displaced implementations removed |
| [Ownership completion audit](./01-ownership-audit.md) | Complete for currently admitted source paths | Every responsibility and boundary classified with evidence, target owner and disposition |
| [R1 physical resource ownership](./04-implementation-proposal.md#r1-neutral-physical-resource-owner) | Implemented; bounded conformance proven | Relational and artifact consumers use neutral mechanics; displaced control-owned mechanics removed |
| [R2 CMS participant/materialization](./04-implementation-proposal.md#r2-cms-participant-and-application-materialization) | Implemented | CMS orchestration leaves native OCC; both participants use one shared materializer; displaced paths removed |
| [Replacement and cleanup](./02-migration-and-cleanup.md) | R1/R2 logic cleanup complete; no DDL | Each approved replacement completes its consumer switch and logic cleanup; retained state justified |
| [Performance and conformance](./03-validation-and-completion.md) | Focused extraction proof exists; broader measurement pending | Representative costs and concurrency meet explicit criteria; affected semantics preserved |
| [Transactional storage redesign](./07-transactional-storage-redesign.md) | Source audit and replacement proposal complete; implementation not selected | Selected redundant state/work removed, core and integration consumers switched, retention/correctness proven and costs measured |
| [Named cross-domain command](./05-named-command-preflight.md) | Private Currency + scalar CMS + Application profile implemented | Actual domain paths, complete atomic publication, rollback and retained recovery proven |
| [Atomic commerce composition](../workflow-foundations/09-atomic-composition.md) | Private Product/Currency profile implemented and validated | Exact installation-set admission, aggregate lifetime and complete relational publication through the existing owner |
| [Application command invocation](./06-application-command-invocation-preflight.md) | Preflight complete; Action-first implementation proposed | Authenticated real Action callback, frozen-intent recovery and explicit shared effect contract; Task invocation separately gated |
| [Runtime scalability redesign](./09-runtime-scalability-redesign.md) | Design recorded; runtime implementation and database validation pending | Selective work independent of total catalog size, explicit integrity/recovery guarantees, and proven concurrent publication across affected owners |
| Overall redesign reconciliation | Open | All required audit findings resolved; retained boundaries justified; independent capabilities explicitly deferred |

The [named-command contract](./05-named-command-preflight.md) is implemented
privately: real Currency, scalar Payload CMS and an Application-owned insert
share one physical transaction, aggregate lifetime, retained result and
finalizer. Focused PGlite and genuine PostgreSQL proofs cover combined rollback,
replay, cancellation, contention, native range conflicts and uncertain COMMIT
recovery. The separate atomic commerce host admits a bounded set of commerce
installations; it does not expand this Currency/CMS/Application profile.
Domain-event delivery, public APIs and general mixed OCC remain separately gated.

The [application invocation preflight](./06-application-command-invocation-preflight.md)
proposes the next capability: one private Action invokes the named command
through an authenticated callback. It explicitly includes command authorization,
a new branch in the existing effect ledger with an additive migration, and
recovery against the original intent after head movement. No implementation is
admitted by that preflight; Task invocation and public serving remain separate.

The separate completion gate is representative measured validation. Product scale remains in
[record 35](../flarexdb-framework-integration/preflight/35-medusa-product-scale.md);
it neither substitutes for this audit nor automatically depends on finishing
every separately gated capability. Update this table in place as durable status
changes; keep execution logs and test receipts outside the living roadmap.
