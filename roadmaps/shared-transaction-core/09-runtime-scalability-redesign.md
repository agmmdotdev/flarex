# Runtime Scalability Redesign

## Status And Scope

Status: owner-requested redesign direction, with a concrete replacement proposal
and acceptance gates. Runtime implementation, database validation, measured
improvements, and activation are pending. This document changes no executing
lock order, isolation level, admission rule, resource limit, or framework API.

The owner is willing to change the early-development design rather than preserve
an inefficient internal contract. Use clean replacement where the actual
shipped-state inventory permits it; do not invent a backward-compatibility
obligation or delete a named persistent environment without inspecting it.

The coherent outcome is efficient, confined framework execution over Flarex's
existing authoritative Postgres store. Ordinary selective operations must not
require a small total catalog, and unrelated business work should not hold the
publication sequencer for its entire execution. Medusa is the motivating
consumer, not the owner of this correction.

The [accepted design](../../design-notes/flarex-db-accepted-design.md),
[current framework transaction contract](../flarexdb-framework-integration/04-transactions-and-commit-publication.md),
and [shared-core roadmap](./README.md) remain authoritative for executing
behavior. This proposal identifies the explicit changes needed before those
contracts can be reconciled. It does not reopen completed physical-owner and
CMS materializer extractions or require a universal transaction engine.

## Recommended Architecture

Keep one authoritative database and one publication/recovery owner, with
separate semantic execution profiles:

| Profile | Retained responsibility | Proposed improvement |
| --- | --- | --- |
| Native Application | Restricted sandbox calls, exact snapshots, dependency tracking, logical journal and OCC | Preserve semantics; coordinate its commit owner in any shared lock-protocol change |
| Payload/CMS | Native Local API lifecycle, access and validation, supported hooks and nested request reuse | Benefit from shared transaction/publication corrections without moving CMS into commerce tables |
| Medusa atomic command | Admitted module services and Links inside one bounded physical transaction | Operation-bounded SQL, efficient preparation/admission and narrow concurrency protection |
| Durable workflow | Explicit committed steps, recovery, waits, external effects and compensation | Extend existing Task/workflow owners where their contracts fit; never keep a business transaction open across steps |

Framework adapters translate native inputs, outputs, relationship semantics,
errors and lifecycle events. Core owns SQL confinement, resource accounting,
transaction lifetime, mutation evidence, authoritative settlement and recovery.
Common guarantees do not require identical physical rows or query languages.

Do not rewrite working Medusa business logic to hide a core limit. Do not pass
raw SQL, a driver connection, a transaction, or a finalizer to framework callers
or untrusted application code.

## Source-Grounded Findings

These are source findings, not fresh timing or throughput measurements.

| Current owner | Observed behavior | Implication |
| --- | --- | --- |
| [Commerce store](../../packages/persistence-postgres/src/commerceTransaction/store.ts) | `catalogBound` measures up to `catalogRows + 1` scoped rows, independently of a requested business predicate; `find` and `count` call it first | A selective lookup performs unrelated catalog work and can refuse because the table is too large |
| [Commerce resources](../../packages/persistence-postgres/src/commerceTransaction/resources.ts) | Catalog and query ceilings are coupled; admission requires `queryRows >= catalogRows` | This is a complete-small-catalog contract, not merely a per-query safety budget |
| [Atomic host](../../packages/persistence-postgres/src/atomicCommerce/host.ts) and [commerce host](../../packages/persistence-postgres/src/commerceTransaction/host.ts) | The scope clock is locked before admission and business execution; standalone commerce reads use a shared clock lock | Same-scope independent work contends on publication state; this is not a database-global mutex |
| [Prepared installation](../../packages/persistence-postgres/src/frameworkSchema/installation/runtime.ts) and [runtime evidence](../../packages/persistence-postgres/src/frameworkSchema/installation/runtimeEvidence.ts) | Preparation is already separate, but acceptance freshly fingerprints installation evidence across 16 metadata sections | Small hash transport does not eliminate database hashing/aggregation work |
| [Atomic execution](../../packages/persistence-postgres/src/atomicCommerce/execution.ts) and [commerce store](../../packages/persistence-postgres/src/commerceTransaction/store.ts) | An outer participant call constructs its store set; immutable table mechanics and mutable observations are assembled together | Profile immutable preparation before considering a pure-plan extraction; never cache mutable request state |
| [Relation population](../../packages/medusa-adapter/src/commerce-relations.ts) and [read executor](../../packages/medusa-adapter/src/query/read.ts) | Parent IDs are already batched, but complete relation reads rely on the catalog bound | Preserve batching and replace the completeness proof together with catalog-bound removal |
| [Workflow foundations](../workflow-foundations/README.md) | Current connected workflows are selected private atomic capabilities; durable events already have an owner | Atomic completion and durable event delivery do not establish resumable multi-commit workflow execution |

The installation redesign must not be undone or confused with this request-path
work. Installation timing, prepared-host construction, warm admission, business
SQL and publication are separate measurements.

The runtime evidence query selects dependencies of the prepared installation
through captured root IDs, plan IDs and physical names; it does not scan every
installation's history indiscriminately. Repeated hashing is source-confirmed,
but its share of request latency is unmeasured. Measure selected dependency
size and unrelated historical growth separately before attributing cost.

## A. Replace Total-Catalog Budgets With Operation Budgets

### Contract

Separate total stored data from the work one request may perform. A query for
one product must not fail solely because other products exist. Replace the
`queryRows >= catalogRows` requirement in the selected runtime contract rather
than raising its numeric ceiling.

Use independently admitted budgets for returned rows/bytes, affected rows,
relation expansion, predicate/parameter complexity, retained intermediate
values, facts/events, actual SQL statements and total request duration. Values
come from trusted profiles, not request-supplied overrides. Preserve sticky
resource refusal, cancellation and rollback-only behavior.

A `LIMIT` bounds output, not the database work required to find, sort or count
it. Indexes, bounded predicates, execution deadlines and actual query-plan
measurements remain necessary. Do not advertise a hard scanned-row budget that
the driver cannot enforce, or a constant-time arbitrary filter.

### Reads And Relationship Completeness

Push scope, predicates, projection and ordering into SQL. Obtain a bounded
result and its overflow/byte evidence from one statement snapshot where
possible. Reject oversized materialized output before sending unbounded data
through the driver. Account for database defaults, numeric expansion and
representation differences, not only caller input size.

Distinguish a deliberately paginated result from a complete relationship set.
For complete sets, fetch a bounded overflow witness, such as one extra matching
row, and fail explicitly on overflow. Never silently truncate a relationship
and present it as complete. For pages, preserve the native page/count envelope.

Use joins or `EXISTS` for admitted relation predicates where appropriate; do
not require materializing every matching foreign ID in JavaScript. Retain
batched parent-ID population for paths where it is the better plan. Bound
fan-out per edge and over the complete graph, including shared children.

Preserve native offset and count semantics when the caller requests them.
Keyset pagination is useful only through an explicitly supported contract; it
is not a transparent replacement for arbitrary offset requests. Avoid counts
only on APIs that do not require them. A `listAndCount` replacement must retain
a coherent rows/count snapshot after removing scope-wide exclusion.

### Writes

Enforce row representation limits at the authoritative write boundary. Select
and bound candidate keys before issuing an unbounded mutation; keep selection,
locking, DML, overflow validation and publication inside one owner. An affected
row limit must not mean updating an unlimited table and checking afterward.
Cascades, pivot changes, managed timestamps and defaults need complete evidence
and aggregate budgets too.

Rework upsert/update classification under concurrent writers. Existing
pre-read classification must not become stale when the scope mutex is removed.
Use supported locking/conditional SQL and authoritative affected-row evidence;
do not infer inserted-versus-updated semantics from PostgreSQL tuple-header
implementation details. Preserve no-op handling and native event correlation.

Optional storage quotas are a different feature. Do not replace repeated
catalog scans with a new mandatory tenant-wide quota mutex on every write.
Any strict quota counter must have its concurrency cost and enforcement policy
specified independently.

### First Connected Exit

Run actual Product and Link operations on a table larger than the old 4,096-row
catalog ceiling, including selective reads, updates, complete small relations and
intentional relation overflow. Preserve native assertions, row-size refusal,
late rollback, scope isolation, replay and event/fact completeness. Updating
only the resource schema or deleting `catalogBound` does not complete this gate.

## B. Separate Prepared Structure, Live Authority And Integrity Audit

Reuse `prepareInstallationRuntime`; do not add a second preparation registry.
Capture pure schema/query/write mechanics once per exact immutable definition.
Share only immutable plans, never managers, mutable native DTOs, request-local
observations, dependency verdicts, transaction handles or tenant data.

A prepared plan is not current authorization. Each execution must still prove
scope, physical placement, installation/binding identity, generation and
revocation state through the trusted owner. Cache keys must include every
behavior-changing definition/profile revision. Bound retained cache memory and
host multiplicity; a per-entry limit alone does not bound many tenants.

The recommended target is a small fresh admission check against a protected,
versioned readiness root, with structural verification at preparation,
activation and explicit integrity/recovery boundaries. Its prerequisite is a
written, enforced immutability and invalidation contract: every legitimate
change to protected evidence must change/fence that root before execution can
accept the changed state. Stale, missing or unavailable roots fail closed.

### Explicit Security Tradeoff

Rehashing all referenced rows on every request detects some out-of-band
metadata changes immediately. A constant-size root check cannot offer that
same guarantee against a privileged actor that edits dependencies while
leaving the root unchanged. A stored checksum or an in-memory success flag does
not solve this problem.

Choose and document the hot-path threat model before replacing evidence reads.
Under protected immutable metadata, restricted roles and fenced control-plane
writes, full verification can move to lifecycle/audit boundaries. Arbitrary
privileged corruption then has an explicit audit/detection policy, not an
unspoken per-request guarantee. If immediate detection of arbitrary such
changes remains required, retain the necessary evidence verification and
measure its cost. Do not silently weaken the current contract for speed.

This gate requires ordinary-role enforcement and explicit privileged-tamper
scenarios as well as cold/warm measurements. Existing integrity tests must be
preserved or deliberately relocated under the new, named contract.

### Required Integrity Decision Before R2 Implementation

R2 must first record the selected guarantee in the accepted design and the
owning installation contract. A root check remains a proposal until that
decision specifies the following:

| Decision | Required contract and evidence |
| --- | --- |
| Protected dependency set | Name the immutable definitions, sealed child sets and mutable authority/progress fields that prepared execution depends on; reuse their existing owners. |
| Permitted mutations and roles | Enumerate legitimate writers and the database protections that prevent ordinary roles from modifying protected evidence outside those paths. |
| Invalidation and enforcement | Name the existing transition owner and specify how every permitted dependency change fences or replaces readiness before changed state can be accepted, including concurrent execution. |
| Privileged corruption | Choose immediate request refusal or detection at named verification/audit boundaries; state the detection interval or triggering event, execution policy before detection, and fencing/recovery action afterward. |
| Regression disposition | Map each existing integrity witness to unchanged refusal or an explicitly approved new detection boundary; prove ordinary-role enforcement and privileged edits with an unchanged root. |

The recommendation is protected immutable metadata with fresh authority checks
and explicit verification boundaries, conditional on that enforcement proof.
If the required guarantee remains immediate detection of dependency corruption,
retain the necessary evidence checks. A performance target does not authorize
choosing a weaker guarantee or silently relocating a refusal test.

## C. Decouple Execution Protection From Publication Serialization

### Two Responsibilities, Not Two Commit Authorities

Recommend separating rarely changed execution-fence state from the frequently
updated publication sequence. A stable scope/generation/binding fence can be
shared by admitted concurrent operations; rare activation, revocation,
retirement or migration transitions need exclusive protection. Publication
still has exactly one canonical scope-local sequencer.

A separately protected fence row is a candidate physical implementation, not
an already approved schema spelling. Inventory existing scope-authority owners
before adding a row or duplicating epoch/generation state. The correction must
have one authoritative transition owner and make every relevant writer obey
its fencing protocol.

The proposed mutation lock hierarchy is:

```text
stable execution fence / binding protection
  -> request-identity exclusion or authoritative outcome resolution
  -> deterministic business-invariant and row locks
  -> short canonical publication lock
  -> append complete facts, outcome, event intent and wake
  -> authoritative COMMIT
```

After acquiring the publication lock, do not acquire new business/invariant
locks or run native callbacks. Sequence allocation, publication completeness
and settlement remain with the existing publisher. A database sequence alone
is not a replacement: it does not establish the required committed feed order.

A short final serialized section is acceptable. This design does not promise
unlimited throughput for one hot scope or one hot inventory item.

### Consistency Must Be Replaced, Not Removed

For trusted relational mutations, assess `READ COMMITTED` with explicit
invariant/row locking, conditional updates and constraints as the initial
concurrent execution profile. For example, an inventory reservation must
atomically test availability and decrement it, or lock the relevant inventory
invariant before reading and deciding. Ordinary independent reads followed by
an unconditional write are not sufficient.

Some native operations span multiple rows or predicate-defined sets. Inventory
those decisions and give them a supported narrower lock/validation strategy;
otherwise keep that capability unadmitted. Do not pretend foreign keys alone
prevent lost updates, write skew or conflicting business decisions. Native
Application OCC keeps its existing dependency/history semantics.

### Required Invariant Contract Before R3 Implementation

`READ COMMITTED` plus narrower locks is a candidate strategy, not a complete
execution contract. For every operation admitted to concurrent execution,
trace the native reads and decisions currently protected by scope exclusion.
Record the invariant, its framework owner, the shared persistence capability
that enforces it, when protection starts, and the decisive concurrent witness.
At minimum, cover these cases where the selected operations require them:

| Decision pattern | Required replacement proof |
| --- | --- |
| Read, decide, then update | Protect or validate the decision's inputs before applying its effects; locking only at the eventual write cannot repair an earlier stale decision. |
| Missing row or predicate-defined set | Handle concurrent insertions and membership changes; locking the rows already found is not proof that an absent row or complete set stays unchanged. |
| Multi-row or cross-module invariant | Define the complete protected key/set domain and acquisition order across participants; discover additional keys without reversing the common order. |
| Upsert, lifecycle or Link mutation | Derive classification, affected rows, managed changes and emitted facts/events from the protected authoritative outcome. |
| Coherent page/count or populated graph | Define one supported snapshot/validation boundary; separate statements at READ COMMITTED do not by themselves provide a coherent multi-query read. |

Framework owners retain the business meaning. Core supplies the narrow shared
enforcement capabilities through trusted admission, without per-module locking
workarounds, raw lock handles for callers, or a speculative universal invariant
registry. Ground each capability in a real consumer and reusable persistence
semantics. Operations lacking a proven replacement remain outside the new
concurrent profile; they must not use an automatic clock-first fallback over
the same resources.

Use distinct-connection PostgreSQL barriers to force the decision/write races,
not only tests that show independent writes can overlap. Cover duplicate
requests, absent-row insertion, conflicting membership changes and failure
after a protected decision where those scenarios apply. Preserve existing
native assertions and publication/recovery witnesses.

### Read Snapshot Boundary

For coherent standalone relational graph reads, evaluate a repeatable-read
snapshot with a read-only data capability, not a shared lock on the publication
clock. A read nested in a mutation keeps that mutation's transaction and pending
writes. If a fence implementation needs `SELECT ... FOR SHARE`, account for the
fact that PostgreSQL SQL-level `READ ONLY` disallows row-locking selects; a
read-only capability and a SQL `READ ONLY` transaction are different contracts.
Bind any returned snapshot/commit metadata to the actual read snapshot.

### Reject A Tempting But Incorrect Shortcut

Do not simply switch every writer to `REPEATABLE READ` or `SERIALIZABLE` and move
the clock update to the end. Concurrent transactions that all update the same
clock row can incur serialization failures when that row changes after their
snapshot. That can turn mutex waiting into repeated full-command retries.
Serializable isolation is not automatically a throughput improvement.

Any explicitly selected retryable SQL profile must prove callback replay
safety and bounded retries. Do not automatically replay arbitrary Payload
hooks, Medusa callbacks or external operations. A confirmed transaction abort
and an uncertain COMMIT acknowledgement are different failure classes.

### Cross-Owner Cutover Is Mandatory

Existing clock-first publishers and proposed row-first publishers must not run
concurrently over shared resources without a proven common order. Otherwise,
one can hold the clock while waiting for a row held by another waiting for the
clock. Inspect Application, CMS, commerce, named cross-domain commands,
activation, migration, retention and delivery paths that touch these resources.

Select one protocol for every affected writer in a scope. For disposable
unshipped scopes, drain/reset and cleanly activate the replacement rather than
building permanent dual execution. Preserve exact replay/issued-identity
obligations where the real inventory establishes them. Failure to satisfy the
new protocol must refuse, not fall back to an independent transaction.

Include pool/admission wait, evidence checking and publication in an outer
request deadline and telemetry; bound cleanup separately while preserving the
original failure. Per-statement and callback deadlines alone do not bound the
complete request.

## D. Preserve Atomic Commands And Add Durable Steps Deliberately

A database-only atomic group can borrow one transaction and publish once. A
workflow involving a provider call, suspension or independent recovery needs
committed steps. Select the execution mode at trusted definition/admission
time; exceeding a limit must never silently change its atomicity.

Reuse the [workflow foundations](../workflow-foundations/README.md), existing
[Durable Task Engine](../durable-task-engine/README.md),
[durable event owner](../workflow-foundations/07-durable-workflow-events.md),
and [publication participant](../../packages/persistence-postgres/src/commerceTransaction/publication.ts).
Do not introduce a second generic scheduler, result ledger or commit authority
merely to support Medusa syntax. Record actual missing contracts first.

A local durable step needs its business effects and authoritative completion
result to be committed together, or a precise idempotent command/outcome
handoff that the execution owner can reconcile. A crash between a business
commit and an execution-engine acknowledgement must not blindly repeat the
business work. Resumption pins the original definition, inputs and outcome
identity, including after current deployment heads change.

External effects execute outside business transactions with a stable persisted
intent/idempotency identity. An attempt number must not turn a retry into a new
provider operation. Lost acknowledgements require provider idempotency or
reconciliation; neither fenced delivery claims nor PostgreSQL can guarantee
exactly-once effects in an arbitrary external system.

Preserve native compensation inputs, order and failure semantics for the
admitted durable workflows. Compensation is new committed work and may fail;
it is not the rollback of an already committed SQL transaction. Child workflow
syntax does not itself establish a durable checkpoint or a new atomic boundary.

Existing private durable event delivery is useful infrastructure, not a missing
feature to reimplement. Add retention/pruning and production delivery admission
through its owner; do not indefinitely retain every completed event-bearing
commit by accident. Event completion and workflow completion remain distinct.

## E. Framework And Host Boundaries

Preserve Payload's Local API path, access checks, validation, supported hook
ordering and nested `req` transaction propagation. Do not call storage directly
to bypass native behavior, move every `afterChange` hook after commit, or enable
arbitrary hooks in a replaying transaction. Improvements to shared publication
benefit CMS without falsely claiming that its query path is the commerce store.

Preserve Medusa module ownership, stored Module Links, metadata handling,
managed lifecycle and module-versus-workflow event distinctions. Broader graph
queries need explicit linked-filter, population and pagination compatibility
proofs. Do not flatten them into one giant join or emulate complete scans in
adapter JavaScript simply because a query form is not yet admitted.

Keep trusted framework/database work co-located inside the trusted executor
where possible; do not introduce a Worker RPC per repository operation as an
incidental adapter change. Preserve Cloudflare's request-scoped client and
cache-disabled Hyperdrive target. Node/PGlite tests do not prove deployed Worker
behavior or remote round-trip performance.

## Replacement And Cleanup Inventory

| Owner or behavior | Disposition | Retirement / completion rule |
| --- | --- | --- |
| Postgres authority, native OCC semantics, framework lifecycle and shared publication | Retain | Preserve existing correctness and recovery witnesses |
| Coupled total-catalog/query budgets and catalog payload scans | Replace | Switch all admitted consumers after operation bounds and complete-set overflow proofs; remove displaced guards from the selected runtime |
| Existing preparation registry | Extend where measured | Retain one owner; remove repeated pure compilation only after equivalent plan/identity tests |
| Per-request installation evidence reconstruction/hashing | Conditional replacement | First establish protected metadata and an explicit integrity threat model; never keep an undocumented weaker fast path |
| Whole-business-operation scope-clock exclusion | Replace through coordinated protocol | Complete lock/invariant inventory and cross-owner PostgreSQL proofs; no mixed-order fallback |
| Current atomic workflow interpreter | Retain for its semantic purpose | Not a legacy implementation merely because durable execution is added |
| Durable workflow capability gaps | Extend existing owners | Real multi-step recovery/compensation proof; no duplicate scheduler or ledger |
| Old adapters/profile exceptions superseded by these corrections | Delete after consumer switch | Preserve only an evidenced supported compatibility obligation, not old fixture shape |

Do not delete the safety assertion when its implementation changes. Translate
old total-catalog refusal tests into operation-overflow tests, and preserve
row/byte, scope, complete-fact, cancellation, replay and corruption coverage.
Append-only migration policy and named durable environments retain their
existing obligations until a specific inventory authorizes a reset/conversion.

Each replacement gate includes its consumer switch, safety-witness migration,
displaced-code removal and owning-roadmap reconciliation. R1 must retire the
old catalog guards for its selected runtime; R2 must leave one explicit
integrity contract; R3 must complete its coordinated lock-protocol cutover.
Any retained path needs an evidenced compatibility obligation, named owner and
retirement condition. Do not defer ordinary cleanup from R1-R3 until R5 or until
a durable workflow is implemented. R5 audits the completed replacements and
their remaining obligations; it is not the first cleanup or cutover step.

## Implementation Order And Decisive Proofs

| Gate | Coherent deliverable | Acceptance evidence |
| --- | --- | --- |
| R0: full request attribution | Instrument existing physical/request owners, not only adapter method counts | Cold preparation, admission SQL, catalog checks, business SQL, lock wait/hold, publication, cleanup, database/host memory and bytes distinguished |
| R1: operation-bounded storage | Replace catalog-dependent reads/writes and relationship completeness together for selected real consumers | Actual native Product/Link calls on larger tables; no unrelated catalog payload guard; deliberate overflow, rollback and replay remain correct |
| R2: execution readiness | Extend existing prepared owner after the explicit integrity decision and enforcement proof | Warm admission cost measured against selected dependency size and unrelated history separately; any root-only path meets the agreed cost target; stale binding/revocation refusal and privileged-tamper outcomes match the accepted contract |
| R3: concurrent publication | Implement one cross-owner fence/row/publication order after the operation-level invariant contract | Distinct-connection PostgreSQL barriers prove independent operations overlap and protected decision/write races stay correct; mixed CMS/Application/commerce tests, activation races and lost COMMIT recovery pass |
| R4: durable workflow integration | Admit one real multi-commit consumer through existing execution and outcome owners | Crash/resume between steps, lost acknowledgements, stable external intent, cancellation, compensation failures and pinned revision recovery |
| R5: final reconciliation | Audit the consumer switches, coordinated cutovers, removals and roadmap reconciliation completed within each preceding replacement | No deferred routine cleanup, unowned fallback, duplicate recovery/commit owner, undocumented security downgrade or stale conformance-only production claim |

R0/R1 are the first implementation target: attribute complete request cost, then
replace catalog-dependent storage and relation completeness together for real
Product/Link consumers. Preserve current scope locking and integrity checks
through that slice. R2 and R3 require separately approved integrity and
concurrency contracts; recording this direction does not approve their runtime
changes. R4 is selected when a real workflow requires durable execution; simple
atomic workflows need not become sagas. Runtime work starts only after its
focused implementation preflight is approved.

Run the fast PGlite semantic lane and ordinary-role real-Postgres lane. Genuine
Postgres is required for concurrent connections, locks, isolation, SQL plans,
DDL races and settlement claims. Preserve the pinned native module/workflow
assertions and Payload Local API regressions. Add affected typechecks, source
provenance, builds, lint and both project reviewers before runtime commits.

Suggested measurement matrix: 256, 4,096 and 100,000 rows, then a larger target
where resources permit; small and high-fan-out graphs; independent keys and hot
keys; one scope and multiple scopes; and concurrent CMS/native publishers.
These are proposed experiments, not supported scale claims. Predeclare latency
and resource thresholds before changing code. Publish p50/p95/p99, errors,
retries, actual statements, buffers/rows, bytes, CPU and memory, not just a
single speedup number or raised call allowance.

Use deterministic barriers rather than sleep-based timing alone for concurrency
correctness. Include exact duplicate requests, conflicting identities,
interruption during a driver operation, stale capabilities, expired results,
post-commit delivery failure and loss of commit acknowledgement. No successful
prefix, callback return or event-buffer insertion may be reported as COMMIT.

## Primary Semantic References

The pinned framework source and existing admitted test cases govern executable
compatibility; current public documentation is explanatory, not a dependency
upgrade or permission to broaden the private profile.

- [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html): conflicting row locks, transaction lock lifetime and consistent ordering.
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html): statement snapshots and serialization failure behavior.
- [PostgreSQL SET TRANSACTION](https://www.postgresql.org/docs/current/sql-set-transaction.html): SQL read-only restrictions and isolation controls.
- [PostgreSQL read-only enforcement](https://doxygen.postgresql.org/execMain_8c_source.html): executor permission checks for row-locking statements.
- [Medusa compensation](https://docs.medusajs.com/learn/fundamentals/workflows/compensation-function): native compensating step behavior and inputs.
- [Payload transactions](https://payloadcms.com/docs/database/transactions): native request and Local API transaction propagation.

This proposal contains no fresh benchmark result and does not claim that any
runtime replacement or production activation is complete.
