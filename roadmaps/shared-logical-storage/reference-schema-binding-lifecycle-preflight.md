# Private Reference Schema And Binding Lifecycle

## Status And Scope

Status: proposed implementation sequence, grounded in the existing owners.
This preflight is complete as a plan; LB1-LB4 below are pending connected proof.
It narrows CXR4 in the [cross-framework preflight](./cross-framework-reference-preflight.md)
after the implemented [SA1-SA4 authorization foundation](./reference-save-authorization-preflight.md).
It does not mark CXR4 or the wider cross-framework proof complete.

The selected outcome is safe schema/binding lifecycle behavior for the existing
private optional Payload article-to-Product reference with Application work in
one finite root. Product soft deletion retains references; hard deletion remains
restricted. The policy source stays Application-command managed and content
stays Payload managed. Reuse the actual native Product source unchanged.

This is backend/private work only. It selects no public declaration syntax,
SDK methods, routes, dashboard design or general production dispatcher. Public
syntax remains a proposal in the [developer-contract note](../flarexdb-framework-integration/preflight/unified-application-cms-commerce-developer-contract.md).
No Medusa model, service, workflow, promoted source or concurrent implementation
is changed. Shared files owned by the other session require an ownership
checkpoint before any later overlapping implementation.

The [deferred evolution boundary](./deferred-framework-schema-evolution.md)
continues to apply: no populated-data conversion engine, ownership transfer,
arbitrary framework upgrade, activation-group orchestrator, new migration ledger
or destructive reset. Unsupported transitions must refuse safely. No named
durable data, history, outcome or outstanding attempt is reinterpreted.

## Current Sources Of Truth

The [accepted DB design](../../design-notes/flarex-db-accepted-design.md),
[shared relationship contract](../../design-notes/flarexdb-shared-logical-storage.md#cross-framework-relationship-contract)
and [package boundaries](../16-package-boundaries.md) govern authority. The
cross-framework preflight owns the broader relationship gates; this document
owns only their selected lifecycle proof and implementation order.

| Existing owner | Current mechanism to reuse | Connected obligation still pending here |
| --- | --- | --- |
| [Logical candidate contract](../../packages/flarex-protocol/src/logical-schema-candidate.ts), producer analysis and [catalog admission](../../packages/persistence-postgres/src/storage/catalog/logicalSchemaAdmission.ts) | Qualified identities, canonical candidate/provenance evidence and retained Application/Payload write ownership; V3 policy ownership cannot be renamed, removed or reclassified through the selected admission path | Enumerate exact rejected endpoint/policy changes against a real protected joint source, preserving the active selection and committed data |
| [Logical readiness](../../packages/persistence-postgres/src/storage/catalog/logicalStorageReadiness.ts) and [source admission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts) | Exact source definition/evidence/profile matching; required table, index, unique and dependency preparation; authenticated preparation lifetimes | Show missing or withdrawn cross-source dependencies cannot issue usable fresh entry/save authority or accept stale publication |
| [Binding host](../../packages/persistence-postgres/src/installation/frameworkSchema/binding/host.ts) and [reference projection](../../packages/persistence-postgres/src/installation/frameworkSchema/binding/strongReferenceProjection.ts) | Preparation and activation revalidation, scope-lock serialization, expected-head comparison and an existence probe refusing new/changed strong-reference projections on populated source tables | Connect refusal and admitted rebinding to the protected save consumer; classify relationship removal separately from adding/changing a proposed projection |
| [Binding repository](../../packages/persistence-postgres/src/installation/frameworkSchema/binding/repository.ts) | Atomic activation/head, reference projection, maintenance replacement and finite metadata publication; selected permission withdrawal advances the existing revocation epoch | Prove no partial head/maintenance/authority transition and no invalid reuse after withdrawal, including concurrent saves |
| [Current Application binding](../../packages/persistence-postgres/src/application/activation/currentBinding.ts), [finite preparation](../../packages/persistence-postgres/src/application/activation/finitePreparation.ts) and [metadata dependencies](../../packages/persistence-postgres/src/execution/finiteMetadataDependencies.ts) | Genuine original-generation lending, exact prepared entry and consumed semantic metadata dependencies, including absent keys and change sequence | Preserve allowed unchanged-semantic reuse while refusing stale consumed contracts, ABA and expired/closed preparation through this joint profile |
| [Protected serving consumer](../../packages/flarex-backend/src/privatePayloadSaveConsumer.ts), [private save issuer](../../packages/persistence-postgres/src/execution/journal/privateSaveAccess.ts) and [Payload save runtime](../../packages/payload-adapter/src/runtime/referenceSave.ts) | Tracked permission read, attempt-bound grant, exact native/content identity, protected native access and effective-edge authorization; no ordinary writer fallback | Reconstruct these capabilities from fresh admitted evidence after supported lifecycle changes; old receipts cannot acquire new write authority |
| [Finite publication](../../packages/persistence-postgres/src/commit/point/finitePublication.ts) and [execution/recovery](../../packages/executor/src/mutation/execution/finitePointMutationExecution.ts) | One trusted settlement owner, consumed metadata comparison, current write/source acceptance, nonacceptance-bound retry and committed-outcome lookup | Prove both activation/save orders and recover an already committed save after later binding movement without repeating native work |

These mechanisms exist; they are not a claim that the selected lifecycle
matrix has passed. Existing generic evidence includes
[binding lifecycle](../../packages/persistence-postgres/test/installation/frameworkSchema/frameworkDataBindingTestSupport.ts),
[logical binding/readiness recovery](../../packages/persistence-postgres/test/storage/catalog/logicalSchemaBindingScenario.ts)
and [finite metadata semantics](../../packages/persistence-postgres/test/execution/finiteMetadataDependenciesScenario.ts).
The protected [save fixture](../../packages/flarex-backend/test/support/privatePayloadSaveFixture.ts)
and [Worker scenario](../../packages/flarex-backend/test/support/privatePayloadSaveServingScenario.ts)
establish the current composition, not schema-transition support.

## Current Architecture

The executing chain remains producer analysis and candidate admission, existing
build/readiness owners, binding preparation/activation, genuine finite entry,
protected native save, freeze and final publication. Candidate publication is
not binding activation; a stored candidate is not permission to serve it.
No second catalog, relation coordinator or transaction owner is selected.

Keep these distinct when constructing the evidence matrix:

- Schema identity and write ownership: qualified tables/fields, native source
  evidence, Payload content/provenance and retained command/CMS policy claims.
- Relationship semantics: endpoint identity, cardinality/nullability, liveness,
  retention/restrict policy and required reverse/index/unique dependencies.
- Binding and readiness authority: current Application generation/head,
  selected binding, installed maintenance, preparation lifetime and fences.
- Editor permissions: source/assignment/retention data read through SA1 exact
  point dependencies. A policy-row update is not a schema or ownership transfer.

SA3 already proves database-local permission revocation. This preflight adds
schema/binding interactions; it neither replaces that proof nor generalizes
the permission engine. A hash identifies captured semantics; its equality alone
does not authenticate an owner, establish readiness or authorize a transition.

## Invariants And Trust Boundaries

Only trusted analysis, catalog/build, binding and execution owners may select
the schema, policy point, principal, dependency evidence and native profile.
Application arguments cannot supply those capabilities. Payload retains native
access/validation/lifecycle semantics; Product operations retain their Medusa
owner. Native Application OCC and framework execution profiles remain distinct.

Refusal leaves the active Application/binding heads, installed maintenance and
write authority unchanged. It publishes no content, Application write, preference
cleanup, fact, event or mutation success. Distinguish legitimately retained
inactive candidate/build metadata from activation success: preparation may store
an immutable candidate without selecting it. Record each phase's expected
metadata footprint instead of asserting that all database tables stay unchanged.

An old in-memory capability need not disappear synchronously when a binding
changes. Its next consuming owner must enforce its actual admission contract,
and it must never publish against incompatible current authority. Preserve
snapshot-compatible pending observations and exact receipt replay where the
existing owner permits them; replay is not fresh authorization or a publication
bypass. Do not add a blanket head-number check that replaces semantic dependency
validation or rejects existing permitted unchanged-semantic reuse.

No SQL transaction spans untrusted Worker execution, unadmitted native hooks,
remote work or a test barrier. Admitted database work keeps its existing owner.
Reuse existing scope locks, metadata/revocation sequence, fencing,
operation/byte limits, cancellation and rollback-only owners. Do not add an
unlocked last-minute schema query, independent transaction or adapter-side
compatibility classifier to repair a shared-owner gap.

## Decisions And Transition Matrix

The first implementation establishes refusal and preservation before selecting
any new successful transition. Successful rebinding must use an existing
admitted transition, keep endpoint identity/write ownership/reference semantics
and perform no data reinterpretation. An unsupported transition stays unavailable;
generic storage or an empty fixture does not make it supported automatically.

The outcomes below are required proof, not newly implemented capability or new
error names. Preserve each owner's genuine refusal frontier and typed cause.

| Transition or interleaving | Selected requirement |
| --- | --- |
| Candidate omits an endpoint, changes target key type/owner, or supplies foreign scope/source/profile evidence | Refuse through the authentic candidate/admission/binding owner before usable serving authority; leave the previous active graph and data intact |
| Rename/remove/reclassify a retained protected policy or Payload-managed table | Preserve existing retained-ownership refusal; no ordinary Application writer or self-grant interval |
| New/changed strong-reference projection on populated source data | Preserve the existing activation refusal requiring validated backfill; no scan-and-approve shortcut or backfill implementation in this slice |
| Remove a relationship, relax its policy, change liveness/identity/nullability, or require a populated-data conversion | Outside the selected successful transition profile; trace actual compatibility/refusal owners and preserve an executable refusal witness before any support expansion |
| Required reverse index, target unique identity, preference installation or source dependency is missing/unready/withdrawn | No usable fresh authority; old execution cannot publish unless its actual current acceptance contract still proves every required obligation |
| Same semantics remain enabled after an otherwise admitted binding/head change | Fresh preparation must select genuine current authority; retain unchanged-semantic reuse only where existing owners prove it. Head movement alone is not a new universal OCC conflict rule |
| A consumed schema/source/profile/dependency changes after entry or after a native receipt | Preserve the original dependency and refuse stale publication; no partial writes or success outcome. A retry, when genuinely eligible, re-enters and reauthorizes with fresh evidence |
| A consumed metadata contract changes A to B and back to A | Preserve change-sequence/ABA protection; matching final bytes do not erase the intervening invalidation |
| An unrelated source or unconsumed metadata key changes | Preserve existing selective dependency semantics; do not invent an all-schema invalidation barrier to make tests pass |
| Save wins the publication lock before a later incompatible authority change/withdrawal | The committed save remains authoritative; later activation must independently pass its own data/dependency checks |
| Authority withdrawal or relevant accepted metadata change wins before save acceptance | Old authority cannot publish; prove the actual owner refusal, then fresh retry or terminal refusal according to existing eligibility |
| Activation request is repeated or its acknowledgement is lost | Recover the same durable activation receipt/request identity; separately report whether it is currently selected and usable. Reusing the request ID with different bytes remains refused |
| Save COMMIT acknowledgement is lost, then a later binding moves or becomes unavailable | Resolve the original mutation outcome before any rerun. An already committed result is not reauthorized as a new write or duplicated |

The current `requireSafeStrongReferenceActivation` probe compares proposed
new/changed projections with the previous set. It is not itself a generalized
compatibility check for removing a relationship or relaxing a policy. LB1 must
trace the complete owner path for those cases rather than assuming that probe
covers them. This source audit establishes a proof obligation, not a reproduced
runtime defect or authorization to loosen the selected profile.

## Known Gaps And Limitations

The selected protected save fixture activates one fresh joint catalog and binding.
SA1-SA4 do not prove schema/binding lifecycle, coordinated framework upgrades or
populated-data evolution. Generic lifecycle/metadata tests remain important
owner regressions but cannot substitute for the authorized native/Worker path.

The exact supported successful rebind and withdrawal stimuli must be identified
through existing real owners during LB1. Do not fabricate a logical catalog,
readiness certificate, original generation or synthetic selection to create a
positive result. Direct corruption injection may test a named negative guard;
it cannot prove an admitted transition or a valid concurrency ordering.

This documentation-only preflight establishes no new runtime failure witness,
database validation result, performance result or production acceptance. A later
failing witness must record expected/actual behavior and its shared owner here,
then follow AGENTS.md's authorization rule before dependent correction work.

## Target Direction And Next Correctness Gates

| Gate | Complete connected outcome and exit criteria |
| --- | --- |
| LB1: admission and refusal preservation | Build the exact supported/refused matrix from genuine protected Application, compiled Payload and unchanged native Product sources. Prove endpoint/ownership/profile incompatibility, populated-reference policy refusal and missing dependency/readiness behavior at their actual owners. Compare phase-specific inactive metadata, active heads, maintenance/authority and committed data. Name one existing admissible identity/semantics-preserving rebind and one real withdrawal path for later gates; record an unsupported prerequisite instead of inventing one. |
| LB2: fresh entry and stale capability boundary | Connect that admitted rebind/withdrawal to current preparation and the SA4 consumer. Prove fresh entry, refusal of incompatible old preparation/capability/receipt publication, consumed-key absence/change/ABA, and existing selective unchanged/unrelated semantics. Distinguish entry refusal, invocation refusal and final publication conflict; do not flatten them into one new error or automatic retry. |
| LB3: concurrent activation and save | Use distinct ordinary-role PostgreSQL connections and explicit real-owner barriers to prove both accepted metadata/withdrawal versus save orders, including a save with Application work and native content already pending. Assert the actual winner, unchanged losing data and metadata/revocation behavior. A refused activation is not an activation-wins race witness. Reuse genuine whole-root retry eligibility and reconstruct permissions/native evidence after replacement. |
| LB4: restart, uncertain outcome and consumer cleanup | Recover identical activation requests with historical receipt distinct from current usability. Lose a real activation or save COMMIT acknowledgement and observe durability independently before changing authority; resolve/replay through the existing owner. Prove no duplicate writes/hooks/outcomes or serving fallback, preserve interruption/drain, and remove only displaced selected-consumer assembly after parity. |

Implement LB1 first. Later gates depend on its real transition inventory and
refusal evidence. Completing these bounded gates refines CXR4 only for this
profile; CXR3's opposite-direction/three-owner extension, general authorized
traversal, pending new Products and broader evolution retain their own gates.

## Ownership, Evidence And Verification

Use existing protocol/analysis owners for candidate contracts and authenticated
producer evidence; persistence catalog/readiness/binding owners for transition
classification and activation; existing finite metadata/publication/executor
owners for stale-use, retry and recovery; Payload for native configuration and
Local API behavior; backend composition for the private consumer/Worker boundary.
No new package, registry, codec, versioned policy contract or public API is
selected by this preflight.

Extend the existing protected save fixture only to arrange real owner calls,
inputs, barriers and observations. Preserve native create/update/delete,
soft-delete retention/hard-delete restriction, preference cleanup and separate
default/read-profile regressions. Fixtures must not evaluate reference policy,
manufacture metadata observations, implement publication or classify retries.

Report PGlite semantics and ordinary-role PostgreSQL transaction/concurrency/
recovery proof separately. For lock-order claims observe actual blocking/backend
identity; for lost acknowledgement forward the real COMMIT, independently verify
the durable result, then lose its response. Measure both activation state
(candidate/head/receipt, reference projection, maintenance, metadata/revocation)
and mutation state (rows/history/indexes/preferences/facts/events/outcomes).
Keep scopes, source identities and principals distinct in foreign-evidence cases.

Use the actual SA4 Worker/RPC boundary for opaque serving refusal and caught-error
rollback. Preserve typed trusted errors, corruption/infrastructure distinctions
and full cancellation/cleanup Causes. Run affected Pinggg `tsc-rs` checks,
build/source guards, lint and both required read-only project reviews for code.
Stop owned Worker/database resources. Git owns validation receipts; this roadmap
records durable status and blockers, not test-run chronology.

## Convex Compatibility And Flarex Divergences

The local [Convex mutation context](../../../../npm-packages/convex/src/server/registration.ts)
preserves explicit operation composition and atomic database mutations. Keep
that model. Declared cross-framework strong references, separately authenticated
write owners and Postgres-authoritative binding/readiness acceptance are Flarex
requirements. They grant no relational nested writes, independent-call atomicity
or universal framework transaction API. Worker/service-binding delivery is an
adapter to those owners, not schema or commit authority.
