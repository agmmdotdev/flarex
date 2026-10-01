# Fresh binding and Application acceptance

Status: **proposed focused preflight; the recommendation below awaits the
coordinator's decision before runtime implementation.** The previous
[read-admission construction](./read-admission-construction-preflight.md) slice is
implemented. This document examines its remaining fresh accepting graph; it does
not authorize runtime changes or close the performance goal.

The [accepted DB design](../../design-notes/flarex-db-accepted-design.md),
[performance roadmap](./README.md),
[orchestration reassessment](./orchestration-simplification-preflight.md) and
[native artifact ledger](../../packages/medusa-adapter/benchmarks/core-performance/native-retrieval/README.md#read-construction-comparison)
govern the authority, sequence, measurements and limits. Full source readiness,
fresh mutable evidence, supported native semantics and trusted outer settlement
remain mandatory. An unchanged readiness root alone is insufficient authority.

## Connected outcome and scope

Replace repeated Application accepting reconstruction with one owner-composed
acceptance graph across Application readiness, active-head/binding evidence and
logical source admission. Migrate both the standalone request and retained finite
callers. The outcome must cover real native Product scalar/collection retrieval,
actual selected Payload Local API operations and the connected Application and
finite graphs, rather than deliver an isolated helper or SQL-count change.

The next implementation owner is `applicationReadiness.ts` together with the
accepting composition in `applicationActivation.ts`. Source-specific business
semantics remain with their framework. The selected proof mechanism, diagnostic
order and callback frontier require the decision recorded below before runtime
work starts.

Non-goals are source-demand narrowing, broader Product/Medusa modules or relation
configuration, public/developer APIs, schema or durable-format changes, durable
deletion, host lifecycle, terminal/recovery/publication redesign, cross-request
reuse and hosted activation. Full source definition/build/frontier breadth is
not omitted to obtain a lower count.

## Current accepting owner graph

Standalone Commerce obtains request-owned Application preparation and enters a
fresh relational session. Reads use repeatable read; commands use read committed
(`relationalTransaction/session.ts`, `makePostgresRelationalSession`). The host
installs command timeouts and locks the scope clock before admitting a source.

`logicalDocuments/sourceAdmission.ts` `checkBinding` requires authentic source
preparation and the Application issuer/lifetime. It locks and authenticates the
framework binding head and selected activation/candidate/lane evidence, then
calls `withApplicationBindingEvidenceInTransaction`.

`applicationActivation.ts` `withValidatedApplicationBindingBasisInTransaction`
owns a checked Application active-head observation through readiness validation
and its callback. The legacy readiness owner authenticates the stored issued
result, re-reads the canonical bundle when protected projection is unavailable,
checks fresh physical builds and lifecycle, and reauthenticates durable cold and
readiness evidence. Projection acquires revocation evidence. The callback checks
full logical schema/source readiness using the checked head. The callback owner
releases that process-local observation on every exit. PostgreSQL locks remain
transaction-owned. Source work and native business execution occur afterward.

Finite entry first accepts Application in
`transactionSessionActivation.ts` `finiteApplicationActivationScopedOperation`.
It passes `accepted.selection` into session journal entry. The journal binds the
source union, and the first source's `checkBinding` currently accepts Application
again in the same transaction. This is an existing composed-owner opportunity,
not permission to bypass exact source correlation or reuse an all-scope verdict.

Source-check sharing is limited to the exact transaction, Application token,
control/authority/unique issuers, deployment/scope/schema/manifest, authority and
clock, and full-versus-selected source key. It is remembered only after the source
proof succeeds. Every source still requires its exact source pin. Keep the
checked Application head under one owner callback across complete source proof.

Application query snapshots retain snapshot/history/function checks and later
acceptance. Ordinary mutation admission retains its distinct executable contract.
Relation/CMS accepted-binding callbacks retain exact transaction, clock and
readiness-issuer ownership. Final seal/publication source proof remains an
independent settlement obligation. None may silently consume a broader positive
certificate introduced for this graph.

## Measured statement ledger

The final construction scalar trace records 22 dispatches, 24 returned driver rows
and 71,383 JSON bytes at one-based SQL positions 38–59. The same accepting region
precedes the measured collection's native data work. The artifact ledger owns the
exact source inventory and measurement modes. These are measured dispatches,
not minimum correctness requirements or additive latency attribution.

| Position | Actual source operation | Evidence class |
| --- | --- | --- |
| 38 | Physical initial transaction BEGIN | Transaction orchestration |
| 39 | Relational snapshot-read repeatable-read isolation | Transaction orchestration |
| 40 | Physical driver installs lock/statement timeout | Resource orchestration |
| 41 | Commerce host installs command statement/lock timeout | Resource orchestration |
| 42 | Commerce host scope clock KEY SHARE | Fresh authority and snapshot |
| 43 | `readBindingSelectedEvidence` locks framework head SHARE | Fresh selected binding head |
| 44 | Same owner reads activation/candidate/physical-lane join | Immutable canonical reauthentication |
| 45 | Checked coherent Application reader locks active head SHARE | Fresh selected Application head |
| 46 | Same reader reads Application activation SHARE | Immutable activation authentication and head correlation |
| 47 | `reserveBundle` locks selected Application revision SHARE | Selected revision and immutable evidence |
| 48 | Same owner reads candidate/analysis/publication join | Complete immutable canonical reauthentication |
| 49 | `authenticateStoredBundle` reads complete bounded published functions | Full function catalog reauthentication |
| 50 | Task catalog snapshot independently reads scope clock | Repeated authority observation |
| 51 | Task catalog snapshot reads bounded catalog SHARE | Immutable task binding reauthentication |
| 52 | Same owner reads bounded task definitions SHARE | Complete task manifest/binding evidence, including empty catalog |
| 53 | `loadPhysicalBuildRows` reads build-state and scope-clock MVCC join | Fresh mutable build/coverage proof |
| 54 | Checked index coverage reads revision-schema SHARE | Immutable schema correlation used by live coverage |
| 55 | Physical lifecycle owner reads definition lifecycle SHARE | Fresh lifecycle proof, including meaningful empty result |
| 56 | `loadStoredColdEvidence` reads readiness parent SHARE | Durable readiness/cold reauthentication |
| 57 | Same owner reads readiness function children SHARE | Complete cold receipt/function proof |
| 58 | `loadStoredReadinessAuthority` reads same readiness parent SHARE again | Duplicate acquisition inside one accepting operation |
| 59 | Application binding projection reads revocation epoch KEY SHARE | Fresh authorization evidence |

The 22 statements comprise five session/clock acquisitions, two framework binding
acquisitions, two Application head/activation acquisitions, nine canonical/durable
reconstruction acquisitions, three physical/schema/lifecycle acquisitions and one
revocation acquisition. Driver and Commerce timeout statements have distinct
resource owners; their removal is outside this scope.

Full logical-source readiness follows at positions 60–66 with seven statements and
131 returned metadata rows; initialization follows at 67, native scalar storage at
68–69 and business COMMIT at 70. Those obligations stay charged. Binding/Application
acceptance is the largest region by dispatches/JSON bytes; full logical-source
readiness is the largest metadata-row region. Neither fact proves a CPU or lock
cause, or authorizes dropping evidence.

## Immutable authentication and fresh verdicts

Detached construction already authenticates bounded candidate, analysis,
publication, complete function/task catalogs, cold receipts and durable readiness.
Standalone accepting validation reconstructs these again through `reserveBundle`,
`authenticateStoredBundle`, `loadStoredColdEvidence` and
`authenticateStoredReadinessAuthority`. Cold authentication reconstructs runtime
targets; readiness authentication reconstructs the cold receipt digest, canonical
readiness frame and SHA. The readiness parent is selected twice.

Fresh heads, authority/generation/fence/epoch/revocation, build coverage and
definition lifecycle remain accepting verdicts. Build-state and its clock must
come from one MVCC statement. Preserve bounded refresh after clock advancement,
missing/invalid coverage refusal and draining lifecycle refusal. Under read
committed, same-transaction progress can require refresh; transaction identity
alone does not make an earlier clock or mutable verdict permanently current.

PGlite, ordinary owner credentials and unprotected PostgreSQL must retain full
live canonical proof. Protected preparation requires the authentic restricted
runtime, complete writer/trigger/function protection and exact installation and
epoch evidence. A hash/root-only comparison cannot substitute for either proof.
Control-catalog authentication, unique eligibility and source closure retain their
own owners; a target metadata epoch does not authenticate control data or repair
stale source preparation.

## Existing guard APIs and actual lifetimes

`preparedMetadataEpoch.ts` owns all existing protected evidence:

- `prepareProtectedMetadata` authenticates the restricted runtime and registers
  exact database/installation/incarnation/login identity.
- `captureProtectedMetadataEpoch` performs complete nonlocking identity and
  protection attestation, including login/role/catalog/installation/incarnation
  and generation; it does not read only installation/generation.
  `authenticateProtectedTargetMetadataSnapshot` currently follows canonical
  capture and compares that full observation with the original preparation
  anchor. The proposal reuses the detached, already-authenticated readiness
  bundle and this attestation API; its precheck does not reload canonical bodies.
- `openProtectedMetadataFinalGuardScope` opens an exact transaction registry.
  `registerProtectedMetadataFinalGuard` deduplicates per database and rejects
  inconsistent installation/generation expectations.
- `flushProtectedMetadataFinalGuards` performs the last metadata acquisition via
  `guardProtectedMetadataEpoch`, acquiring NOWAIT SHARE and checking the original
  installation/generation. It deletes the registry. `close...` removes it on every
  failed exit as well.

Only finite/exact-running-attempt kernels currently open and flush this scope.
`validateStoredIssuedReadiness`, checked Application head and selected framework
binding already use protected immutable projection only when that exact scope
exists. Standalone relational acceptance does not open it and uses full proof.

Request bindings deliberately have no retained-host lease. Retained finite
preparation carries the actual host lease and byte charge. Repository/result
WeakMaps require the exact readiness issuer and stored-result kind. Checked
Application observations require exact transaction and lifecycle clock; regressing
clocks fail and advancing sequence/floor/time requests a fresh read. Callback exit
revokes the checked observation on success, failure, defect and interruption.
Finite exact-clock registry separately permits revocation observation reuse; a
plain clock value is not equivalent nominal evidence.

## Recommended Application accepting graph

Use direct Application-owned pre-business authenticated snapshot admission and a
last-acquisition NOWAIT tail in the existing standalone relational transaction.
Reuse only the request readiness bundle already fully authenticated by detached
Application construction. This is a new bounded standalone proof/lifetime
decision; the recommendation is not runtime approval.

Do not open the finite global final-guard scope for standalone. That would also
enable cached framework binding and active-head structures, whose eligibility is
not established by the request readiness capture. Keep framework binding head
and body (43–44), Application head and activation (45–46), and revision-schema
correlation (54) live. Detached construction has not authenticated the activation
row: a captured epoch cannot bless an uncaptured corrupt row.

The proposed initial order is source/token/issuer/actual lease; session clock 42;
fresh framework head/body 43–44; fresh Application head/activation 45–46;
nonlocking full snapshot attestation against actual request readiness evidence;
retained immutable readiness projection with fresh build/schema/lifecycle 53–55
and exact basis correlation; revocation 59; full source proof 60–66; initialization
and native work plus all settlement validation; direct NOWAIT full guard as the
last metadata acquisition; SQL COMMIT and result release. Keep these operations
sequential and preserve expected failures versus defects/interruption; shared
transaction work is not independent parallel traversal.

After authentic issuer/lifetime and fresh clock/head/activation evidence, use
`authenticateProtectedTargetMetadataSnapshot` before business work to compare the
original readiness preparation anchor with the accepting transaction snapshot.
This performs complete current login/role/catalog/installation/incarnation/epoch
attestation over the existing 23 protected tables; it is not a readiness-root or
generation-only comparison. Reuse the authenticated readiness bundle only on that
successful exact protected path. Fresh physical build/coverage, lifecycle,
revision-schema, revocation and full logical source proof remain mandatory.
Fresh head/activation decode therefore retains its earlier failure frontier.
Epoch mismatch or invalid attestation now precedes physical refusal in their
double fault. Cold/durable capture corruption retains the earlier request
construction frontier. Inventory these changes by profile rather than remap
failures through a broad catch.

The Application owner must bind the admission observation to the actual request
readiness issuer/evidence, exact database/transaction, scope/clock/generation/fence,
revocation and original protected epoch, plus the actual retained lease where one
exists. Use existing owner and checked-head mechanics for a nonforgeable
callback-local observation. Do not introduce a universal positive certificate,
public API or global registry. Preserve separate nominal issuer identity,
authenticated immutable content and fresh mutable verdicts.

Compose the existing `withValidatedApplicationBindingBasisInTransaction` and
source-admission callbacks so one trusted owner retains the checked head across
complete source proof and native work, closing it through `Effect.ensuring` on
every Exit. The outer relational owner must perform
`guardProtectedMetadataEpoch` after all initializer/native/source/publication and
settlement-validation acquisitions. After a successful guard, perform no further
metadata acquisition: execute SQL COMMIT before result release. Guard/body or
settlement failure still follows established rollback and cleanup. It owns this
tail; an adapter or inner helper may not return success
before the guard. Use the existing complete NOWAIT guard directly, not a finite
scope that activates unrelated reuse.

Repeatable-read pre-attestation authenticates the accepting snapshot, not a
wall-clock latest-state claim. A prior snapshot mismatch refuses before business.
A later or in-flight invalidation can refuse after the local callback at the
final guard, including a serialization failure, but before successful result,
durable contribution or event release.
This explicitly amends standalone immutable-freshness refusal timing; it does not
permit remote effects or newly admitted untrusted callbacks while SQL is open.
Initial head/physical/lifecycle/source checks still precede native business work.
Later races are governed by the profile's final/publication checks; this is not
a promise of latest state before every operation. An aborting body retains its
first Cause instead of acquiring a later guard and replacing that failure.
Preserve established rollback/cleanup Cause composition, including cleanup
failures, alongside typed owner errors, defects and interruption;
there is no new retry or fallback after protected attestation fails.

Protected finite execution keeps its existing global final-guard contract.
Compose its accepted immutable Application observation into that same entry's
source union to remove duplicate canonical acceptance. Transaction identity alone
never authorizes reuse of mutable physical, source-readiness or clock verdicts.
Ordinary unguarded callers retain full live proof; this is explicit composition
for named consumers, not fallback behavior after a failed protected check.

## Graph-derived cost and acceptance budget

The selected protected standalone forecast is 15 accepting-region dispatches:
five unchanged setup/clock, two live framework binding, two live Application
head/activation, three mutable build/schema/lifecycle, one revocation, and two
complete pre-business/final-tail attestations. The derivation is **22 − 9 + 2**:
omit only captured canonical acquisitions 47–52 and 56–58. Position 54 stays live.
The final tail occurs after actual work, so region placement changes; retain a
disjoint all-request ledger rather than hide it outside the admission timer.

With every other measured obligation unchanged, whole-request forecasts are
63 scalar and 65 collection dispatches in three transactions. These are owner
graph forecasts, not measured results, latency promises or whole-goal acceptance.
The selected accepting readiness body must transfer zero candidate/publication/
function/task/cold/readiness body bytes and repeat none of their canonical
decoding/hashing/catalog reconstruction. Its work should not grow with those
immutable bodies. Count bounded request preparation once, all attestation and
protection work, control access and fresh source breadth. Cached head/activation/
revision-schema reuse is not selected to make this forecast smaller.

Measure finite entry plus source-union acceptance separately against its own
existing baseline. The protected finite graph already omits canonical loads;
its duplicate composition and remaining proof/encoding have different costs.
Do not import standalone forecast reductions into it.

Before implementation, instrument the selected component and define additive
quiet median/p95, server and transport baselines for unavoidable native demand
and measured accepting groups. Use those observations to set a proportional
component overhead gate; do not invent a millisecond guarantee. Validate complete
request work against the same native control and independently vary function/cold
body sizes, source width and physical definition count. Bounded source breadth and
fresh physical work may scale; accepting immutable reconstruction must not.

## Challenged alternatives

### Full live evidence composition if the proof change is rejected

Compose one current bounded immutable evidence acquisition at the existing
Application readiness owner. Pass one readiness parent to both cold/readiness
authenticators, provide the task owner exact authenticated transaction clock, and
batch bounded child evidence while reusing canonical authenticators. Preserve all
complete function/task/cold cardinality and byte limits. Avoid Cartesian joins,
repeated root bodies and unbounded server aggregation.

A challenged healthy acceptance forecast has 18 dispatches: five unchanged setup/clock,
two framework binding, two Application head/activation, five immutable groups,
three physical/schema/lifecycle and one revocation. The five immutable groups are
locked revision; candidate/analysis/publication; full functions; bounded task
catalog/definitions; and readiness parent/children. This replaces nine acquisitions
with five. SQL shape, cardinality, lock/evaluation order and actual driver/server
work must establish whether this target is sound; it is not a promised latency
result or a hard ceiling independent of those obligations.

This option is available if the coordinator rejects the new standalone proof.
It retains full-live bytes and reconstruction cost, so 18 is not the selected
performance goal. Removing only
the second readiness-parent read or only the task clock is insufficient connected
delivery. If cold/readiness is acquired and authenticated before physical proof,
durable corruption may precede physical refusal in a double fault. Explicitly
inventory that diagnostic amendment rather than preserve accidental callback
decomposition or claim unchanged failure order.

### Tail-only, early-held or global guard scope

Tail-only protected reuse would omit pre-business authenticated snapshot admission
and its earlier mismatch refusal. An early-held epoch guard would require a new
lock-order contract for later metadata acquisitions and is not selected. Opening
the finite global registry would silently enable cached framework/active-head
structures beyond authenticated request readiness. Reopening or flushing a
registry does not establish the recommended callback-local proof. Reject all
three as substitutes for the explicitly scoped pre-business plus final-tail graph.

The original source preparation remains independent of a freshly prepared
Application binding. `verifyPreparedBinding` compares its captured Application
analysis and logical schema reference with the current Application evidence and
binding frame, refusing `staleApplication` or `logicalSchemaMismatch` before full
source inspection. The source catalog has its own issuer/lifetime and captured
control evidence; it has no independent target epoch capability. Selected target
structure takes protection from the Application token. A new Application epoch
cannot bless older source structure. Select each participating owner's original
evidence and prove changed/mismatched evidence fails before business; decide how
stale source preparation is replaced without fallback engines or a broad admission
retry.

## Three coordinator decisions before runtime work

1. Select the recommended Application-only protected snapshot admission plus
   direct final tail, with complete current attestation, live head/activation/
   revision-schema and all fresh physical/source proof. Alternatively select the
   challenged full-live composition; do not infer approval from this document.
2. Accept the explicit standalone immutable-freshness timing amendment: prior
   snapshot mismatch refuses before body; later/in-flight invalidation may refuse
   after local callback but before any success/durable/event release. Preserve
   body-first Cause with established rollback/cleanup composition, initial
   physical/source checks before body, exact owner error
   provenance, unguarded full proof and the finite profile's existing contract.
3. Select same-entry finite Application immutable-observation composition into its
   source union, preserving the existing finite global guard and refreshing every
   actual mutable proof. Deliver it together with standalone Product/Payload/
   Application callers, graph-derived budgets, complete request instrumentation
   and incremental cleanup. No schema/data/public/host/terminal/recovery expansion
   is included. Runtime implementation starts only after this focused selection.

## Compatibility, migration and cleanup

Necessary private accepting APIs and callback shapes may change after scope
selection. The callback now carries authenticated immutable admission through
source/native work, and the outer relational completion carries its direct guard
tail. Update the legacy request accepting validator and source caller together;
finite entry passes its accepted immutable observation to journal/source union
without promoting it to a mutable readiness verdict. Keep precise success/error/
requirements and actual issuer identity in the changed types. Inventory request
and retained Application preparation/acceptance,
source admission and finite session entry/journal composition, actual Product and
Payload callers, ordinary Application query/mutation, relation/CMS accepted
bindings and independent final source proof. No schema, durable format, external
identity or public API break is selected by this preflight.

Retain ordinary executable activation/readiness and relation behavior for their
named callers. Migrate the selected request and finite accepting consumers to the
replacement together; remove their displaced duplicate loaders, signatures,
exports and fixtures in the same slice. Preserve full-proof coverage in its real
owner. Retention requires a named caller/removal gate, not hypothetical
compatibility. Finite immutable reuse does not permit an all-scope positive
certificate or reuse across transactions, issuers, clocks or source selections.

## Validation and completion gates

Retain exact pre-business issuer/head/physical/source refusals and the explicitly
selected immutable-freshness timing amendment. No successful result, durable
contribution or event may escape a failed final tail. Cover missing/corrupt
candidate, analysis, publication, functions,
task catalog/definitions, readiness parent/cold children; duplicate/missing/extra
children; empty/nonempty task catalogs; oversized frames; canonical byte/hash
mismatch; physical missing/not-enabled/draining/build/coverage loss; and amended
double-fault precedence. Concurrent head replacement, scope authority/revocation
change and same-transaction clock progress must invalidate or refresh the exact
owner evidence.

For any protected mechanism cover writer invalidation before acceptance, during
admission and before final tail; incompatible source/Application preparation
evidence; NOWAIT busy under both clock/epoch lock orders; restricted-runtime
protection bypass; installation reincarnation; and no business work at the
selected refusal frontier. A later fresh binding must not authenticate stale
source structure. Preserve exact expected failures, defects and interruption;
do not use a broad error remap to hide changed order.

Include corrupt activation before request capture: intact invalidation advances
the epoch, the request captures that valid new epoch/head/readiness, and accepting
fresh activation-row decoding must still refuse before business. The witness
must not assume an unreported privileged repair or that epoch coverage has
authenticated an uncaptured row. Test an older independent framework/source
template alongside a fresh request token: prove exact preparation correlations
rather than claim every new request inherits the older epoch. App-only admission
must not grant reuse eligibility to that template or its control catalog.

Cover wrong transaction/clock/issuer, forged handles and actual closed retained
leases; release on success/typed failure/defect/interruption; callback rollback,
cleanup failure and uncertain settlement; and borrowed Product/Payload lifetime
cleanup. Preparation capture and retained byte limits remain enforced. Never
turn ordinary business failure into automatic retry; existing uncertain-decision
recovery remains the only selected retry contract.

Run the existing nine connected mixed cases on each persistence lane, real Product
standalone scalar/collection and actual Payload scalar Local API, Application
query/admission and finite pending/OCC regressions. Finite entry includes lost
COMMIT-response recovery and atomic commit-facts installation. Independent final
seal/publication source proof remains covered. Tests of helpers alone cannot
establish framework lifecycle or connected core behavior.

Use fast PGlite and focused ordinary-role real PostgreSQL for transaction,
isolation, locking and query-plan claims. Match complete-request quiet, trace and
server diagnostics to the construction-final baseline with authenticated source
inventories; measure finite separately. Count setup, all dispatches/autocommits,
rows/pages/bytes, reconstruction/encoding, server-internal work, waits, refusal and
reprepare. Missing instrumentation is unavailable, not zero. A lifecycle or
cross-component contract amendment also requires the declared full integration
measurement gate.

Complete affected typechecks/builds/source guards, core/diff/staged lint, both
exact-checkpoint reviews and substantive-fix reruns, caller migration, cleanup,
owned-resource disposition and one scoped commit. Root owns scope decisions,
review triage and Git. Documentation records the selected contract and remaining
gates, not transient test/reviewer/commit receipts.
