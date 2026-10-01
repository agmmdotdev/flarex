# Aggregate request entry and prepared source graph

Status: **proposed; runtime scope and the new atomic entry contract are unapproved.**
Investigation and this preflight are authorized. This is the next recommended
connected core package after delivered [15](./15-admission-protection-preflight.md),
[16](./16-batched-read-execution-preflight.md) and
[17](./17-batched-settlement-preflight.md), before conditional
[18](./18-host-lifecycle-preflight.md). The
[accepted design](../../design-notes/flarex-db-accepted-design.md) remains unchanged.

## Outcome and decision

Connect real private finite request entry, one bounded authenticated source-graph
construction and exact-transaction coverage reuse. Persistence owns admission,
creation and confirmed facts; executor consumes those facts and owns local
execution; framework adapters retain native business semantics. Migrate existing
private `finiteRoot` core APIs and genuine Product/Payload/workflow/Worker
consumer composition together. Change the responsible core functions, not
benchmark-local orchestration or copied runtime logic. A fixture-only shortcut
or a helper-only proof is not delivery.

Recommend preparatory target capture, detached canonical/control/crypto
preparation, then one fresh final target transaction at the existing session
activation owner. **Atomic session creation plus full source entry replaces the
current committed activation followed by a separately fallible entry.** Guard
lifecycle and private fact issuance also change. The owner must decide this
internal transaction contract before runtime implementation.

The separate control database remains separate authority. No SQL transaction
spans control preparation, argument capture, signature work, foreign callbacks,
sandbox execution or workflow pauses. No public authoring API, new framework
profile, target-epoch extension, control/target joint generation, maintenance
authority, weaker attestation, new settlement authority or host optimization is
proposed. Existing six-step exact-running kernels remain at later real frontiers;
their server relocation is excluded.

## Current graph and responsible owners

The [retained settlement evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/batched-settlement/README.md)
has initial admission **138 dispatches: 109 target and 29 control**, with eight
target transactions and one control transaction, common to the three mixed
private fixture graphs. These counts cover that measured profile only. The trace
groups fingerprints and spans; it does not provide exact
ordered per-transaction statement attribution. Current source supplies this graph:

| Boundary | Existing owner and responsibility |
| --- | --- |
| Target head hint | `applicationActivation.ts:699`, `loadActiveRevisionHint:1956`; selected active revision |
| Target immutable bundle | `applicationReadiness.ts:694`, `reserveBundle:1026`; full canonical revision/publication/function/task closure and epoch capture |
| Control schema binding | `applicationReadiness.ts:749`; separate locked schema-authority projection, alongside owner-managed artifact/physical/unique preparation reads |
| Target readiness | `applicationReadiness.ts:753`; physical builds/lifecycle, stored readiness/cold evidence and epoch correlation |
| Target coherent active selection | `applicationActivation.ts:714`, `readActiveLegacyInTransaction:1729`; fresh clock/readiness/head/activation/schema basis |
| Target mutation function | `applicationMutationAdmission.ts:230`, `selectStoredFunction:291`; exact public mutation and executable selection proof |
| Target activation | `transactionSessionActivation.ts:1431,1510`; replay-first selection check, session/lease/root/claim and database time |
| Target exact load | `transactionSessionActivation.ts:1523,2857`; six-step running kernel and pristine child-absence facet |
| Target full finite entry | `sessionJournalStore.ts:2450`; exact kernel, all ordered sources, bounded session sizes, final guard and local owner installation |

The fixture's real calls are in
`packages/flarex-backend/test/support/mixedMutationProductFixture.ts:330,897`.
Application readiness has an empty unique set here;
`appUniqueConstraintSetBuildV1.ts:583` returns `not_required` before another
target eligibility transaction. Framework source uniqueness remains required.
`logicalDocuments/sourceAdmission.ts:182` already shares binding checks inside
one exact transaction; extend that owner rather than recreate its semantics.

The standard Application runtime is a distinct retained profile.
`ApplicationMutationSystem.ts:781` calls `createPointMutationJournalV1` with
three arguments; `pointMutationJournal.ts:372` defaults to `durableOperations`.
Slice 19 does not migrate its initial path to aggregate finite entry or change
its default/public shape. Retain its selection, activation, stored evidence,
load/open and recovery contracts; shared helper changes must regress them.
Future standard finite-profile wiring requires a separate capability decision.

That owner resolves current revocation authority (`ApplicationMutationSystem.ts:822`),
uses the real grant issuer (`:835`), resolves retained outcomes (`:856`) and
activates (`:862`). Initial execution authenticates stored OCC evidence at
`initialPointMutationExecutionOperations.ts:158` before the load/open cut at
`exactPointMutationExecutionOperations.ts:338`. The private test issuer fixes
revocation epoch zero and omits these obligations. Do not drop authentication,
renewal or authority work to make the measured private ceiling appear universal.

`ApplicationMutationSystem.makeSelectionInvoke` constructs store, journal,
initial executor and claim vault in one trusted invocation, entering initial
execution directly after activation. This demonstrates a legitimate private
fact lifetime, not a finite consumer or hosted cutover. Proposed finite facts
stay in their trusted parent executor; never serialize them in the later
Worker `runner.runTransaction` request or journal RPC. Cross-process or
service-binding fact transfer is unapproved and retains durable readers. No
hosted `ApplicationMutationSystem` caller is established by this audit.

## Proposed entry topology

1. At Application activation/readiness, capture the selected head and bounded
   immutable bundle in one preparatory target transaction. Retain full canonical
   membership, bytes, before/after protected-epoch correlation and exact issuer
   identity; capture is not a live admission verdict.
2. Close target SQL. Existing owners authenticate canonical data and construct
   schema/ordered/unique/source evidence, arguments and verified grants in their
   existing bounded preparation lifetimes. Retain the separate control binding
   transaction. Do not retain mutable target readiness as construction data.
3. At session activation, enter one final target transaction. Preserve scope
   protection and lock order, request-key replay **before new-admission refusal**,
   post-lock database time, exact coherent head/function/full Application readiness
   and all ordered sources. Create and correlate actual session, lease, root and
   claim rows, including the pristine child-absence facet. Full 23-table
   restricted-role/catalog/installation attestation and NOWAIT final epoch guard
   remain required. Any trigger changes after earlier writes must be detected
   before payload capture or fact issuance.
4. Return private issuer-bound entry facts only after known COMMIT. The journal
   installs attempt maps, evaluator, admissions and original process-local claim
   after confirmation. Preallocated inert identities confer no authority. Do not
   fabricate a live kernel observation from an activation context or serialized
   selector. Facts bind exact issuer, scope/placement, schema/head, snapshot,
   attempt fence, claim owner/fence and execution profile. These are confirmed
   structural entry facts, never a live admission verdict after transaction exit.
   Capture must supply the existing stored-OCC materializer and commit-authority
   verifier with actual session/lease/claim/root fields and counters, all five
   child-absence predicates, bounded arguments/schema graph, signed grant/argument
   semantic digest correlation, schema binding and executable target. Reuse
   those materializers/verifiers after checked capture; an anchor/claim pair or
   trust boolean cannot bypass their obligations.

Unknown COMMIT, cleanup failure and interruption issue no speculative facts and
cannot repeat callbacks. Retain request-key/session/outcome recovery and its
existing uncertain-decision classification. Replay uses retained authority,
not a reconstructed initial-execution claim. A source refusal now rolls back
creation; document and prove this changed durable failure disposition. Do not
join head-first hint locking to clock-first activation without an explicit lock
and first-failure proof.

The final atomic entry retains activation's strong scope-clock lock through full
source validation. Fewer crossings may lengthen same-scope exclusion; do not
silently upgrade SHARE locks or weaken write protection. Measure transaction
and observed lock-wait envelopes with distinct connections for same/different
scopes and request keys, including invalid sources and replay. These envelopes
are not pure lock-hold time. Preserve initial coordinator renewal before expensive
body work (`pointMutationExecutionClaimLiveness.ts:131–136`), heartbeat and
deadlines. Confirmed structural facts replace neither renewal nor later fresh
access checks.

## One prepared source graph and fresh observations

`logicalStorageReadiness.ts:40,51,55` and
`logicalDocuments/sourceAdmission.ts:117,119,147,152,160` separately construct
artifact, physical/search/reference and source projections.
`indexBuildReconciliation.ts:460` rereads the artifact in its logical branch;
relational value preparation repeats requirements. Use one already-authenticated
catalog construction inside the same existing configured construction/control-read
lifetime. Compile immutable source/table/reference topology and table mechanics
once; preserve lazy invalid-source refusal and original error/charge order.
Publication definitions (`applicationDocumentMaterialization/materialization.ts:236,283,354`)
retain fresh publication reads.

Use existing `PreparedHostRuntime` preparation charge, mechanics lease and close
ownership; introduce no registry, cache service, cross-publication reuse or
adapter bypass. Its host preparation lifetime is distinct from per-attempt
`LogicalParticipantAttemptAdmission`, which binds attempt, principal, profile,
allowed methods, source head/hash and table IDs (`participantAdmission.ts:76,124`,
`relationalAdmission.ts:155`). A host lease is not attempt authority.

Add private prepared-source descriptor identity to existing attempt state. Bind
an admitted workflow/atomic member to the identical descriptor and factory issuer,
not source-key/hash equality. `medusa-adapter/src/product-launch-workflow.ts:160,175`
closes over `compiled.composition.participants`, while
`atomicCommerce/participants.ts:152` prepares admission separately; migrate that
handoff and the recapture at `commerceTransaction/borrowedWorkflowAttempt.ts:73`.
Reuse only table mechanics at `logicalDocuments/relationalQuery.ts:85` and
`relationalRows.ts:55`; retain per-request query envelopes, filters, page rows
and error order. Getter-free `capturePrivateJsonData` remains mandatory at
unknown input boundaries.

`logicalStorageReadiness.ts:161–232` owns source selection. Prepare ordered maps
instead of repeated searches; `applicationReadiness.ts:2140` provides an existing
map precedent. Decode each fresh build observation using an already compiled
Schema (`logicalStorageReadiness.ts:91`, `indexBuildStates.ts:243`); do not cache
decoded mutable rows or relabel library/idle CPU as application work.

Search currently repeats table-frontier coverage at `logicalSearchBuild.ts:137`
after index coverage preparation (`logicalStorageReadiness.ts:114`). Reuse
`readPreparedIndexCoverageTableFrontiers` (`indexBuildStates.ts:665`) only when
the issuer proves the **same transaction, clock and exact requested table
membership**. Keep fresh search/build state, physical GIN proof and clock checks;
consume any coverage error at its original search position after state/physical
checks. When no eligible proof contains the needed table, the search owner
legitimately performs that read. This is not a fallback engine or broader
readiness certificate.

## Proposed cost gates and attribution

These are proposed structural gates, not achieved results or latency forecasts.
Inventory actual construction and statements before runtime approval.

Admission topology is **9 → 3** explicit transactions: target **8 → 2**, control
**1 → 1**. Current target wrappers are eight BEGIN, eight COMMIT and six SET
statements: 22. Two READ COMMITTED target transactions use six wrappers, giving
**16 supported wrapper removals**. The source-derived formula is:

`new admission SQL = 138 - 16 - D + A = 122 - D + A`

`D` is actual displaced owner statements; `A` is added capture/correlation/guard/
fact work. Proposed admission ceiling **126** requires **A - D <= 4**. It does
not promise four added statements or credit twelve removed kernel reads without
accounting for their replacement proof. No row-write savings are inferred.

Conditional search reuse credits **10 / 10 / 23** statements only after exact
table membership is demonstrated for the actual frontiers. Payload has no
additional search saving. Product phase SQL is **210**; Product + Payload has
Product **210** plus Payload **18**; workflow has Product **209**, workflow **265**
and Payload **19**. Protected first fills differ across these source contexts;
these observations are not identical per-frontier costs or additive CPU budgets.

| Graph | Current SQL / transactions | Proposed ceiling SQL / transactions |
| --- | ---: | ---: |
| Product | 562 / 25 | 540 / 19 |
| Product + Payload | 585 / 26 | 563 / 20 |
| Mixed finite workflow | 888 / 39 | 853 / 33 |
| Standalone finite workflow | 309 / 6 | 309 / 6 |

The SQL ceilings subtract twelve admission statements and conditional search
savings. Transaction ceilings subtract six initial cuts; retain later **10 / 11 /
24** native data frontiers, two Application point transactions, one root point
bootstrap and three healthy terminal transactions. If construction or coverage
proof cannot meet these ceilings, revise the proposal before implementation;
do not claim a universal frontier floor or silently credit another optimization.
Server statements, allocations/bytes, preparation/reprepare and retry work must
be counted where observed; driver await is not server CPU or lock time.

Root point bootstrap is outside these savings. `sessionJournalStore.ts:3057`
validates attempt identity and table name, then `:3076` performs exact admission.
`pinnedPointTableResolution.ts:101,137,143,163` authenticates the pinned artifact,
manifest membership and stable deployment binding; it never reads the active
schema pointer. A confirmed entry may supply local exact deployment/schema/name/
table pins only if that stable-binding corroboration is already authenticated
in control preparation. Issue them after confirmed COMMIT, retain local
open/poison/fence/capability checks and lazy missing-table error order, and retain
the actual fresh point frontier. Manifest presence alone does not prove this
contract. No bootstrap removal is included in the ceilings.

## Breaking contracts, cleanup and retained obligations

| Contract/owner | Proposed replacement and required disposition |
| --- | --- |
| Private finite Application mutation selection/preparation | Owner-issued bounded construction followed by final exact acceptance; replace repeated healthy finite readActive/readiness/function composition; retain standard durableOperations selection |
| Finite session activation result | Confirmed finite entry facts and explicit atomic creation-plus-source-entry semantics; migrate finite executor claim/activation consumers, retain standard durableOperations activation |
| Loaded attempt requirement at journal open | Consume confirmed finite facts for migrated initial execution; remove displaced healthy load/open cuts, retain ordinary/durable/recovery and rerun readers |
| Finite initial stored OCC authentication | Consume confirmed finite capture through existing materializers/verifiers only where every obligation is proven; retain standard durableOperations and genuine recovery evidence/signature contracts |
| Prepared source/readiness APIs | Share one authenticated catalog construction and compiled source/table mechanics in their existing lifetime; migrate all connected source consumers |
| Search coverage input | Issued exact-transaction coverage with explicit table membership and ordered errors; retain legitimate owner reads when proof does not apply |

No schema, codec, durable format, reset or deletion is inherently required.
Revise the preflight if implementation evidence requires one. Drain live finite
owners or use existing exact fenced abort; do not transfer local maps. Retain
sealed-running/finishing/committed/relation-conflicted recovery and independent
ordinary Application, standalone Medusa/Payload and durable-operation profiles,
including their broader protected preparation obligations.
Remove displaced healthy finite APIs, exports, duplicate validators/construction,
fixtures and stale documentation in the same slice. Named standard Application/
durableOperations, standalone and recovery consumers retain their distinct
profile obligations without an arbitrary removal gate. Temporary displaced-path
retention still needs a named consumer and gate; no compatibility wrappers or
dual engines.

## Validation, alternatives and completion

Validate changed private finite core owners and genuine Product, selected Payload,
finite workflow and Worker consumers with PGlite and distinct-connection
ordinary-role PostgreSQL. Preserve ordinary Application, standalone and durable
regressions. Required witnesses cover:

- immutable unchanged-digest corruption and sidecar membership; invalid-later
  source/error order; late revocation/head/readiness/generation changes;
- same issuer and foreign/clone/closed fact refusal; lazy descriptor/error order,
  preparation budgets, one charge, close and reprepare; descriptor factory/identity,
  swapped source/attempt/principal/profile/method and closed-host refusal;
- same-clock coverage membership, missing tables, foreign issuer/transaction,
  changed publication clock and same-name wrong GIN;
- initial/late trigger inflation and actual final-row correlation with bounded
  scalar output; source refusal rollback and no confirmed facts/local capture;
- replay, unknown COMMIT, cancellation, renewal, freeze/late runner and recovery
  without duplicate callbacks/events; SQL closed during callbacks and crypto;
- same/different scope and request-key contention, invalid-source/replay ordering,
  preserved lock strength/order and observed wait/transaction envelopes.

Retain exact connected owner/source-hash references for the acceptance checkpoint;
existing measured sources and artifacts remain unchanged during this preflight.
Run affected type/build/Worker/source guards and lint, both final project reviews,
substantive-fix reruns and cleanup. Compare quiet traced structure and matched
untraced distributions on unchanged graphs, preserving all outliers and the
current measurement artifacts. A new stage pass is separate from whole-goal
acceptance: current mixed p50/p95 targets **100/200, 200/400 and 500/1,000 ms**
remain unmet, Product + Payload's p95 regression remains retained, and standalone
must stay below 400 ms median with regression strictly below 10%.

Cheaper attestation/certificates require a new integrity/maintenance contract.
A combined kernel server function requires moving or deleting decision
validators, migration and ordered adversarial proofs; eager JOIN/pipeline work
cannot preserve session refusal before lease locking, lease before claim and
post-lock time by assumption. Credit no automatic five statements per frontier.
Host 18 remains reserved, conditional and unapproved. CPU calltrees guide owner
investigation; they establish neither additive millisecond savings nor a host
cause. Delivery is one connected migrated runtime package with correctness,
cleanup and agreed cost gates; this document alone delivers no runtime behavior.
