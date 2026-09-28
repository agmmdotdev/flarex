# Fundamental latency redesign for finite mixed attempts

Status: **owner-approved design direction; core runtime implementation not yet
active.** The request-scoped CPU diagnostic harness is implemented and its
[retained records](../../packages/flarex-backend/benchmarks/mixed-mutation-core/fundamental-latency/cpu/README.md)
inform the next owner choice. This preflight defines the proposed connected attempt/admission/recovery redesign and
its proof gates. The current private mixed profile and the [accepted prepared
execution integrity rule](../../design-notes/flarex-db-accepted-design.md#prepared-execution-integrity)
remain authoritative until an explicit integrity amendment and a complete
writer/recovery proof are accepted. No existing source may skip selected
dependency hashes, change a durable format, pool a Worker invocation or move a
framework effect merely because this document records a lower-cost target.

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

## Proposed authority and execution contract

1. **One restartable finite root.** Replace the repeated per-child admission,
   snapshot and journal dispatch pattern for the explicitly supported,
   deterministic, database-only Product/Payload/workflow graph with one bounded
   root evaluator. It owns a snapshot, pending writes, complete positive and
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
   preparation token. State-only observable operations need live admission too.
3. **Protected metadata contract is a separate integrity decision.** The
   current accepted rule synchronously reads/hashes selected dependencies,
   including unchanged-digest tamper in replay and recovery. A compact
   immutable **structural** preparation can replace those reads only after an exhaustive
   inventory of schema, index, unique, search, publication, readiness, task,
   placement, repair and DDL writers and an enforceable invalidation proof.
   Today migration and runtime share one PostgreSQL pool/credential; existing
   framework-history protection is not a complete selected-metadata writer
   protocol. The proposed replacement separates runtime and controlled writer
   roles, binds prepared structure to a protected placement incarnation and
   monotonic generation, and keeps mutable search/index coverage, backfill,
   retention, clock, head, attempt fence and revocation checks fresh. Runtime
   must lack metadata owner membership, DDL/TRUNCATE and generation DML rights;
   the installation gate verifies grants, triggers and controlled writer paths.
   This is a new mechanism, not an existing role guarantee. The known
   framework migration-history guard does not cover the selected Application
   and physical structures. Controlled writers include Application analysis,
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

This is a proposed replacement of internal execution mechanics, not a single
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
| [Participant/source/document admission](../../packages/persistence-postgres/src/logicalDocuments/participantAdmission.ts), [sourceAdmission](../../packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts), [working set](../../packages/persistence-postgres/src/logicalDocuments/workingSet.ts) | Extend the existing checked-read and transaction-local projection owner. Replace duplicate per-child admission only with a proven root operation boundary; retain live checks on state-only paths and each later short transaction. |
| [Transaction activation](../../packages/persistence-postgres/src/transactionSessionActivation.ts), [journal store](../../packages/persistence-postgres/src/sessionJournalStore.ts) and point commit owners | Replace per-child durable ACK for newly admitted finite effect-free roots with tentative local child results and one durable root outcome. Prove root claim/fence, precommit abort, exact final-COMMIT uncertainty resolution and no duplicate effects. Inventory existing externally acknowledged child consumers and outstanding attempts; retain their protocol until migrated or drained, never reinterpret open durable rows. |
| [Borrowed Product](../../packages/persistence-postgres/src/commerceTransaction/borrowedLogicalAttempt.ts), [borrowed workflow](../../packages/persistence-postgres/src/commerceTransaction/borrowedWorkflowAttempt.ts), [Payload](../../packages/persistence-postgres/src/cmsTransaction/borrowedLogicalAttempt.ts), [Product adapter](../../packages/medusa-adapter/src/product-attempt.ts), [workflow adapter](../../packages/medusa-adapter/src/product-launch-workflow.ts) and [Payload adapter](../../packages/payload-adapter/src/adapter.ts) | Migrate all admitted finite-root callers in one connected slice to the new root capability. Retain native validation/hooks/service/workflow semantics; remove displaced mixed-profile helper paths, exports and duplicate transaction lifetimes. Ordinary Application and separately settling native profiles have independent named callers and retain their current durable obligations until separately scoped. |
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
[per-syscall journal](../../packages/executor/src/pointMutationJournal.ts),
[journal RPC](../../packages/executor/src/pointMutationJournalRpc.ts),
[persistent acceptance/seal](../../packages/persistence-postgres/src/sessionJournalStore.ts),
[attempt activation](../../packages/persistence-postgres/src/transactionSessionActivation.ts),
[commit transaction](../../packages/persistence-postgres/src/pointCommitTransaction.ts)
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

The owner has approved this **direction**, including necessary internal
breaking changes; implementation begins only after writer coverage, the
privileged-repair/threat amendment and durable recovery/cutover proof are
concrete and reviewed as one connected package. These are implementation
gates for the approved direction, not a generic request for a second approval.
A materially different trust, schema/data disposition, retryable effect set
or host lifecycle returns for an explicit decision. Ordinary in-scope
file/test work needs no repeated permission.

The first implementation package must include its real Application/Product,
Payload and finite workflow consumers, the admission and journal owners, a
single settlement/recovery path, displaced-path cleanup, and ordinary-role
PostgreSQL plus PGlite correctness. Required witnesses: unchanged-digest
tamper under the decided threat boundary; unauthorized DML, maintenance
quarantine and restore; selected-source and placement changes; concurrent
writer/activation/revocation and deadlock order; stale fence and journal
position across hosts, retry, eviction and cancellation; pending/missing and
predicate dependencies; OCC conflict rerun without callback duplication;
Payload nested transaction/hook order; Medusa graph/events; precommit crash,
lease loss and ambiguous child transport without old-root reinvocation; lost
final COMMIT with authoritative retained result; and native callbacks
outside SQL transactions. Add a neutral extra definition/source and larger
graph witness so the core is reusable beyond the named fixtures. Typecheck,
source guards, both project reviewers and lint precede the same four-workload
ordinary-PG measurements. Report warm p50/p95, cold/retry/contention and
throughput separately, total work per successful root, retained inventory,
WAL/journal bytes and host preparation costs. Passing tests or one isolated
SQL speedup does not establish the 100 / 200 / 500 ms goals, native ORM parity
or hosted production capacity.
