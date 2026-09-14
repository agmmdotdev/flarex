# Deferred Cross-Framework Schema Evolution

Status: accepted sequencing boundary; advanced evolution implementation is
deferred until after the shared core redesign and requires separate approved
implementation sessions. This note is a warning and future work contract, not
authorization to start a migration engine now.

## Core First, Advanced Evolution Later

The owner prioritizes generic shared storage, three-producer schema composition,
cross-framework relationships, indexed queries, trusted settlement and core
cleanup. Prepare those owners so a later cohesive evolution module can use them.
Do not make general Medusa upgrades or arbitrary populated-schema conversions
prerequisites for finishing the core redesign.

The [accepted storage design](../../design-notes/flarexdb-shared-logical-storage.md)
and [core roadmap](./README.md) retain architecture authority. This boundary
narrows their implementation sequence: shared evolution remains the destination,
but its complete transition orchestration is a follow-on capability.

## Required Core Preparation

| Prepare and prove during core work | Do not implement speculatively |
| --- | --- |
| Stable qualified table/record identities, immutable candidate definitions, provenance and separate schema/write owners | A second framework catalog or generic schema-provider registry |
| Composition of Application, Payload and Medusa definitions, explicit dependencies and rejection of conflicts/missing endpoints | Every possible native schema upgrade or automatic discovery of business migration meaning |
| Existing validation and concurrency safeguards, admitted index/constraint builds, exact readiness and activation fences | A general destructive conversion planner or complete cross-framework upgrade orchestrator |
| Bounded authoritative row/index/relation writes, one settlement/recovery authority and identifiable progress/evidence owners | A new workflow scheduler, ledger, arbitrary callback executor or duplicate migration authority |
| Refusal of unsupported transitions, preserving the current active schema/execution combination | Successful no-op migrations, silent data deletion or running new framework code against an incompatible old schema |

Record the extension contracts and their actual owners, but do not create empty
packages, speculative interfaces, migration tables or an abstract step language.
The later module should compose existing core capabilities by responsibility;
a separate package is warranted only if its dependency boundary requires it.
Native compilation and business-conversion meaning remain framework-owned.

Do not weaken current Application checks for candidate data, nonempty table
removal, uniqueness, readiness or stale authority while replacing their owners.
If the new storage representation requires adapting an existing safeguard, that
is core correctness work, not permission to broaden the migration feature set.
Refusing an unsupported transition is valid core completion evidence; silently
accepting it is not. Adding a CMS view must preserve identity and write authority;
transferring write ownership remains blocked until its full transition is proved.

## Deferred Implementation Scope

Implement these in later sessions with concrete source-backed transitions:

- Dependency-aware changes to populated schemas across Application, Payload and
  Medusa, including removals, type changes and incompatible relationship changes.
- Medusa model/module upgrades and deliberate module retirement. Missing module
  discovery is not deletion intent; native schema diffs do not infer business
  data-conversion semantics.
- Payload schema/lifecycle changes affecting shared Application tables and
  identity-preserving transfers between Application and Payload write policies.
- Bounded data conversions, concurrent-write coverage, durable progress, restart
  and uncertain-outcome recovery for the admitted transition.
- Coordinated activation of dependent schema/execution revisions, cyclic
  dependencies, retained readers and recovery operations, and final retirement.
- Explicit rollback/forward-repair policy. Restoring an old schema definition
  does not automatically reverse transformed data.

This is one shared evolution responsibility with framework-owned inputs, not
three independently authoritative migration engines. Exact algorithms, storage
tables and callable interfaces are intentionally undecided until the core
contracts and the first real transition are available.

## Cleanup Is Still Core Work

Changing the storage engine and migrating its callers is distinct from exposing
general schema-upgrade features. Continue the core roadmap's inventory, cutover
and removal of obsolete generated-commerce DDL, coordinators, metadata,
repositories, exports and duplicate logic as their real consumers are replaced.
Do not retain the old framework migration engine as a fallback for deferred
features. A remaining platform/system consumer must have a named obligation
and disposition; an imaginary future migration is not a reason to keep it.

Flarex physical schema upgrades and any named durable-data conversion needed
for the core replacement retain their own explicit validation/reset policy.
This sequencing decision does not authorize destructive resets or discard
existing supported behavior.

## When Integration Encounters This Boundary

Record the concrete blocked operation, current behavior, required future
capability and relevant core owner. Tell the user that advanced evolution is
deferred by this note. Recommend either keeping that transition unavailable or
opening a separately approved implementation slice when its prerequisites exist.
Continue independent in-scope core work; do not silently expand the redesign.

If even safe refusal or an admitted core operation requires a core correction,
follow the integration skills' core-blocker proposal and approval procedure.
An already approved correction does not need repeated approval. Approval of the
overall storage vision does not activate this deferred implementation.

## Entry And Completion Gates For Later Sessions

Start only after the core redesign has its connected three-consumer proof and
the relevant extension contracts are available. Select an exact old/candidate
schema and framework version combination, its data/dependency graph and expected
outcomes. Obtain approval for one coherent implementation with owner, scope,
retirement and recovery obligations.

Prove valid and invalid transitions, concurrent writes, dependent-schema refusal,
restart, lost COMMIT, old-reader handling and cleanup. Use PGlite semantics and
ordinary-role Postgres concurrency/query-plan evidence separately; preserve
native framework behavior tests. Developer APIs remain a separate decision.
