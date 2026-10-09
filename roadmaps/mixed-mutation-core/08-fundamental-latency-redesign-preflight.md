# Fundamental latency redesign for finite mixed attempts

Status: **private finite-root implementation delivered; proposed latency goals
unmet.** The
request-scoped CPU diagnostic harness is implemented and its
[retained records](../../packages/flarex-backend/benchmarks/mixed-mutation-core/fundamental-latency/cpu/README.md)
and the [finite-root measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/fundamental-latency/finite-root/README.md)
inform the next owner choice. This preflight records the accepted connected
attempt/admission/recovery contract and its remaining gates. The
[accepted prepared execution integrity rule](../../design-notes/flarex-db-accepted-design.md#prepared-execution-integrity)
permits the first protected exception for the ten legacy target Application
tables described below, under its authenticated writer contract and final
acceptance guard. All other selected evidence remains freshly verified. A
durable format change, pooled Worker invocation, or moved framework effect
requires its own connected proof under this preflight.

## Outcome and measured reason

The exact existing warm private fixtures remain the target: seeded Product
**update** with Application work; that graph plus Payload `posts` native Local
API create, update and find-by-ID with its supported nested hook; and those
operations plus the finite Product/Pricing/Link/Tag workflow. The separately
settling standalone workflow is a regression witness, not a mixed parity
equivalent. Preserve their business assertions, graph size, request boundaries,
ordinary PostgreSQL role, fresh Worker comparison, deadlines and retained
outcome checks. Do not relabel Product update as Product creation or compare a
smaller replacement fixture to these targets.

The [selected-evidence measurements](../../packages/flarex-backend/benchmarks/mixed-mutation-core/selected-evidence/README.md)
show 104/104 successful full untraced requests, with warm outer medians
**2.271 / 3.303 / 6.699 / 0.338 s** (Product, Product plus Payload, mixed,
standalone). The earlier [proposed warm budgets](./06-low-latency-execution-preflight.md#proposed-budgets-not-accepted-targets)
are p50 **100 / 200 / 500 ms** and descriptive p95 **200 / 400 / 1,000 ms**
for the three mixed graphs, and a standalone regression ceiling of 400 ms p50
and 1,100 ms descriptive p95. These are product proposals, not proven feasible
service guarantees. The present Product and mixed medians need about 22.7x and
13.4x reductions to reach 100 and 500 ms. Fresh Worker construction itself has
about an 84 ms warm median in the full mixed series, inside the request interval.
The 100 ms Product proposal therefore needs an explicit host-lifetime decision
and measured remaining authority/durability lower bound.

The completed [07 package](./07-selected-evidence-admission-preflight.md)
reduced the mixed traced smoke from 10,410 to 9,958 SQL dispatches with 235
transaction intervals unchanged; the full untraced endpoint showed no overall
gain. In the two warm selected-evidence traced smoke points, mixed request
spans were 7,377.1 and 7,025.4 ms. Observed SQL dispatch-wait union was
3,186.2 and 3,003.9 ms; the remaining 4,190.9 and 4,021.5 ms is **unattributed
wall time**, not measured CPU or native framework time. Observed checkout was
5.9 and 5.6 ms. Request admission took 228.8 and 252.4 ms; Worker dispatch
6,350.5 and 6,053.2 ms; seal/OCC 95.5 and 91.2 ms; authoritative publication
424.3 and 425.1 ms. These are nested phase intervals, not additive costs.
The 235 transaction intervals include 104 in native workflow, 52 Product
update, 11 Product retrieve, 11 Payload create, 16 find-by-ID, 10 update and
the remaining admission, Application, sealing and publication boundaries.
Seven outer native calls account for only 21 journal-triad transactions, about
9% of the 235; replacing that triad alone cannot address the 104 workflow and
52 Product-update intervals that contain checked reads. The first connected
design therefore needs root-wide snapshot/pending reuse and cheaper *fresh*
live metadata admission along with any justified journal correction.
The [admission-cost full traced series](../../packages/flarex-backend/benchmarks/mixed-mutation-core/admission-cost/traced/manifest.json)
has a mixed warm median 6,754.8 ms request span, 2,889.2 ms observed SQL wait
union and 3,865.6 ms unattributed remainder. This confirms that another small
query-shape cut cannot by itself justify a millisecond endpoint promise.
The separate Node Inspector diagnostic, excluded from latency acceptance,
samples roughly 1.4 s Effect, 1.1 s Drizzle, 0.5–0.6 s persistence and 2.4 s
idle leaf weight in each of two mixed warm profile windows. It also samples
0.3–0.5 s Inspector overhead and includes profiler setup outside invocation
wall. These are disjoint approximate profile-window weights, not request CPU
components or proof that a library must be replaced. Repeated admission and
SQL construction are the first connected owners to challenge; current
search-write, OCC and scope-clock ideas remain unranked without their missing
server/lock/WAL evidence.

## Delivered finite root and measured outcome

The private selected Application/Product, Payload and finite workflow graph now
uses one fenced, bounded evaluator across its provisional calls. Trusted
activation records `finiteRoot`; existing independently durable callers retain
`durableOperations`. Child results stay local until an aggregate successful
seal or early relation-conflict terminal transaction. A lost final COMMIT is
resolved from authoritative stored evidence; an abandoned preseal evaluator
cannot be resumed under its old fence. The first protected preparation covers
only the ten legacy target Application tables through an invalidating epoch,
attested installation, and an authenticated restricted runtime login. Final
settlement retains its live guard, and framework, physical, relation and
control evidence still take their fresh paths. No named environment or public
authoring API is activated by this package.

The [retained finite-root series](../../packages/flarex-backend/benchmarks/mixed-mutation-core/fundamental-latency/finite-root/README.md)
uses the same four business graphs and local PostgreSQL host as the prior
selected-evidence comparison, with a newly restricted per-fixture runtime
login. The first traced smoke overlapped a repository root inventory scan;
all its timing samples are retained but excluded from latency conclusions.
The clean trace has 16/16 successful samples and warm SQL dispatch/transaction
counts of 2,748/85 Product, 3,802/112 Product plus Payload, 7,228/205 mixed
workflow, and 470/6 standalone. The full 104/104 untraced run has warm outer
p50 of **1,758.7 / 2,420.2 / 5,284.0 / 342.7 ms**, descriptive p95 of
**1,815.9 / 2,682.7 / 5,533.7 / 386.1 ms**, and cold p50 of
**1,754.2 / 2,703.5 / 5,896.5 / 350.8 ms**. These are sequential
cross-revision measurements, not an isolated causal speedup. The proposed
mixed 100 / 200 / 500 ms p50 targets remain unmet; the standalone p50 stays
below its 400 ms regression ceiling. Untraced SQL and phase costs are
unavailable, not zero. The private local harness does not establish native ORM
parity, hosted Cloudflare latency, throughput, or production capacity.

The clean trace still has repeated checked operation work, with Product update
and workflow paths carrying many short target transactions. The next connected
measured owner is **checked operation composition**: combine pre-callback
source/bundle verification with working-set construction and pending hydration
in one short checked transaction, and combine a pure read's leading admission
with its historical read in one checked transaction. The current
[participant admission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts)
starts with an empty checked transaction before invoking work;
[working-set construction and operations](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts)
and later reads acquire separate checked transactions. Preserve refusal and
evaluation order, fresh checks for later state-only or cached operations and
after separate I/O, the final metadata guard, and the rule against holding SQL
transactions across framework callbacks. Source admission already shares
evidence inside one transaction; do not duplicate that mechanism. The trace
does not isolate each transaction to one named function, so the next package
must measure this owner after its connected correctness proof rather than
promise that composition alone meets the latency target.

## Finite-root authority and execution contract

1. **One restartable finite root.** Replace repeated per-child snapshot,
   pending-state and provisional journal lifetimes for the explicitly
   supported, deterministic, database-only Product/Payload/workflow graph with
   one bounded root evaluator. Checked source and operation admission still
   occur at their live boundaries; composing repeated checks is the next
   measured owner. The evaluator owns a snapshot, pending writes, complete positive and
   missing/predicate/range dependencies, ordered child results and source
   rights. Replace all provisional per-syscall Application and native receipts
   for this new profile together, not only the seven outer native-call triads.
   The fenced local evaluator must resolve duplicate and in-flight child calls
   by exact `(fence, sequence, digest)` identity without claiming a durable
   child success. A cross-host preseal call is busy or fences and restarts the
   **whole** root, never one child under the old evaluator. On an OCC conflict,
   discard the entire tentative evaluator and
   rerun the admitted effect-free root under a fresh snapshot/fence, within a
   fixed retry budget. It must recheck exact root position and authority on
   each retry. Child results in this new profile are **tentative inside the
   root**, with no independently durable child acknowledgement. A precommit
   crash, lease loss or ambiguous child transport aborts the whole evaluator;
   recovery cannot reinvoke that child inside the old root. A new root may
   rerun under a new attempt and fence only after the prior root is resolved.
   Arbitrary Payload hooks, workflow effects, waits, remote calls,
   parallel children and other nonreplayable behavior still fail closed unless
   individually proved or placed behind a durable effect protocol. An inner
   child cannot independently settle, publish or rerun native side effects.
2. **Prepared immutable metadata plus fresh live authority.** Reuse bounded
   immutable schema/definition/projection work across requests only under a
   protected, dependency-complete writer protocol. Before every checked
   operation and final settlement, authenticate current scope, placement,
   selected binding/head, generation, revocation, readiness, attempt claim,
   fence and journal position in a short SQL transaction. A local capability
   check can reject stale input early, but is never database admission. Reuse
   inside an already checked transaction may avoid duplicate evidence loads;
   no cached admission verdict crosses a transaction, callback, retry, source
   change, eviction or host handoff. Do not replace every live check with a
   preparation token. State-only observable operations need live admission under
   the delivered 08 contract. The later [approved finite-root local-operation
   slice](./11-attempt-admission-preflight.md) permits only tentative local
   work between checked database boundaries; actual database access, seal and
   publication keep the existing full checks. That approval changes local
   refusal timing, not this ten-table protected writer contract.
3. **Protected metadata contract is a separate integrity decision.** Outside
   the first ten-table exception below, the accepted rule still synchronously
   reads/hashes selected dependencies, including unchanged-digest tamper in
   replay and recovery. A broader compact
   immutable **structural** preparation can replace those reads only after an exhaustive
   inventory of schema, index, unique, search, publication, readiness, task,
   placement, repair and DDL writers and an enforceable invalidation proof.
   The original baseline shared one PostgreSQL pool/credential for migration
   and runtime; existing framework-history protection was not a complete
   selected-metadata writer protocol. The first cutover below now separates a
   restricted runtime login from the privileged migration/repair connection
   for its ten target tables. Broader coverage would bind prepared structure to a protected placement incarnation and
   monotonic generation, and keeps mutable search/index coverage, backfill,
   retention, clock, head, attempt fence and revocation checks fresh. Runtime
   must lack metadata owner membership, DDL/TRUNCATE and generation DML rights;
   the installation gate verifies grants, triggers and controlled writer paths.
   This role guarantee is implemented for the ten-table private projection,
   not for framework or physical metadata generally. Controlled writers for
   broader coverage include Application analysis,
   publication, functions/tasks, active head, index/unique/search builds,
   framework installation, migration and structural DDL; raw SQL, restore,
   administrative and predicate-entry paths still need a complete inventory.
   Each approved writer path
   revokes uncontrolled covered metadata DML, makes every authorized writer
   transactionally invalidate the correct scope/predicate/descendant set, and
   quarantines maintenance/repair until exact revalidation and resume. Repair
   commits quarantine before structural DDL and resumes only after a newly
   validated generation. Separate control/target databases use a conservative
   control-quarantine-first, resume-last barrier; they cannot share an atomic
   cross-database root. Coverage
   includes inserts, deletes, predicate entry/exit, shared physical names and
   cross-shop effects; no hot global counter is bumped for every business row.
   Control and target databases cannot claim a joint atomic generation. A
   database owner or superuser that bypasses grants/triggers cannot be promised
   synchronous detection by a compact root. That changes the current
   privileged unchanged-root tamper contract and needs an explicit accepted
   design amendment and disposition of existing tamper witnesses **before**
   selected physical checks are removed. If that boundary is not approved or
   enforcement is incomplete, retain immediate selected hashes and measure
   the resulting lower bound. No TTL, owner-mode fast path or fallback reader.

   **First connected protected cutover.** The measured private mixed root uses
   only the ten legacy target Application rows: candidate, analysis, revision,
   publication, function, task catalog, task definition, revision schema,
   readiness, and readiness function. The target schema has one coarse
   incarnation and generation, invalidated in the same SQL transaction by
   enabled `BEFORE STATEMENT` triggers for `INSERT`, `UPDATE`, `DELETE`, and
   `TRUNCATE` on each of those ten tables. This deliberately invalidates other
   scopes in the same target schema; metadata writes are rare, and business
   row writes do not bump the generation. A restricted authenticated runtime
   login may perform legitimate metadata DML through those triggers, but owns
   no covered table or schema, cannot mutate the epoch, truncate, disable
   triggers, change role, or run DDL. Migration and repair retain a separate
   privileged connection. Installation attestation pins the trigger and
   lock-helper bodies, owner, grants, and exact covered table list. A
   preparation takes generation before the first structural read and after
   the last across target read transactions; mismatch rejects. The accepting
   exact-running SQL transaction registers one deduplicated guard per target,
   locks the epoch `FOR SHARE NOWAIT` through its narrow definer helper only
   after all other owned SQL, and rejects/rolls back on contention or change.
   An abandoned finite evaluator is discarded and any retry uses a new
   attempt/fence. Initial active selection and final publication retain full
   live verification because they have no protected final guard scope.
   Framework installation evidence, relation Application tables, control
   catalogs, physical definitions, search/index/unique coverage, scope clock,
   active head, revocation, claim, and journal position remain live reads.
   Separate control and target databases claim no joint generation. A later
   framework or physical cache needs its own measured consumer and writer/DDL
   proof. Privileged repair or DDL must quiesce this private protected profile;
   it is not an ordinary runtime writer and no physical-catalog cache is
   certified by this cutover.

   Journal roots persist an immutable `executionProfile`. Existing roots and
   ordinary callers are `durableOperations`; trusted finite mixed activation
   explicitly records `finiteRoot`. Replay and checked operations compare the
   stored marker. An expired pristine finite root is abort-only because child
   results may have existed tentatively in memory even if journal rows look
   pristine; it cannot execute again under the old fence. No old open root is
   silently reinterpreted as finite.

   A successful aggregate seal and an early relation conflict are the two
   terminal journal transitions for the finite evaluator. Earlier child
   results remain local until either transition. The relation-conflict
   transaction stages preceding finite evidence together with the existing
   `relation_conflicted` receipt and root state, preserving the existing
   durable conflict replacement and crash-recovery authority. It does not
   resume a child or repeat its side effects. The stored conflict can be
   reconstructed and replaced under the existing durable recovery authority.
   The local exact-claim registry
   retains closed claims as inert tombstones. It is bounded to 1,024 claims;
   saturation may require a sweep of up to 1,024 checked transactions, so
   bounded capacity alone is not a hot-path latency result.
4. **One authoritative commit and outcome.** Postgres continues to own the
   scope-local commit, row/index/unique/relation facts, event intent and
   retained root return value atomically. Child sequence and pending results
   may be held in the fenced evaluator because the new finite profile makes
   no external child-success promise before root commit. Persist the root
   invocation/claim and one aggregate durable seal/final decision; a failed or interrupted
   precommit root aborts and resolves its fence before a fresh-root retry.
   A lost or uncertain **final COMMIT** must first resolve the authoritative
   retained result and publication using the existing finish-only recovery
   authority before any rerun. No final acknowledgement
   exists only in memory. Concurrent host advances invalidate reused evaluator
   state even when an attempt fence is unchanged. The old child receipt/ACK
   protocol is a deliberate internal break for newly admitted effect-free
   roots, while existing externally acknowledged/durable child profiles retain
   named callers until separately migrated or drained.
   Keep the original SQL lock order, rollback-only behavior, cancellation,
   idempotency and lost-COMMIT recovery. No SQL transaction or lock is held
   across the sandbox, Payload hook, native callback, workflow pause or remote
   effect.

This is a replacement of internal execution mechanics, not a single
universal API for Application OCC, Payload and Medusa. Framework adapters keep
access, validation, hook/request transaction ownership, service methods,
workflow result and event semantics. Shared core owns admission, evidence,
pending state and settlement. A checked `Payload` request stays request-local;
Medusa child services keep borrowed manager semantics. The exact finite graph
has no durable waits/effects and must not be treated as arbitrary workflow
support. The pinned framework and Convex source anchors remain in
[03](./03-finite-medusa-workflow-preflight.md), [Payload release contract](../flarexdb-framework-integration/preflight/07-payload-release-and-adapter-contract.md),
and [06](./06-low-latency-execution-preflight.md). The existing Flarex
per-child ACK protocol cannot be discarded for previously acknowledged
attempts; the new root-final outcome contract applies only to the explicitly
cut-over finite effect-free profile. It does not follow from a generic Convex
OCC retry analogy.

## Owners, breaks and cutover inventory

| Existing owner/caller | Replacement question and disposition |
| --- | --- |
| [Participant/source/document admission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/participantAdmission.ts), [sourceAdmission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts), [working set](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts) | Extend the existing checked-read and transaction-local projection owner. Replace duplicate per-child admission only with a proven root operation boundary; retain live checks on state-only paths and each later short transaction. |
| [Transaction activation](../../packages/persistence-postgres/src/execution/transactionSessionActivation.ts), [journal store](../../packages/persistence-postgres/src/execution/sessionJournalStore.ts) and point commit owners | Replace per-child durable ACK for newly admitted finite effect-free roots with tentative local child results and one durable root outcome. Prove root claim/fence, precommit abort, exact final-COMMIT uncertainty resolution and no duplicate effects. Inventory existing externally acknowledged child consumers and outstanding attempts; retain their protocol until migrated or drained, never reinterpret open durable rows. |
| [Borrowed Product](../../packages/persistence-postgres/src/frameworks/commerceTransaction/borrowedLogicalAttempt.ts), [borrowed workflow](../../packages/persistence-postgres/src/frameworks/commerceTransaction/borrowedWorkflowAttempt.ts), [Payload](../../packages/persistence-postgres/src/frameworks/cmsTransaction/borrowedLogicalAttempt.ts), [Product adapter](../../packages/medusa-adapter/src/product-attempt.ts), [workflow adapter](../../packages/medusa-adapter/src/product-launch-workflow.ts) and [Payload adapter](../../packages/payload-adapter/src/adapter.ts) | Migrate all admitted finite-root callers in one connected slice to the new root capability. Retain native validation/hooks/service/workflow semantics; remove displaced mixed-profile helper paths, exports and duplicate transaction lifetimes. Ordinary Application and separately settling native profiles have independent named callers and retain their current durable obligations until separately scoped. |
| [Exact Worker core](../../packages/flarex-backend/src/artifactRuntime/PointMutationExactRuntimeWorkerCore.ts), [host](../../packages/flarex-backend/src/artifactRuntime/PointMutationExactRuntimeHost.ts) and benchmark harness | Keep one invocation per Worker and fresh-host comparison. First reuse existing immutable loader/prepared-host construction; a pre-readied single-use Worker is a separate measured host choice with refill, isolation, memory and queue costs. No same-Worker second invocation by default. |

Before runtime changes, enumerate the exact public/internal type signatures,
persisted attempt/journal schemas, open attempt states and each read/write
consumer. Classify each as retain, extend, replace or delete, identify live
durable data and outstanding attempts, and choose a concrete cutover: drain,
versioned decode/migration or explicit reset only when approved for isolated
test scopes. A private unshipped helper is not a compatibility reason. A
retained old path must name its real caller and removal gate. Keep control and
target placement protocols distinct; no new generic generation registry or
framework-specific entity branch in the evaluator.

The cutover inventory must start from the actual format owners:
[commit protocol](../../packages/flarex-protocol/src/commit-protocol.ts),
[per-syscall journal](../../packages/executor/src/mutation/journal/pointMutationJournal.ts),
[journal RPC](../../packages/executor/src/mutation/journal/pointMutationJournalRpc.ts),
[persistent acceptance/seal](../../packages/persistence-postgres/src/execution/sessionJournalStore.ts),
[attempt activation](../../packages/persistence-postgres/src/execution/transactionSessionActivation.ts),
[commit transaction](../../packages/persistence-postgres/src/commit/pointCommitTransaction.ts)
and the corresponding schema/migration rows. Inventory root, child receipt,
point/index/relation and event rows, accepted sequence and sealed outcome
decoders, and recovery readers before changing their format. The new profile
can remove its provisional per-syscall receipts only after every admitted
Application and native syscall is migrated together. Ordinary Application,
separately settling native and already acknowledged outstanding attempts keep
their named old contracts until migrated, drained or explicitly dispositioned.

## Finite profiling and decision gates

Do **not** launch another unchanged 104-sample series to choose the design.
Use the existing raw samples and a small matched traced/untraced run with the
same graph and request bounds to answer these questions before fixing a
mechanism or accepting a budget:

| Decision | Minimal evidence and falsification |
| --- | --- |
| Is the ~4 s mixed remainder CPU, scheduler/driver time or unobserved async? | Capture sampled Node CPU self-time, allocation/GC and async wait stacks for the measured request; align with trace phase and SQL dispatch IDs. Attribute hash/canonical decode, Effect/promise scheduling, native framework and Worker bridge separately. Traced and untraced modes use the same business assertions and wall envelope; report observer cost rather than subtracting it silently. |
| Which round trips and lock intervals are unavoidable? | On the current ordinary-role PG fixture, pair selected statement IDs with server execution/buffer/plan samples, wait events, lock-wait/hold intervals, WAL bytes and transaction boundaries. Separate driver await union from server CPU and lock wait. Target the measured admission, 104 workflow and 52 Product update intervals, not all SQL templates indiscriminately. |
| Does the new finite root outcome beat repeated child dispatch? | After protocol and outstanding-attempt inventory, count authenticated SQL boundaries, removed child ACKs, remaining root writes, WAL/journal bytes and one-attempt memory. Prove a lower bound using actual reads/writes and one settlement. Compare identical graphs including conflict retry, precommit crash/lease loss/ambiguous child transport and lost final COMMIT. A callback requiring externally durable child acknowledgement belongs to the retained old profile until separately redesigned. |
| Is protected preparation worth its writer cost and threat change? | Audit every covered writer/repair/DDL privilege, invalidate-before-visible transition and concurrent activation/revocation race on PGlite behavior plus distinct authenticated ordinary-role PG connections. Quantify preparation hit/miss, invalidation frequency, lock contention and repair quarantine. If any supported writer can mutate selected evidence without invalidation, keep current hashes. |
| Can a host choice plausibly meet 100 ms Product? | Compare fresh Worker, reused immutable loader and optional pre-readied single-use Worker under identical end-to-end boundaries; include preparation/refill CPU, memory, queue wait, eviction and rejection. A warm request cannot meet a target by excluding work from the unchanged request interval without separately pricing that work and agreeing the host contract. |

The profile should nominate one dominant owner and a concrete connected
implementation package, with a cost lower bound and a failure witness that can
disprove it. Later projection/OCC materialization and host lifecycle packages
remain separately gated by these measurements; do not bundle a speculative
new generic cache, journal format or host pool into an unreviewed code slice.
Search current projections presently rewrite declared fields of changed rows;
skipping unchanged fields is not automatically safe because their stored
revision sequence must match the base row. Settlement also rechecks index
ranges/pages/unique slots, while current commit row-change facts do not carry
old/new index keys for a safe overlap-log shortcut. The scope clock is an
intentional serialization point per commit; without lock-wait evidence it is
not a measured latency culprit. A nullable analyzed `CHECK` was separately
found to admit `NULL` under PostgreSQL three-valued logic; its repair needs
an audit of existing rows, explicit nonnull clauses and PGlite plus ordinary
PostgreSQL proof, with no silent data deletion. Relationship FK proposals must
also preserve live/tombstone and Medusa missing-endpoint behavior; a blanket
current-pointer FK is not a valid shortcut. These are later connected
correctness/storage gates, not measured latency causes or part of the CPU
diagnostic. Profile the measured owners before selecting a later projection,
OCC or search-write change.

## Implementation activation and acceptance

The owner-approved private implementation replaces the finite mixed graph's
per-child durable acknowledgement with a single aggregate terminal journal
transition. Its protected metadata writer/repair contract, restricted runtime
role, checked admission, whole-root retry, cancellation, pending and negative
evidence, Payload hook and Medusa workflow behavior, successful final-COMMIT
recovery, and publication remain part of the connected private proof. The
dedicated early relation-conflict **COMMIT response loss** injection has not
been run: the checked atomic transition and stored conflict
replacement/recovery paths have connected proof, but that specific ambiguity
is a targeted coverage gap. Do not describe it as tested.

This package does not activate a named environment, ship a public API, admit
arbitrary framework effects, or establish the proposed latency budgets. Any
materially different trust, schema/data disposition, retryable effect set or
host lifecycle still needs its own connected decision. The next checked
operation composition package must keep its authority and failure-order proof
with the measurement; throughput, hosted transport, native ORM parity and
production capacity remain separate gates. Server execution and buffer cost,
lock wait and hold intervals, WAL bytes, preparation hit/miss and contention,
retry latency, saturation behavior, and larger or neutral graph limits were
not established by the retained four-workload series. The decision table above
continues to own their measurement or correctness gates; none can be inferred
from lower client-observed SQL dispatch counts alone.
