# Private Reference Schema And Binding Lifecycle

## Status And Scope

Status: LB1 implemented for the selected private profile; LB2-LB4 remain pending.
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

| Existing owner | Current mechanism to reuse | Selected evidence and remaining obligation |
| --- | --- | --- |
| [Logical candidate contract](../../packages/flarex-protocol/src/logical-schema-candidate.ts), producer analysis and [catalog admission](../../packages/persistence-postgres/src/storage/catalog/logicalSchemaAdmission.ts) | Qualified identities, canonical candidate/provenance evidence and retained Application/Payload write ownership; V3 policy ownership cannot be renamed, removed or reclassified through the selected admission path | LB1 proves selected endpoint/source/ownership/profile refusal and preservation; fresh serving across admitted transitions remains LB2 |
| [Logical readiness](../../packages/persistence-postgres/src/storage/catalog/logicalStorageReadiness.ts) and [source admission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts) | Exact source definition/evidence/profile matching; required table, index, unique and dependency preparation; authenticated preparation lifetimes | LB1 proves reverse-index readiness refusal at binding preparation/activation; fresh entry and stale publication across missing/withdrawn dependencies remain LB2-LB4 |
| [Binding host](../../packages/persistence-postgres/src/installation/frameworkSchema/binding/host.ts) and [reference projection](../../packages/persistence-postgres/src/installation/frameworkSchema/binding/strongReferenceProjection.ts) | Preparation and activation revalidation, scope-lock serialization, expected-head comparison, preservation of existing enforced contracts and an existence probe refusing new strong-reference projections on populated source tables | LB1 connects selected refusal, unchanged rebinding and preference-profile withdrawal; fresh/stale serving and concurrency remain LB2-LB4 |
| [Binding repository](../../packages/persistence-postgres/src/installation/frameworkSchema/binding/repository.ts) | Atomic activation/head, reference projection, maintenance replacement and finite metadata publication; selected permission withdrawal advances the existing revocation epoch | Prove no partial head/maintenance/authority transition and no invalid reuse after withdrawal, including concurrent saves |
| [Current Application binding](../../packages/persistence-postgres/src/application/activation/currentBinding.ts), [finite preparation](../../packages/persistence-postgres/src/application/activation/finitePreparation.ts) and [metadata dependencies](../../packages/persistence-postgres/src/execution/finiteMetadataDependencies.ts) | Genuine original-generation lending, exact prepared entry and consumed semantic metadata dependencies, including absent keys and change sequence | Preserve allowed unchanged-semantic reuse while refusing stale consumed contracts, ABA and expired/closed preparation through this joint profile |
| [Protected serving consumer](../../packages/flarex-backend/src/privatePayloadSaveConsumer.ts), [private save issuer](../../packages/persistence-postgres/src/execution/journal/privateSaveAccess.ts) and [Payload save runtime](../../packages/payload-adapter/src/runtime/referenceSave.ts) | Tracked permission read, attempt-bound grant, exact native/content identity, protected native access and effective-edge authorization; no ordinary writer fallback | Reconstruct these capabilities from fresh admitted evidence after supported lifecycle changes; old receipts cannot acquire new write authority |
| [Finite publication](../../packages/persistence-postgres/src/commit/point/finitePublication.ts) and [execution/recovery](../../packages/executor/src/mutation/execution/finitePointMutationExecution.ts) | One trusted settlement owner, consumed metadata comparison, current write/source acceptance, nonacceptance-bound retry and committed-outcome lookup | Prove both activation/save orders and recover an already committed save after later binding movement without repeating native work |

The selected LB1 inventory below has connected proof; the broader lifecycle
matrix remains pending through LB2-LB4. Existing generic evidence includes
[binding lifecycle](../../packages/persistence-postgres/test/installation/frameworkSchema/frameworkDataBindingTestSupport.ts),
[logical binding/readiness recovery](../../packages/persistence-postgres/test/storage/catalog/logicalSchemaBindingScenario.ts)
and [finite metadata semantics](../../packages/persistence-postgres/test/execution/finiteMetadataDependenciesScenario.ts).
The protected [save fixture](../../packages/flarex-backend/test/support/privatePayloadSaveFixture.ts)
and [Worker scenario](../../packages/flarex-backend/test/support/privatePayloadSaveServingScenario.ts)
retain the native consumer baseline; the private lifecycle witness below owns
LB1's bounded transition evidence.

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

The existing `requireSafeStrongReferenceActivation` owner now compares the
previous set even when the proposal is empty. Removing or replacing an enforced
contract refuses through the selected profile; a new contract still requires
the existing empty-source guard. This is safe refusal, not generalized schema
evolution, relationship retirement or a backfill capability.

## Known Gaps And Limitations

LB1 extends the protected save fixture with selected schema/binding refusal and
transition proofs. It does not establish fresh/stale serving across transitions,
concurrent activation/save, coordinated framework upgrades or populated-data
evolution. Generic lifecycle/metadata tests remain important owner regressions
but cannot substitute for the authorized native/Worker path in later gates.

The selected successful rebind is a new activation request for the same admitted
candidate and unchanged enforced contracts. The selected withdrawal removes the
Payload preference lifecycle binding while retaining those contracts; it advances
the existing authorization revocation epoch. Neither establishes support for a
different logical schema or reference removal. Do not fabricate a logical catalog,
readiness certificate, original generation or synthetic selection to create a
positive result. Direct corruption injection may test a named negative guard;
it cannot prove an admitted transition or a valid concurrency ordering.

The preflight itself established no runtime acceptance. LB1 now retains the
executable removal-refusal witness described below; that failure does not
establish lifecycle support, performance or production acceptance.

## LB1 Shared Correction: Preserve Enforced Reference Contracts

The [private lifecycle witness](../../packages/flarex-backend/test/privatePayloadBindingLifecycle.test.ts)
creates a genuine native Product, publishes a protected Application permission
record, and publishes a Payload article referring to that Product through the
existing admitted native save. It then prepares a second logical candidate with
the exact original protected Application, compiled Payload and native Product
sources, removing only the cross-framework extension declaration. Catalog
admission, existing index/unique build owners and binding preparation admit this
inactive candidate. Preparation preserves the active Application/binding heads,
scope clocks and execution authority, metadata observations, maintenance
obligations, committed rows/history and publication counts.

Expected: activation refuses the unsupported removal under its existing scope
lock, retaining the previous enforced reference projection and active authority.
No migration or reference retirement capability has been selected.

Reproduced before correction: PGlite and ordinary-role PostgreSQL activated the
replacement at binding sequence 2, reported it as currently selected, and
durably recorded `strongReferences: []` while retaining authorization revocation
epoch 0. The populated article was not converted or removed. This was an accepted
removal, not an inactive candidate or an expected-head refusal.

Owner: [binding activation](../../packages/persistence-postgres/src/installation/frameworkSchema/binding/host.ts).
Previously it only loaded the previous reference projection and called
`requireSafeStrongReferenceActivation` when the proposed reference list was
nonempty. That helper only probed newly introduced/changed proposed projections;
it did not reject an outgoing enforced contract missing from the proposal.
Catalog retained-ownership checks preserve table/source ownership but do not
own the active reference transition. The Payload adapter must not supply a
second check or retain a hidden stale projection as a workaround.

Authorized correction, implemented: the existing shared activation owner compares
previous and proposed enforced reference contracts even when the proposal is
empty. Removal or replacement refuses before maintenance, metadata or head
publication through the existing typed unsupported-profile failure. Identical
contracts and the empty-source guard for newly introduced references retain
their owners. No conversion, retirement, backfill certificate, public API or
Medusa change is introduced.

Disposition: corrected at the shared owner. The original removal-refusal assertion
is retained and now passes on both database lanes. LB2-LB4 remain separate pending
gates; historical recovery and concurrent saves are not inferred from LB1.

## LB1 Selected Transition Inventory

The connected witness first publishes a linked article through the protected
native save, then exercises the following actual owners on PGlite and ordinary-role
PostgreSQL. Existing protected composition/save regressions retain policy-table
rename/remove/reclassification, native access and publication coverage.

| Input or transition | Actual owner and selected outcome |
| --- | --- |
| Missing target table, nonidentity target field, foreign extension source key or incompatible target liveness | Candidate preparation refuses `invalidInput` before catalog publication |
| Foreign scope or changed/missing protected source evidence, Payload owner or write profile | Catalog admission refuses `wrongTarget` or `ownershipChanged` without changing catalog identities or active/data state |
| Missing/mismatched logical selection, foreign installation receipt or unregistered preference profile | Binding preparation refuses `logicalSchemaMismatch`, `unavailableInstallation` or `unsupportedProfile` without storing a binding candidate |
| Missing stored binding candidate | Activation refuses `missingDependency` without changing active authority or data |
| Removed or renamed enforced reference, or changed soft-delete retention | Catalog/build and inactive candidate preparation may succeed; activation refuses `unsupportedProfile` while preserving heads, clocks, authority, maintenance, metadata and committed state |
| Additional reference on the populated source | The existing activation existence probe refuses `unsupportedProfile`; a built reverse index does not certify existing reference validity |
| Actual reverse-index build temporarily unavailable | Preparation and activation refuse `logicalSchemaNotReady`; exact restoration reestablishes the previous state. This negative injection is not an admitted withdrawal |
| Same admitted candidate, new request and current expected head | Activation advances the binding head with unchanged reference contracts, scope execution authority and committed data |
| Remove the preference lifecycle binding, retaining the logical schema and references | Activation selects the withdrawal and advances the authorization revocation epoch by one, preserving reference contracts and committed data |

Refusal snapshots distinguish active state from legitimately retained inactive
catalog/candidate/build records. They compare stable catalog identities, active
Application/binding selection, metadata observations and scope clocks/authority,
index build/maintenance and unique maintenance, row bytes/history and publication
counts. LB1 adds no public operation surface or stale-capability guarantee.

## Target Direction And Next Correctness Gates

| Gate | Complete connected outcome and exit criteria |
| --- | --- |
| LB1: admission and refusal preservation | Implemented for the selected inventory above, using genuine protected Application, compiled Payload and unchanged native Product sources. The shared removal/replacement refusal is corrected; unchanged-candidate rebinding and preference-profile withdrawal are the real stimuli for later gates. |
| LB2: fresh entry and stale capability boundary | Connect that admitted rebind/withdrawal to current preparation and the SA4 consumer. Prove fresh entry, refusal of incompatible old preparation/capability/receipt publication, consumed-key absence/change/ABA, and existing selective unchanged/unrelated semantics. Distinguish entry refusal, invocation refusal and final publication conflict; do not flatten them into one new error or automatic retry. |
| LB3: concurrent activation and save | Use distinct ordinary-role PostgreSQL connections and explicit real-owner barriers to prove both accepted metadata/withdrawal versus save orders, including a save with Application work and native content already pending. Assert the actual winner, unchanged losing data and metadata/revocation behavior. A refused activation is not an activation-wins race witness. Reuse genuine whole-root retry eligibility and reconstruct permissions/native evidence after replacement. |
| LB4: restart, uncertain outcome and consumer cleanup | Recover identical activation requests with historical receipt distinct from current usability. Lose a real activation or save COMMIT acknowledgement and observe durability independently before changing authority; resolve/replay through the existing owner. Prove no duplicate writes/hooks/outcomes or serving fallback, preserve interruption/drain, and remove only displaced selected-consumer assembly after parity. |

Implement LB2 next using LB1's real transition inventory and refusal evidence.
Completing these bounded gates refines CXR4 only for this
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
