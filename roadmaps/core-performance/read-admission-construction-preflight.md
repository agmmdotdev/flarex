# Read admission and proof construction

Status: **implemented under the approved focused contract.** Standalone Application construction
uses request-owned capture and detached immutable preparation at the existing owner.
Full readiness, live acceptance and current protection remain mandatory. The
approved standalone physical refusal-frontier amendment below changes diagnostic
timing and precedence while preserving full proof before business execution. Demand
narrowing, cross-request reuse, cheaper attestation and the proposed one-final
settlement graph remain unapproved.

The [performance roadmap](./README.md), [orchestration reassessment](./orchestration-simplification-preflight.md)
and [proposed finite target](./orchestration-target-design.md) own the broader
direction. The [native measurement preflight](./native-retrieval-measurement-preflight.md)
defines the exact control. Its [artifact ledger](../../packages/medusa-adapter/benchmarks/core-performance/native-retrieval/README.md#read-construction-comparison)
owns numerical observations, source/build/runtime identities and limits. The
[accepted DB design](../../design-notes/flarex-db-accepted-design.md),
[mixed design](../../design-notes/flarexdb-mixed-mutation-execution.md), slices
[16](../mixed-mutation-core/16-batched-read-execution-preflight.md) and
[19](../mixed-mutation-core/19-aggregate-entry-preflight.md), package boundaries and
repository integration/Effect skills govern current semantics.

## Connected outcome and why now

Capture the current Application head and its bounded immutable rows once for each
standalone request, authenticate canonical structures and configured control
evidence after target SQL closes, then accept the prepared binding in the existing
fresh business transaction. Generalize the existing immutable preparation owner
rather than build a second activation or readiness engine. Finite admission uses
the same owner under its actual retained preparation lifetime and original claim,
fence and tentative execution contract.

The nearest proof is existing standalone scalar/collection Product retrieval
against pinned native MikroORM. The Product update/Application graph, actual
selected Payload Local API and finite workflow regressions establish that shared
construction changes preserve their consumers. This slice adds no Product CRUD
logic, private retrieval configuration, framework capability, public API, host
lifecycle, terminal transition, recovery contract or durable format.

## Measured demand and owner attribution

The matched native scalar and collection cases each execute one autocommit query
and return the same complete selected DTO and native missing-error behavior as
protected standalone Flarex. The displaced Flarex baseline executes 106/108
dispatches in six transactions. These are standalone request observations, not private finite checked-read counts
or correctness floors. Quiet, trace and server diagnostic runs are separate;
their intervals cannot be subtracted to establish a latency cause.

| Observed owner region | Current work and selected disposition |
| --- | --- |
| First five standalone transactions | `prepareApplicationBindingSelection` falls back to ordinary `ApplicationActivation.readActive`, performing readiness reservation/schema/physical/unique preparation and revalidation. Replace healthy binding-only assembly with one bounded target capture and detached preparation. Count all configured control and unique/lifecycle SQL. |
| Final standalone read transaction | Retain the fresh business snapshot, binding/Application acceptance, current protected attestation and full logical source build/coverage proof before selected data is probed/hydrated. This remains the existing accepting owner. |
| Native method and repository | Retain scalar root selection, collection relation join, native normalization/serialization and complete selected DTO/error behavior. Native demand does not explain repeated pre-method preparation. |
| Shared immutable preparation and finite profile | `makeActivePreparationReader`, `captureApplicationReadinessInTransaction` and `prepareCapturedApplicationReadiness` separate bounded capture from detached authentication. Standalone binds request-owned evidence; genuine finite profile tokens/methods retain their real lifetime and claims at the same preparation owner. |

The current shared mechanic is `makeActivePreparationReader`, with
`captureApplicationReadinessInTransaction` and `prepareCapturedApplicationReadiness`
at the readiness owner. `PreparedApplicationBinding` is an inert request-owned
legacy binding token. The distinct `PreparedFiniteActiveApplication` and its
finite admission methods retain their actual executable-selection and lifetime
obligations; those profile names do not imply a duplicate preparation engine.

The displaced scalar trace reaches its native callback only after 103 statements. Its source
proof checks ordered/unique/search definitions and table frontiers beyond the
selected Product row. Exact positions, returned rows and JSON-byte counts belong
in the artifact ledger. Remove proved repeated immutable construction; do not
infer that any definition or live check can be omitted, establish server CPU/lock
causation or close scaling acceptance from these observations. The matched
replacement lowers observed standalone work and quiet latency while preserving
native demand; exact before/after observations remain in the artifact ledger.

## Selected construction and acceptance contract

1. Register the existing Application preparation owner for legacy binding-only
   consumers. Each standalone `prepareApplicationBindingSelection` call captures
   the current active head, readiness and bounded canonical rows in one short
   target transaction. No head, live verdict or preparation is pinned across
   requests. A later request must observe a later valid active head.
2. Generalize the finite-named capture/preparation mechanics to plain unversioned
   semantic names. Authenticate candidate, analysis, publication, function/task/
   cold evidence, schema correlation and configured immutable control/physical/unique
   closure after target SQL closes. Standalone detached construction follows the
   canonical/function/task/schema/unique/durable order; live physical readiness
   belongs solely to fresh business acceptance. Foreign getters and detached
   canonical verification remain outside target SQL. Preserve the existing
   admitted callback SQL lifetimes; capture does not execute native business work
   or extend a transaction around untrusted work.
3. Issue an inert legacy preparation token within `ApplicationBindingInput`,
   authenticated by the actual readiness/activation issuer. It is not an executable
   `ApplicationActiveSelection`, cannot authorize execution and cannot dispatch
   relation preparation. Keep relation-only preparation/input APIs and their real
   composite behavior unchanged. Token lookup distinguishes actual issued contracts.
4. Fresh business acceptance uses the existing
   `withValidatedApplicationBindingBasisInTransaction` owner and existing accepted-binding
   composition. Preserve exact issuer/database/schema/scope/source/binding pins,
   live clock/head/generation/revocation, full readiness, physical/build/coverage
   checks and required protected tail in that transaction. Structural preparation
   never constitutes a serving verdict.
5. Derive target protection from the actual token's readiness issuer. Migrate
   source admission and connected consumers so the new token retains current
   epoch/attestation. A copied digest, source catalog or unique configuration
   cannot supply protection. Keep the current 23-table final tail and full
   per-guard installation/login/role/catalog attestation. The sole source-admission
   caller receives the authentic optional issuer lifetime with that protection;
   request-owned tokens have no retained issuer lease.
6. Finite Application mutation admission retains its actual preparation lifetime,
   executable selection requirements, fresh accepting transaction, original
   snapshot/claim/fence and later access/final checks. Standalone tokens borrow
   neither finite claims nor host allocations. Preserve mid-request head refusal
   with no new retry; the next request captures afresh.

Keep ordinary `readActive` for true executable Application and framework-binding
callers. It must not remain a fallback healthy binding-only engine. Composite
relation preparation remains its own contract; migrate any legacy branch needing
binding-only preparation without changing relation dispatch or execution authority.

### Capture lock order

The shared capture owner must acquire the scope clock `KEY SHARE` lock before
the active-head `SHARE` lock. Actual activation acquires the clock `FOR UPDATE`
before the head `FOR UPDATE`; both paths must follow clock then head without
weakening either lock. A head-first capture can hold head `SHARE` while waiting
on activation's clock lock, as activation waits on that capture's head lock.
That is a concrete lock cycle at the shared owner, affecting standalone and
retained finite capture, rather than a driver or adapter issue.

The reader obtains the clock through the existing
`lockScopeClockForSnapshotReadInTransactionEffect`, then passes that exact
transaction-local `ScopeClockRecord` to `captureApplicationReadinessInTransaction`.
The readiness helper consumes it without a second clock query. Its protected
before-epoch and `requireExactAuthority` placement remain after head capture;
the fix changes lock acquisition and stored-clock parsing, not the authority
owner or its lifecycle checks. Preserve exact target/scope/transaction correlation
and full readiness/protection. The clock lock is real and cannot be replaced by
an earlier autocommit or cross-transaction observation. Do not avoid the cycle
through retries, timeouts, weaker locks, adapter coordination or another transaction.

Missing or malformed stored clock now precedes a simultaneously missing active
head: existing `ScopeClockNotFoundError` or `ScopeClockCorruptionError` propagates
for both request-owned and retained capture, without readiness-operation remapping.
A well-formed foreign-authority clock still reaches `requireExactAuthority` only
after head capture; if its head is missing, `activeMissing` still wins. Record this
narrow changed precedence rather than promise the displaced head-first diagnostic
order. The transaction-local record is not a new public proof or cached verdict.

### Standalone refusal frontier and resource ownership

Bounded nullable capture defers authentication to the selected detached
canonical/function/task/schema/unique/durable order. Standalone missing durable
readiness remains `readReady`/`storedState`; missing revision, publication or task
evidence and unavailable unique readiness remain activation `notReady`. Finite
capture maps some states differently; reuse mechanics with explicit profile mapping.

The owner approves moving live physical readiness solely to the first fresh
business acceptance. This deliberately changes standalone diagnostic timing,
classification and precedence:

| Scenario | Displaced construction behavior | Selected behavior |
| --- | --- | --- |
| Healthy detached/durable evidence, physical state already invalid | Ordinary activation preparation refuses `notReady` before issuing selection | May issue an inert request token; existing fresh acceptance refuses readiness `authorityChanged` before any business work |
| Physical state invalid together with missing/corrupt durable readiness | Earlier physical `notReady` can win | Detached durable failure wins before acceptance; missing/corrupt readiness is `readReady`/`storedState` |
| Physical state becomes invalid between capture and acceptance | Requires current acceptance checks | The sole fresh accepting physical/build/coverage proof refuses with its existing `authorityChanged` outcome |

No global promise to preserve the displaced standalone refusal order applies to
this amendment. Ordinary executable `readActive`/`readReady`, retained finite and
relation profiles keep their existing contracts. Missing/corrupt canonical,
function/task/schema/unique/durable evidence retains the selected detached order
without eager physical validation. Inventory exact downstream error classification
and retry consumers before claiming cutover; no broad catch/remap, added retry,
fallback or duplicate physical preparation proof is selected.

An inert token permits no serving result, native business callback, hook, event or
durable contribution before full fresh acceptance. Preserve the existing admitted
callback SQL lifetimes. Expected failures, defects/interruption, sticky first Cause,
rollback-only behavior and cancellation settlement retain their existing owners.

Request tokens retain bounded request-owned evidence. They must not debit an
ambient host preparation lifetime or accumulate allocations across requests.
Finite retained active readiness must account for opaque unique/lifecycle evidence
through the existing `chargePhysicalDefinitionPreparation` owner, in addition to
visible canonical data. Token shape cannot measure opaque retained state. Close,
oversize, clone, wrong issuer and wrong lifetime refusals remain mandatory.

The selected connected correction replaces the source host's captured charge in
`prepareBindingSelectedStructure` with the authentic optional lifetime from the
Application evidence issuer. A retained structure is charged once to that issuer's
lease. The source still charges its own retained singleton to its own lifetime.
Disposable request entries remain weakly retained and bounded by canonical limits;
they carry no lease and cannot accumulate host allocations. The binding repository
checks issuer `checkOpen` on every use, including reuse and the path without a final
guard. Separate issuer/source closure remains effective at its actual boundary.
This adds no lease, cache or raised budget. Any further retained-state or lifetime
question must be investigated at the owner rather than legitimized as host setup;
a materially different authority/lifetime requires a focused amendment.

An actual Payload Local API witness exposes a second retained-accounting defect
at `applicationRelationReadinessFold.ts` `prepareActiveFold`: its visible charge
passes the requirements snapshot's defensive `manifestSha256` accessor to the
existing meter, which requires data-only values. Refusal occurs before the opaque
physical charge; that later charge is not the cause. The selected normalization
passes `requirements: { ...prepared.requirements }`, matching the existing active-
readiness data projection. Keep the generic meter's accessor refusal unchanged;
this adds no budget, adapter bypass, schema or authority contract. Preserve the
actual Local API witness and remove temporary diagnostic spies in the same slice.

## Alternatives and explicit decision boundaries

| Alternative | Disposition and reason |
| --- | --- |
| Generalize existing capture/detached preparation with request-owned standalone tokens | **Selected.** Removes repeated healthy assembly while retaining full acceptance and one readiness owner. |
| Ordinary `readActive` for every binding-only request | **Replace.** Its executable activation contract creates repeated pre-business work; genuine executable callers retain it. |
| Physical readiness in both detached request preparation and business acceptance | **Replace.** The approved standalone boundary authenticates detached evidence first and checks live physical state solely at fresh acceptance; retain that owner's existing refusal without duplicate proof or remapping. |
| Cache standalone binding/head across requests or charge it as host setup | **Rejected.** Changes freshness/lifetime and hides request cost. No such reuse or allocation contract is selected. |
| Narrow readiness to scalar/relation demand | **Deferred.** Changes unused-versus-used-definition refusal semantics and needs source/closure/pending/freshness witnesses. Full standalone and current finite source obligations remain. |
| Cheaper attestation or omitted physical/control checks | **Deferred.** Requires writer, reconnect/pool binding and enforced quiescence decisions. Current protection cannot certify mutable heads/builds, physical DDL or joint control/target state. |
| New validator/factory stack or adapter proof assembly | **Rejected.** Reuse the actual issuer, canonical preparation and accepting owners; consumers select business inputs and receive bounded contexts. |
| Root freeze, one-final settlement, terminal/recovery redesign | **Deferred.** No attempt, journal, sealed outcome, publication or durable-data contract changes in this slice. |

## Caller, compatibility and removal inventory

| Current contract/consumer | Selected disposition and completion gate |
| --- | --- |
| `applicationActivation.ts` binding-only legacy fallback and finite internals | **Replace/generalize.** One preparation owner with request/retained lifetimes explicit; remove displaced healthy binding-only `readActive` and finite-only shared-mechanic names after caller migration. Retain real finite profile methods and token identity. |
| Shared capture head-before-clock lock order | **Correct at the owner.** Acquire scope clock `KEY SHARE` before active-head `SHARE`, matching activation's clock-before-head order without weakening locks. Remove the head-first order and false unlocked-clock description; preserve deterministic concurrent activation/capture coverage and inventory the changed double-fault precedence. |
| `applicationReadiness.ts` captured rows and canonical/control preparation | **Extend/generalize.** Preserve complete authentication, profile-specific refusal mapping, fresh acceptance and opaque resource accounting. No copied validator or parallel engine. |
| `applicationRelationReadinessFold.ts` `prepareActiveFold` visible retained requirements charge | **Correct the owner.** Normalize its defensive-accessor snapshot to data-only requirements before charging, retaining opaque physical accounting and the actual Payload Local API witness. The generic meter keeps refusing accessors; remove diagnostic spies and retain existing relation behavior. |
| Standalone physical preparation refusal and downstream error/retry consumers | **Replace diagnostic/timing/precedence contract as selected above.** Inventory actual consumer classification and retry decisions, migrate affected expectations and prove no business work before refusal. Ordinary executable, retained finite and relation profiles remain distinct. |
| `applicationMutationAdmission.ts` finite Application admission | **Migrate.** Retain executable selection, actual retained lifetime, exact admission/claim/fence and close/resource behavior. |
| `commerceTransaction/host.ts` and `admission.ts` | **Migrate.** Request-owned legacy inputs accepted at existing owners; native Product results/errors and full logical readiness remain. |
| `cmsTransaction/host.ts` and `admission.ts` logical CMS/Payload paths | **Migrate affected legacy inputs.** Preserve relation-only input dispatch, actual Local API, mutable request/loader and hook/validation/rollback-only behavior. |
| `atomicCommerce/host.ts` and `admission.ts`, `crossDomainCommand/host.ts` | **Migrate.** Preserve full admission, constraints, one trusted outer settlement and original scope/source pins. |
| `logicalDocuments/sourceAdmission.ts`, participant/relational admission and prepared-source construction | **Migrate protection/lifetime derivation and exact token acceptance.** Use the authentic issuer lease for retained binding structures, retain the source's own singleton charge and check issuer closure on every use. Request tokens have no lease; full source membership/build/coverage/physical obligations remain. |
| Executable `readActive`, framework-binding executability, relation-only APIs and ordinary durable/recovery profiles | **Retain.** Real distinct contracts; no wrapper or dual binding-only engine kept to avoid migration. |

Inventory exact call sites, fixtures, internal exports and nominal token consumers
before changing signatures. Private construction types may break; migrate consumers
and remove obsolete constructors, exports, copied validators, fixtures and assembly
in the same slice. Native method/result/visibility/event and framework lifecycle
remain framework-owned. No stored row, journal/protocol format, public identity or
named durable data changes. A newly found schema, protection installation or data
obligation requires an explicit amendment. Silent deletion/reset and compatibility
layers are not authorized.

## Correctness and cost gates

Validate changed owners in fast PGlite and focused ordinary-role PostgreSQL.
PGlite proves full canonical reread/authentication, not protected login/trigger/
catalog integrity. PostgreSQL uses distinct connections for late head/readiness/
physical/build/coverage/revocation/generation changes and proves current final tail
and attestation. Preserve lock strength/order and post-lock time; no live verdict
crosses transactions.

Use a deterministic ordinary-role PostgreSQL witness against actual activation
and the shared capture owner to prove clock-before-head overlap without the
former lock cycle. Cover both standalone and genuine retained finite consumers,
preserve lock strengths and prove changed/invalid authority/head still refuses
before business use. Explicitly verify missing/corrupt-clock-plus-missing-head
precedence and unchanged well-formed foreign-authority/missing-head precedence.
PGlite cannot establish PostgreSQL lock compatibility or
concurrency behavior.

Witnesses cover missing/not-ready/corrupt readiness/canonical bodies, head mismatch,
head refresh on a later request, mid-request refusal without retry, late invalidation,
exact database/schema/scope/source/method pins, clone/wrong issuer/closed token
rejection, bounded resources, retained opaque charges and no request allocation
charged to or accumulated under a host lifetime. Prove the selected detached order
and standalone physical refusal frontier, full
Cause, rollback-only and cancellation cleanup. Prove capacity under request churn,
separate issuer/source close, reused/no-final-guard close refusal, sticky overflow
and exact token/pin rejection without a new budget, lifetime or cache.

Retain the actual Payload Local API witness for relation-fold requirements charge,
including successful data-only normalization and unchanged generic accessor
refusal. It proves the distinct connected relation consumer; native standalone
scalar/collection benchmarking does not execute that branch merely because its
source hash is inventoried.

Required standalone frontier witnesses include healthy detached/durable evidence
with already-invalid physical state, physical-plus-missing/corrupt-durable double
fault, between-capture invalidation, draining lifecycle, build/coverage loss and
no native business callback/hook/event/durable contribution before accepting
refusal. Verify exact owner error/classification and zero business work; retain
the original executable `readActive`/`readReady`, finite and relation regression
contracts. The replacement must not add a preparation physical check to recover
old precedence or remap the accepting error through a broad catch.

Run real standalone scalar/collection native parity and errors, the existing
Product/Application graph, actual selected Payload Local API and finite workflow
regressions proportionally to changed owners. Ordinary Application and independent
framework consumers retain affected coverage. Helper-only mocks or `payload.db.*`
calls cannot prove native lifecycle behavior.

The selected graph's cost gate is **one bounded target capture with configured
control authentication per standalone request, then one fresh business acceptance**.
Healthy assembly must not repeat ordinary `readActive`/`readReady` or reconstruct
the same immutable bundle. Count every control/unique/lifecycle read and transaction;
this is not an arbitrary two-transaction ceiling. Count all preparation in the
request ledger, with genuine pre-existing host setup separate. Moving work before
the native callback or timer does not remove it. Keep all dispatches/autocommits,
driver/server work, rows/pages/JSON bytes, allocations/encoding, reprepare/failures
and quiet request latency. No numeric ceiling or promised latency reduction is
selected before measuring the replacement.

Repeat matched quiet, trace and server diagnostics separately for real native
standalone scalar/collection, including complete request preparation. Retain the
finite component baseline. Full mixed measurements remain required at declared
group milestones and for cross-component/lifecycle contract changes. Assess the
explicit standalone diagnostic/timing/precedence amendment against those gates;
component improvement does not establish integrated acceptance.
Scaling, setup SQL/CPU/lock attribution and whole mixed performance remain open.
Missing instrumentation is unavailable, not zero.

Complete affected types/builds/source/portability guards, core/diff/staged lint,
both exact-checkpoint reviews, substantive-fix review reruns and cleanup. Root
coordinates and owns Git; workers own disjoint edits and reviewers remain read-only.
Acceptance requires migrated real callers, owner/consumer proofs, resource
disposition, measured cost reconciliation and displaced-path removal together.

## Remaining measured owner and future gates

Fresh business binding/Application acceptance is the largest remaining measured
region by dispatches and returned JSON bytes. It reauthenticates candidate/
publication/function/task/readiness bodies, including repeated readiness row
reads, after detached preparation. The concrete next construction investigation
belongs to `applicationActivation.ts` accepting composition and
`applicationReadiness.ts` `validateStoredIssuedReadiness`, with the actual registered
guard/full-proof contract traced before selecting any removal. Its measured region
includes session setup and framework binding work; not every dispatch belongs to
the canonical validator. The proposed
[fresh Application acceptance preflight](./fresh-application-acceptance-preflight.md)
records the complete statement/owner graph, actual protected guard eligibility,
alternatives and connected caller gates. Its runtime mechanism remains pending;
no cheaper accepting proof is approved here.

Full logical-source readiness is the largest metadata-row region, traversing
ordered, unique and search definitions plus table frontiers before the selected
Product read. Demand narrowing remains a distinct semantic decision with its own
used/unused, closure, pending-state, freshness and final-acceptance witnesses.
The artifact ledger owns exact region bounds, counts and bytes. These observations
do not establish CPU/lock causation or a reason to omit full proof.

The matched final-source comparison includes the corrected clock-before-head
capture owner; earlier head-first measurements remain separate immutable evidence
in the artifact ledger. It reports lower standalone assembly work and quiet latency
with unchanged selected native business demand, while retaining all accepting proof.

Retained finite semantics, complete mixed latency, scaling, populated relation
growth, setup/server CPU attribution and hosted activation remain separate open
gates. Bounded standalone improvement does not close the performance goal. Connected
validation, both reviews and cleanup remain mandatory slice gates; this document
records current contract and remaining ownership rather than chronological receipts.
