# Aggregate request entry and prepared source graph

Status: **delivered; stage cost gates passed; whole mixed latency goals remain unmet.**
The connected runtime implements the approved atomic entry contract after
delivered [15](./15-admission-protection-preflight.md),
[16](./16-batched-read-execution-preflight.md) and
[17](./17-batched-settlement-preflight.md), before conditional
[18](./18-host-lifecycle-preflight.md). The
[accepted design](../../design-notes/flarex-db-accepted-design.md) records the bounded private entry contract.

## Outcome and decision

The slice connects real private finite request entry, one bounded authenticated source-graph
construction and exact-transaction coverage reuse. Persistence owns admission,
creation and confirmed facts; executor consumes those facts and owns local
execution; framework adapters retain native business semantics. Migrate existing
private `finiteRoot` core APIs and genuine Product/Payload/workflow/Worker
consumer composition together. Change the responsible core functions, not
benchmark-local orchestration or copied runtime logic. A fixture-only shortcut
or a helper-only proof is not delivery.

Preparatory target capture and detached canonical/control/crypto
preparation precede one fresh final target transaction at the existing session
activation owner. **Atomic session creation plus full source entry replaces the
former committed activation followed by a separately fallible entry.** Guard
lifecycle and private fact issuance also change under this approved
internal transaction contract.

The separate control database remains separate authority. No SQL transaction
spans control preparation, argument capture, signature work, foreign callbacks,
sandbox execution or workflow pauses. No public authoring API, new framework
profile, target-epoch extension, control/target joint generation, maintenance
authority, weaker attestation, new settlement authority or host optimization is
proposed. Existing six-step exact-running kernels remain at later real frontiers;
their server relocation is excluded.

## Prior graph audit and retained owners

The [retained settlement evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/batched-settlement/README.md)
has initial admission **138 dispatches: 109 target and 29 control**, with eight
target transactions and one control transaction, common to the three mixed
private fixture graphs. These counts cover that measured profile only. The trace
groups fingerprints and spans; it does not provide exact
ordered per-transaction statement attribution. The following was the audited
pre-cutover graph; its source locations identify the prior seams rather than the
current aggregate entry implementation:

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
revocation epoch zero. The former measured fixture omitted complete initial
authentication; the connected executor now retains that proof. Do not drop authentication,
renewal or authority work to make the measured private ceiling appear universal.

`ApplicationMutationSystem.makeSelectionInvoke` constructs store, journal,
initial executor and claim vault in one trusted invocation, entering initial
execution directly after activation. This demonstrates a legitimate private
fact lifetime, not a finite consumer or hosted cutover. Confirmed finite facts
stay in their trusted parent executor; never serialize them in the later
Worker `runner.runTransaction` request or journal RPC. Cross-process or
service-binding fact transfer is unapproved and retains durable readers. No
hosted `ApplicationMutationSystem` caller is established by this audit.

## Approved entry topology

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

Detached immutable canonical publication, schema, task, argument and grant
authentication runs after preparatory target SQL closes. The accepting transaction
retains the existing bounded fresh-observation hashes for physical readiness,
active head, source readiness and publication materialization. Those hashes
authenticate observations that must be fresh under the accepting locks; this
slice neither removes them nor substitutes a new synchronous crypto primitive.
The unprotected PGlite profile additionally retains the existing full canonical
final reread and authentication. Protected reuse requires the real PostgreSQL
installation and epoch attestation; PGlite cannot issue that proof.

Application's retained fresh digest is `application-physical-readiness`, over
the existing bounded build and lifecycle observations (at most 16,384 physical
definitions). The active head uses its existing canonical frame and 1 MiB
limit. Existing source/index/materialization owners retain fresh physical and
publication comparisons at their bounded serving/publication frontier. The
Application capture bounds function and cold membership to 4,096, head/body
projections to their owner byte limits, and task rows to the stored task
count plus one. Scalar aggregate gates admit at most 1 MiB of function-entry
bodies (the existing publication catalog limit) and 32 MiB of task evidence
including its header. Analysis/publication frames retain their existing 1 MiB
limits; cold receipts retain their protocol's 16 KiB per row and the 4,096-row
membership limit. Conditional SQL projections refuse oversized bodies before
the driver returns them; retained-host charging still accounts the resulting
prepared graph. These limits and fresh hashes are correctness work,
not preparation cost that can be silently removed.

Preparation and final acceptance functions are internal contracts consumed by
trusted core construction. Inert nominal handles and detached input getters do
not expose a transaction, source work callback, finalizer or commit authority to
application author handles, Worker RPC or SDK exports. Ordinary `readActive`,
function selection and `durableOperations` consumers retain their existing
read and activation obligations.

The final atomic entry retains activation's strong scope-clock lock through full
source validation. Preparation reserves issuer-local capacity before writes;
its acquisition/use/release lifetime must abandon cancelled handoffs and release
the reservation without making database work uninterruptible. Fewer crossings
may lengthen same-scope exclusion; do not
silently upgrade SHARE locks or weaken write protection. Measure transaction
and observed lock-wait envelopes with distinct connections for same/different
scopes and request keys, including invalid sources and replay. These envelopes
are not pure lock-hold time. Preserve initial coordinator renewal before expensive
body work (`pointMutationExecutionClaimLiveness.ts:131–136`), heartbeat and
deadlines. Confirmed structural facts replace neither renewal nor later fresh
access checks.

## One prepared source graph and fresh observations

`logicalStorageReadiness.ts` constructs one already-authenticated catalog inside
the existing configured construction/control-read lifetime.
`indexBuildReconciliation.ts` passes its authenticated logical artifact to the
requirements owner; source admission, search and relational value preparation
consume that same issued topology. Immutable source/table/reference projections
and table mechanics are compiled once. Lazy invalid-source refusal and original
error/charge order remain intact.
Publication definitions (`applicationDocumentMaterialization/materialization.ts:236,283,354`)
retain fresh publication reads.

Use existing `PreparedHostRuntime` preparation charge, mechanics lease and close
ownership; introduce no registry, cache service, cross-publication reuse or
adapter bypass. Its host preparation lifetime is distinct from per-attempt
`LogicalParticipantAttemptAdmission`, which binds attempt, principal, profile,
allowed methods, source head/hash and table IDs (`participantAdmission.ts:76,124`,
`relationalAdmission.ts:155`). A host lease is not attempt authority.

Private prepared-source descriptor identity is retained in existing attempt
state. The native workflow's trusted preparation callback passes the exact
compiled members to `atomicCommerce/participants.ts`; its issued descriptors
are reused by `medusa-adapter/src/product-launch-workflow.ts` and
`commerceTransaction/borrowedWorkflowAttempt.ts`. Factory and descriptor identity
bind borrowing to the original source preparation. Reuse covers only table
mechanics at `logicalDocuments/relationalQuery.ts:85` and
`relationalRows.ts:55`; retain per-request query envelopes, filters, page rows
and error order. Getter-free `capturePrivateJsonData` remains mandatory at
unknown input boundaries.

`logicalStorageReadiness.ts:161–232` owns source selection. Prepare ordered maps
instead of repeated searches; `applicationReadiness.ts:2140` provides an existing
map precedent. Decode each fresh build observation using an already compiled
Schema (`logicalStorageReadiness.ts:91`, `indexBuildStates.ts:243`); do not cache
decoded mutable rows or relabel library/idle CPU as application work.

Search consumes prepared table-frontier coverage after index coverage preparation.
`logicalSearchBuild.ts` reuses
`readPreparedIndexCoverageTableFrontiers` (`indexBuildStates.ts:665`) only when
the issuer proves the **same transaction, clock and exact requested table
membership**. Keep fresh search/build state, physical GIN proof and clock checks;
consume any coverage error at its original search position after state/physical
checks. When no eligible proof contains the needed table, the search owner
legitimately performs that read. This is not a fallback engine or broader
readiness certificate.

## Delivered cost gates and attribution

The [aggregate-entry evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/aggregate-entry/README.md)
retains full traced and untraced distributions with every sample and outlier.
All stage SQL/transaction gates passed. This is a private-profile stage pass,
not whole-goal latency acceptance or a hosted performance claim.

The retained measured fixture previously drove a pending journal directly and
did not execute the complete initial stored-OCC/grant verification path. The
connected slice uses the executor's authenticated finite initial-entry owner,
including original claim admission, initial renewal and liveness across the
manual Worker/body/seal lifetime. The three-transaction entry consists of two
target transactions and one control transaction. A complete authenticated
request additionally requires the existing fresh initial-renewal target
transaction; committed structural entry facts cannot replace that observation.
The original three-transaction complete-request forecast is superseded. Count
the added authentication and renewal proof in every actual statement and
transaction receipt; the earlier baseline grants no credit for omitted proof.
The actual construction and statement ledger includes those added obligations.

Structural entry topology is **9 → 3** explicit transactions: target **8 → 2**,
control **1 → 1**. This comparison excludes the added complete initial
authentication and renewal obligation. Prior target wrappers are eight BEGIN, eight COMMIT and six SET
statements: 22. Two READ COMMITTED target transactions use six wrappers, giving
**16 supported wrapper removals**. The source-derived formula is:

`new admission SQL = 138 - 16 - D + A = 122 - D + A`

`D` is actual displaced owner statements; `A` is added capture/correlation/guard/
fact work. The original structural admission ceiling **126** requires **A - D <= 4**.
The complete authenticated profile has **four** admission transactions: three
target and one control. Its wrapper reduction is **13**, because the fresh
renewal transaction retains its own three wrappers. The complete comparison is:

`complete admission SQL = 138 - 13 - D + A = 125 - D + A`

The observed normalized SQL fingerprint multiset accounts **51** displaced and
**23** added non-wrapper dispatches, giving **97** admission dispatches: **71**
target and **26** control. These differences include changed projections and
added authentication; they are not semantic owner removal credits or eliminated
row work. Isolated renewal SQL `Qrenew` remains unavailable without owner-level
trace attribution. One lease update, one claim update and the extra target
transaction are observed; shared reads must not be allocated by inference.
The original **126** admission ceiling remains the complete-profile gate.
Preserve every replacement proof and count all server statements.

The original forecast conditionally credited **10 / 10 / 23** search statements
only after exact table membership was demonstrated for the actual frontiers.
Payload had no additional forecast search saving. Prior Product phase SQL is
**210**; Product + Payload has
Product **210** plus Payload **18**; workflow has Product **209**, workflow **265**
and Payload **19**. Protected first fills differ across these source contexts;
these observations are not identical per-frontier costs or additive CPU budgets.

| Graph | Prior measured SQL / transactions | Original structural forecast SQL / transactions | Complete-profile ceiling SQL / transactions | Current warm SQL / transactions |
| --- | ---: | ---: | ---: | ---: |
| Product | 562 / 25 | 540 / 19 | 540 / 20 | 519 / 20 |
| Product + Payload | 585 / 26 | 563 / 20 | 563 / 21 | 542 / 21 |
| Mixed finite workflow | 888 / 39 | 853 / 33 | 853 / 34 | 845 / 34 |
| Standalone finite workflow | 309 / 6 | 309 / 6 | 309 / 6 | 309 / 6 |

The original transaction forecasts are superseded for the complete authenticated
profile because the earlier fixture omitted initial proof and renewal. The
original SQL ceilings remain the all-sample gates: cold/warmup maxima are
**523 / 548 / 849 / 309**, with no exception or exclusion. The complete profile
retains every initial proof. Whole-request latency goals remain unchanged. Report the
structural entry gate separately from complete-request SQL and transaction totals.

Warm terminal SQL is **173 / 178 / 216**, below **228 / 236 / 321**, with three
terminal transactions. The matched terminal fingerprint difference is four
displaced and two added non-wrapper dispatches, net minus two. It establishes
neither a semantic owner removal credit nor a latency cause.

| Graph | Warm p50 / p95 (ms) | Retained maximum (ms) |
| --- | ---: | ---: |
| Product | 752.955 / 888.010 | 7,701.252 |
| Product + Payload | 678.637 / 695.351 | 701.987 |
| Mixed finite workflow | 1,196.599 / 1,289.494 | 1,292.959 |
| Standalone finite workflow | 314.581 / 336.328 | 356.409 |

Standalone remains below 400 ms median and its **9.586912%** median increase
passes the strict below-10% gate. The prior mixed baseline omitted complete
initial authentication and renewal; these distributions are not equivalent
execution profiles. Retain their changes and outliers without attributing a
causal regression to the cutover. All mixed p50/p95 goals remain unmet.

The original SQL forecast subtracted twelve admission statements and conditional
search savings. Actual Worker and publication statement counts provide no
**10 / 10 / 23** search-saving credit; phase changes alone do not identify a
source cause. The complete profile retains one renewal transaction beyond the
structural entry. Retain later **10 / 11 /
24** native data frontiers, two Application point transactions, one root point
bootstrap and three healthy terminal transactions. If construction or coverage
proof cannot meet these ceilings, reconcile the measured complete profile before
claiming the cost gate; do not claim a universal frontier floor or silently
credit another optimization.
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

| Contract/owner | Delivered replacement and retained disposition |
| --- | --- |
| Private finite Application mutation selection/preparation | Owner-issued bounded construction followed by final exact acceptance; replace repeated healthy finite readActive/readiness/function composition; retain standard durableOperations selection |
| Finite session activation result | Confirmed finite entry facts and explicit atomic creation-plus-source-entry semantics; migrate finite executor claim/activation consumers, retain standard durableOperations activation |
| Loaded attempt requirement at journal open | Consume confirmed finite facts for migrated initial execution; remove displaced healthy load/open cuts, retain ordinary/durable/recovery and rerun readers |
| Finite initial stored OCC authentication | Consume confirmed finite capture through existing materializers/verifiers only where every obligation is proven; retain standard durableOperations and genuine recovery evidence/signature contracts |
| Prepared source/readiness APIs | Share one authenticated catalog construction and compiled source/table mechanics in their existing lifetime; migrate all connected source consumers |
| Search coverage input | Issued exact-transaction coverage with explicit table membership and ordered errors; retain legitimate owner reads when proof does not apply |

No schema, codec or durable format changed; no reset or durable deletion was
introduced. Local maps cannot transfer between live finite owners; disposal
retains the existing exact fenced abort. Retain
sealed-running/finishing/committed/relation-conflicted recovery and independent
ordinary Application, standalone Medusa/Payload and durable-operation profiles,
including their broader protected preparation obligations.
The connected private finite consumers use owner-issued preparation and atomic
entry; repeated healthy selection/activation/load/open composition and duplicate
source construction are displaced. Named standard Application/
durableOperations, standalone and recovery consumers retain their distinct
profile obligations without an arbitrary removal gate. Temporary displaced-path
retention still needs a named consumer and gate; no compatibility wrappers or
dual engines.

## Validation scope, alternatives and remaining gates

The validation scope covers changed private finite core owners and genuine
Product, selected Payload, finite workflow and Worker consumers with PGlite and
distinct-connection ordinary-role PostgreSQL, alongside ordinary Application,
standalone and durable regressions. The retained witnesses cover:

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
  without duplicate callbacks/events; SQL closed during callbacks and detached
  immutable/signature preparation, with the listed retained fresh hashes;
- same/different scope and request-key contention, invalid-source/replay ordering,
  preserved lock strength/order and observed wait/transaction envelopes.

Retain exact connected owner/source-hash references for the acceptance checkpoint;
existing measured sources and artifacts remain unchanged during this preflight.
Run affected type/build/Worker/source guards and lint, both final project reviews,
substantive-fix reruns and cleanup. Compare quiet traced structure and matched
untraced distributions on unchanged graphs, preserving all outliers and the
current measurement artifacts. The delivered stage pass is separate from whole-goal
acceptance: current mixed p50/p95 targets **100/200, 200/400 and 500/1,000 ms**
remain unmet; prior distribution regressions and current outliers remain retained. Standalone
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
