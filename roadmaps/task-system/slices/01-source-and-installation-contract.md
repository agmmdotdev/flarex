# First Task Source And Installation Contract

Status: **independent challenge and peer exchange complete;
runtime contract not yet admitted**.
The [goal](../GOAL.md), [workflow](../WORKFLOW.md) and
[source map](../REFERENCES.md) govern. Baseline inspection starts at Flarex
`cfe917c795ee3684df89a9b7a03c7c54a5234904` plus the actual shared working graph;
HEAD alone excludes substantial ongoing core work. Trigger and Convex pins are
recorded in REFERENCES and must not drift silently.

## Candidate Connected Outcome

Derive finite store operations and logical definitions from the actual retained
Trigger creation/attempt/recovery closure. Install those private definitions
through authenticated shared-core APIs, then execute the admitted lifecycle
through adopted methods with injected hosts and fresh-process recovery. Required
native wait/checkpoint/winner semantics constrain the schema and source closure
from the start; a run/attempt-only table guess is insufficient.

## Independent Perspectives

| Perspective | Independent finding and peer disposition |
| --- | --- |
| Trigger engine | Outer and inner constructors own Prisma/Redis/product dependencies. Snapshot creation publishes effects during borrowed transactions; heartbeats are Redis jobs with weaker identity checks. Adapt complete operations, not CRUD alone |
| Current consumers | Application create/read/list/result/cancel/await and real Product/Fulfillment native wait consumers are live. No current Payload jobs producer is established. Commerce children do not imply hierarchical Task runs |
| Shared core / Convex | System labels provide no installation authority; Application-analysis roots and readers need coherent migration. Fresh logical Task operations/subject issuance are missing. Scope-clock lock upgrade is a concrete deadlock risk; dirty shared-reader ownership needs handoff |

## Selected Source And Proof Profile

Retain `RunEngine.trigger`, enqueue/publish, dequeue/claim, attempt start,
success/failure/retry/nack/cancel, snapshot/heartbeat/stalled recovery, selected
delay handling and the required waitpoint/checkpoint closure. Inspect actual
connected constructors/imports before fixing the copied module graph. Source
methods remain the implementation; the legacy synchronous `decide` API does not.

The first isolated profile has one queue/capacity policy, one run per transition,
zero explicit Task children, one manual/native wait and one accepted checkpoint
revision per operation. Two competing runs against capacity one remain required
to prove capacity. This is a bounded proof, not a public workload or scale claim.
Native `runTaskChild`/`runControlChild` are committed commerce commands; preserve
their receipts at consumer cutover without inventing Task-run hierarchy.

Current native checkpoint bodies permit 1,048,576 encoded bytes. Prove the full
logical record envelope around that body before selecting a store bound; the
existing body limit does not prove an entire row/transaction fits. Total row,
byte, page, intent, fan-out, repair, lease and retry budgets remain explicit
runtime-contract gates. Upstream chunks of 100 or snapshots `take: 50` do not
satisfy total bounds or durable progress.

## Semantic Atomic Units

These are required operation families, not invented method names or a registry:

| Unit | Same-settlement state and obligations |
| --- | --- |
| Create/replay | Scoped definition/request binding, replay/conflict check, run + initial snapshot + due/dispatch intent |
| Claim | Fresh eligibility/runtime/fence validation, capacity reservation, dispatch ownership/receipt and pending-execution snapshot |
| Start | Exact snapshot/fence correlation, attempt ordinal, executing snapshot and durable heartbeat obligation |
| Heartbeat | Live attempt/principal/fence/expiry checks and deadline renewal using database time |
| Terminal/retry | Outcome/snapshot, reservation release and durable wait-resolution, delivery/cancellation and follow-up obligations |
| Drain/repair | Bounded indexed discovery, idempotent receipts and durable continuation where work exceeds an invocation |
| Native wait | Checkpoint acceptance + suspension, original deadline, one confirm/timeout/cancel winner, retired receipt replay and fresh charged continuation/control authority |

Move or revalidate reads currently protected by Redis runLock under the actual
authoritative lock. Publication occurs after settlement from durable intents;
remote effects and handlers never run in the borrowed database transaction.
See [transaction/effect adaptation](../divergences/trigger-transactions-and-effects.md),
[ownership/heartbeat adaptation](../divergences/trigger-ownership-and-heartbeats.md)
and [native checkpoint adaptation](../divergences/trigger-native-checkpoints.md).

## Shared Core And Consumer Constraints

`system` namespaces/producers already exist in protocol, but candidate evidence
still mandates Application analysis and source capture proves integrity only.
Extend the existing allocator/artifact/catalog settlement with a discriminated
authenticated producer/root and legitimate scope/locator target. Platform
installation independence does not remove deployment/scope authority.

`ensureLogicalStorageDefinitions` installs definitions; it does not issue serving
readiness. Root-shape changes must carry source/binding/readiness readers together.
`trustedWorkflowExecutionSubject.ts` directly reads old physical Task rows and
must migrate at its current authority owner to authenticate logical runs.

The old admission sequence takes execution-authority SHARE, scope-clock SHARE,
then run FOR UPDATE. Shared logical publication requires ordinary-write clock
NO KEY UPDATE and core index/build locks. A late clock upgrade can deadlock two
different run transitions in one scope. Derive the complete shared lock graph
before runtime edits; do not add a Task scope mutex or copy old guards wholesale.

The current core refactor already modifies readiness, publication and related
binding/maintenance owners. Producer/root work on clean protocol/analysis/catalog
paths is potentially independent, but cannot be committed as a coherent runtime
change while leaving readers on fake/missing Application evidence. Coordinate
that ownership before code assignments. Shared cache reuse waits for complete
Task row/index/history/publication writer coverage; cache candidates are inert.

## Required Witness Families

Port actual Trigger assertions for single-run success/failure, one initial
snapshot, retries/exhaustion/non-retriable error, start/heartbeat timeouts,
cancellation/rescheduling, waitpoint cleanup/races and checkpoint continuation.
The exact source map is in [REFERENCES](../REFERENCES.md).

Add system-producer/target refusal and install/readiness/replay witnesses. Port
selected native continuation assertions for atomic suspension, resolution races,
revocation rollback, forged descriptors, original deadline and cold body/principal
correlation. Keep full current Worker/Application/native suites operational on
the old engine until their complete consumer cutover. Merely collecting a
PostgreSQL test that skips without a database URL is not a PostgreSQL proof.

## Admission Gates

- Independent findings are exchanged and challenged, with source-backed
  dispositions and concrete failure counterexamples.
- Exact retained methods/tests and required transitive dependencies are mapped
  to finite operations, atomic records, effects and numeric work/byte bounds.
- System installation authority and target/lifetime contract use existing core
  owners without fabricated Application analysis or a Task migration engine.
- Locks/database clock/fences, READ COMMITTED visibility, after-settlement
  durable intents and uncertain commits have an explicit contract.
- Native wait winner/resume/control and checkpoint formats are accounted for;
  unsupported broader behavior is refused rather than silently dropped.
- Shared-owner edits have clear ownership/handoff in the dirty working tree.
  Workers receive exact paths/contracts; no competing heavy resource work starts.
- PGlite, ordinary-role PostgreSQL, original-test/consumer and actual-host
  witnesses are assigned to the guarantees they establish. Cleanup is named.

## Coordinator Disposition

Independent findings were exchanged and the three perspectives converged on
the selected closure, one-run/native-wait profile and missing shared capability.
The next runtime boundary must jointly specify authenticated root/target
construction, coherent readers/subject migration, lock order, finite operations
and budgets. Only then assign shared-core admission/readers and fork workers
their exact contracts and paths. Source inventory and coordination records are
complete preparation, not the first connected runtime milestone.
