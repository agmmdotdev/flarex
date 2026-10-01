# Checked Reads: Component Preflight

Status: **group 1 active; first iteration delivered.** The real component baseline
and immutable preparation cut are delivered; checked-read SQL and latency work
remain. The implementation retains one lazily compiled singleton-read source
projection in its existing source preparation. It changes immutable mechanics
only; the exact-running kernel and fresh read contract remain
unchanged. Component measurements must establish the actual effect rather than
promise a speedup from phase totals.

## Outcome, Scope And Non-goals

Reduce evidenced work in real checked point, index/range and repeated reads while
preserving complete authentication, fresh transaction authority, exact original
snapshot hydration, pending/tombstone behavior and ordered dependencies. Deliver
the responsible core change with its affected Application and logical/native
consumers. A component harness exercises those existing APIs; it cannot reproduce
kernel or source-admission logic.

Initial scope is the existing bounded private finite profile. Standard
`durableOperations`, standalone native and recovery paths remain named regression
obligations. New query/search capabilities, developer APIs, new attestation,
maintenance certificates, wider resource limits, hosted activation and settlement
changes are excluded.

## Evidence And Responsible Owners

The [complete baseline](../../packages/flarex-backend/benchmarks/mixed-mutation-core/aggregate-entry/README.md)
groups 532 mixed execution dispatches: 14 bootstrap, 25 Application, 209 Product,
265 workflow and 19 Payload. Product-only data has 210 dispatches/ten
transactions and workflow has 265/thirteen. These include useful data work and
shared proof; they do not establish pure guard overhead, removable transactions
or a latency cause.

| Owner | Current obligation to trace |
| --- | --- |
| `transactionSessionActivation.ts`, `transactionSessionAttemptKernel.ts`, `scopeClock.ts`, `locatedReadCommittedEffect.ts` | Exact-running transaction, ordered locks and actual post-lock time; body/tail failure and decision provenance |
| `sessionJournalStore.ts`, `logicalDocuments/participantAdmission.ts`, `sourceAdmission.ts` | Original claim/fence/root, operation admission, source-wide fresh binding and readiness, dependency/evidence merge |
| `logicalDocuments/workingSet.ts`, `rootEvaluator.ts`, the journal's checked read transaction | Snapshot hydration, pending overlay, bounded point/range observations and repeated-read state |
| `appRows.ts`, `appIndexEntries.ts`, `logicalDocuments/indexReads.ts`, `relationalQuery.ts` | Actual rows/index pages, limits, visibility and exact dependency semantics |
| `applicationDocumentMaterialization/materialization.ts`, `pinnedPointTableResolution.ts` | Application point hydration and immutable deployment/schema/table pins; bootstrap remains real work |
| `indexBuildStates.ts`, `logicalStorageReadiness.ts`, `logicalSearchBuild.ts`, `preparedMetadataEpoch.ts` | Existing readiness/coverage issuers, physical proof and exact-transaction protected tails |
| Executor journal and native borrowed-attempt owners | Real operation routing, claim lifetime, framework semantics and cleanup; no database transaction across callbacks |

Verify concrete function names and caller obligations against current source
before attributing a query. Shared fingerprints and driver await are not server
CPU or pure lock duration. Count statements inside any server function/trigger
when observed; otherwise mark that work unavailable.

## Component Baseline Contract

Use trusted existing composition to create a real admitted attempt, authenticate
the complete initial evidence and run the original claim renewal/liveness owner.
Expose no raw transaction to benchmark callbacks. The measured operation invokes
the actual Application or admitted logical read owner and includes every fresh
check needed for that operation. Setup may occur before its timed interval, but
must have separate time/query/byte accounting and identical semantics in both
compared versions. It is not eliminated cost or a replacement for complete
request accounting.

Declare exact row/index definitions, candidate/schema, cardinalities, byte/page
limits, selected source/method, snapshot and pending state, PostgreSQL settings,
pool/concurrency, timer and sample policy. Distinguish the operations selected
for the iteration:

- point hit and miss, with unchanged missing-row/tombstone evidence;
- one supported index/range page, including its exact ordered dependency;
- repeated point/range reads inside one genuine attempt, distinguishing pending
  local results from each actual storage frontier;
- first and successive selection demands within an already prepared attempt,
  with uncached predicates and retained observations stated explicitly.

Cold/warm construction and operation comparisons remain future owner work when
selected by evidence. They require explicit reset rules; the first baseline
does not measure host cold/warm behavior or establish amortization equivalence.

Keep point/range input parsing, host construction, immutable preparation and
fresh SQL separately observable. Do not mix profiles, silently amortize a
single-use host, reuse a closed lease or reset liveness to hide setup. Bound all
rows, identities, driver payloads, pages, hydrated bytes and pending work using
existing owner limits. Include retry and contention work per successful result.

### Selected First Baseline

The first backend `checkedReadPerformance*.test.ts` component harness uses the
existing `afterProductBorrow` seam and the actual issued
`borrowed.context.table("product")` store. It calls the genuine `store.find`
with native manager predicates/order for a point hit, distinct uncached ID
misses, and handle-index hit/miss. A pending-local control is included where
the selected operation admits it. Returned data and dependencies must retain
the real Product adapter and checked-read owner behavior.

A narrow test-only `onPreparedContext` hook after genuine reusable host
construction and seeding, before initial attempt entry, separates setup while
keeping setup and authentication traceable. Each lane uses one genuine admitted
attempt. Each positive case has **one observation**. Each distinct ID-miss,
distinct handle-miss and pending-local case has **six untraced demands** (one
first and five successive) and **two traced demands** (one first and one
successive). These labels describe selection demands, not cold/warm host
construction. The handle hit follows the ID hit and retains its row observation;
the pending control follows the genuine native update. No cache is cleared.

The untraced lane adds no pool trace; existing fixture SQL observation remains
where present. The traced lane includes pool and named Effect diagnostics, so
its timing is not a quiet latency distribution. These small samples answer
attribution, not tail latency or production capacity. Capture actual fresh
checks, operations, bounds and dispatches; claim neither pure server CPU nor
decode time from driver duration.

The existing six-query exact-running kernel retains ordered locks and first
refusals. Logical reads use the exact kernel's `"attempt"` clock lock mode with
`NO KEY UPDATE`; Application read syscalls retain their `SHARE` mode. The
selected immutable source projection change removes no SQL or fresh check.

### Current Component Evidence And Limits

The [component artifact guide](../../packages/flarex-backend/benchmarks/core-performance/checked-reads/README.md)
owns the observation settings, source provenance and preserved evidence.
The [original PostgreSQL component evidence](../../packages/flarex-backend/benchmarks/core-performance/checked-reads/postgres-baseline.json.gz)
records actual fresh checked reads through the Product adapter. SQL counts below
come from the separate traced lane and remain unchanged in the matched candidate.
The artifact guide owns original and matched timing observations.

| Case | Traced dispatches / transactions per demand |
| --- | --- |
| First ID hit | 21 / 1 |
| Distinct ID misses | 20 / 1 |
| Handle-index hit after retained ID row | 20 / 1 |
| Distinct handle-index misses | 20 / 1 |
| Pending-local ID hit | 0 / 0 |

Positive cases provide no hit distribution. Initial full authentication and
renewal remain separately counted at **97 dispatches / four transactions**;
construction/seeding are outside operation samples, with elapsed time reported
separately and their SQL count unavailable. PGlite evidence is correctness only.
The native ID predicate uses a historical ordered index range; its positive
result also hydrates a historical row revision. It is not a single-statement
row point read.
The caller's named Effect tracer cannot observe source selection compilation
inside the owner's internal `runPromise` boundary. Compilation counts are
**unavailable**, not zero; the focused catalog owner witness establishes the
mechanism separately. Inclusive spans, awaited SQL intervals and complete transaction
durations do not establish isolated CPU, server execution or lock-hold time.

Preserve these original artifacts unchanged. The matched comparison uses a
separate baseline measured on the original runtime source with the final
component harness and direct-owner hash inventory, then the exact restored
candidate with that same harness. A minimal unnamed Effect function correction
does not authorize silently treating the original and final harness provenance
as identical. The matched graph, settings, cardinalities, returned JSON bytes,
ordered dispatch fingerprints, transaction outcomes and initial admission graph
are equal. The frozen harness and directly inventoried owner sources match
except for the intended source-admission implementation.

Matched successive miss timings are lower, but pending-local timings are also
lower despite having no database or source-compilation work. Those observations
do not establish a latency improvement caused by the retained projection.
The original baseline is close to candidate miss timings. This small paired
diagnostic supplies no whole-request latency acceptance or arbitrary speed claim.

## Challenged Alternatives And Decision Gate

Reject a fake attempt, a bare working-set benchmark that skips admission,
arbitrary cached live verdicts, weaker tail coverage, a new generic guard service
or adapter compensation. Repeated statements alone do not prove they can be
removed: session refusal must precede lease locking, lease before claim, and
post-lock time must remain authoritative. Existing exact-transaction issuers may
be reused only at their current provenance and freshness boundary.

### Delivered First Owner Change

`prepareLogicalSourceEvidence` owns one private lazy projection for the exact
requested singleton `[source.key]`. Its dependency closure may still include
related sources. Initialize at the existing `readiness.selectSources` position:
after `requirePrepared` and the exact same-transaction shared lookup, before
binding-head IO. Full selection and multi-source unions retain their existing
paths. There is no catalog-wide map, key registry, TTL, new public API or new
authority lifetime.

Prepare the immutable selection optimistically, then perform synchronous recheck,
captured host charge and successful install together. Only the newly retained
`sourceKeys`, `tableIds` and `reference` data are charged through the existing
captured preparation owner. Reused Application analysis, manifest and catalog
bodies are already charged and are excluded. The existing caller-owned
`maximumPreparedBytes` applies; no arbitrary new absolute cap is introduced.
Charge checks owner close, lease closing and sticky refusal before installation.
Failed charge or interruption before install retains no selection.

One descriptor is charged and retained per source preparation. Concurrent first
fibers may duplicate pure transient compilation; synchronous recheck allows only
one charge/install, without a semaphore wait inside SQL or sticky cached failure.
Later sequential singleton reads reuse the descriptor. With no preparation
host, the existing charge callback remains absent: retain at most that one
bounded descriptor and fabricate no lease. Every call still runs `requirePrepared`
and the inspector's original lifetime checks.

The owner witness invokes two actual concurrent first-read transactions and
observes one charge/retained descriptor, allowing one or two compilations.
Database locks may serialize those calls before compilation. It does not
deterministically exercise competing installs; the synchronous recheck, charge
and install boundary supplies that code-level guarantee. Sequential reuse and
concurrent-call behavior are distinct claims.

This reuses immutable selection mechanics, never a live verdict. Binding-head IO,
fresh selected readiness/physical checks, database time, deadlines, lock order,
first refusals and full protected tail remain unchanged. The existing
shared-transaction proof may return before initialization at its original
position. Repeated Product checked reads are the genuine consumer.

### Delivered Structural Contract

- Sequential singleton selection compilation changes **N to 1** per source
  preparation; concurrent first demands retain and charge exactly one descriptor.
  Four sequential actual reads compile once and perform four fresh inspections.
- Actual operation SQL and transaction counts do not increase. The six-query
  exact-running kernel and every fresh proof remain unchanged.
- Bounds, lease/close behavior, failed-charge/no-install, concurrent initialization,
  singleton closure and unchanged multi-source-union behavior have focused
  witnesses; no schema, durable format, public or identity contract changes.
- Compare the genuine component baseline and successor under the declared sample
  policy. Timing is observed; no arbitrary speed or whole-request benefit is
  predeclared. Keep missing CPU/server attribution explicitly unavailable.

The first iteration delivers immutable preparation reuse and the real component
baseline. It does not reduce checked-read SQL or establish a causal latency
improvement. Compare future work against the real operation baseline above,
not reconstructed mixed phase totals.

### Next Focused Iteration

Investigate dispatch composition in the existing six ordered attempt-kernel
queries and ten source/readiness queries before selecting a runtime change.
Inventory each query's owner, actual rows and fresh proof, lock/refusal order,
post-lock time and protected tail. Determine which composition, if any, can
reduce client dispatches while retaining those obligations and bounded payloads.
No fixed new SQL function, cached verdict, new authority or weaker guard is
selected by this direction. Record the concrete owner contract and focused
correctness/measurement gates before implementation. Group 1 remains active;
publication, admission and seal groups remain inactive and host changes conditional.

## Compatibility, Migration And Cleanup

Replace displaced internal composition when the chosen owner change warrants
it; migrate every real consumer and remove duplicate helpers, exports, fixtures
and stale claims in the same iteration. Retain ordinary Application, standalone,
OCC rerun and durable recovery readers for their real profile obligations. Do
not retain a wrapper or alternate read engine for a hypothetical caller. No
schema, codec, durable format or deletion is currently selected; a material
change requires explicit disposition before cutover.

## Validation And Completion

Focused PGlite and ordinary-role PostgreSQL witnesses must prove hit/miss,
pending/tombstone and range behavior, exact dependencies and byte limits; wrong
scope/issuer/fence/profile; required versus unrelated readiness; unchanged-digest
corruption; post-wait revocation/deadline/head changes; first failure/root poison;
tail refusal; interruption/cleanup and existing recovery. Preserve exact lock
order/strength and no SQL across native execution. Reuse existing decisive tests
and add only witnesses for a changed risk.

Run affected type/source guards and lint, both final project reviewers,
substantive-fix reruns, cleanup and a scoped commit. Compare quiet traced component
structure and matched untraced first/successive demand observations under the
declared construction policy, retaining all samples and outliers. A declared
group milestone, cross-component or lifecycle contract
change triggers the mixed performance integration checkpoint. Bounded connected
consumer correctness remains required each iteration; an immutable compilation
improvement with unchanged SQL does not alone require a full 208-sample run.
Completion requires the real owner optimization, migrated consumer proof,
cleanup and agreed component budget. Whole latency acceptance remains separate.
