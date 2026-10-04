# Whole Mutation Execution Redesign

Status: **the owner requests a complete replacement of mixed mutation overhead,
accepts necessary breaking changes, and asks for existing and future workflow
boundaries.** This preflight records the recommended connected contract. The
choice to permit replay-safe precommit re-execution instead of durable-seal
finish-only recovery remains pending. No runtime cutover is claimed.

The [execution roadmap](./14-execution-redesign-roadmap.md) owns sequencing.
The delivered [finite execution contract](./23-finite-execution-contract-preflight.md)
is the correctness baseline; its numerical performance acceptance is incomplete.
This successor replaces the remaining entry, pending-state, contribution,
settlement and recovery topology. It is not another query-fusion package.

## Outcome, Scope And Evidence

Make an admitted mutation cost its actual business operations plus small explicit
platform work: authenticate entry, retain a snapshot, track real dependencies,
validate conflicts and constraints, and atomically commit its final effects.
Postgres remains the only commit authority. Framework business behavior stays
with native Medusa services/workflows and Payload Local API/hooks.

The connected runtime scope is the existing private Application/Product/Payload
and ordered finite workflow consumers, their executor/persistence owners,
retention and metadata writers/readers, recovery and decisive test consumers.
Future workflow profiles are an extension contract, not automatic admission of
new modules, parallelism, retries, locks, hooks or external effects. Public APIs,
host pooling/activation, arbitrary framework expansion and silent durable-data
reset remain outside this scope.

Current [complete direct measurements](../../packages/executor/benchmarks/core-performance/finite-contract-cutover/README.md)
fail every mixed median/P95 target. They show 559/761/1,511 client SQL submissions
and 50/53/69 transactions for Product, Product plus Payload, and mixed workflow.
Those are request/control/read transactions, not independently committed business
mutations. SQL counts alone neither attribute CPU nor prove a latency cause.

Publication reconstructs complete table/index identity catalogues once, three
times and six times on those graphs. In current source,
[`pointCommitTransaction.ts`](../../packages/persistence-postgres/src/pointCommitTransaction.ts)
iterates operation/source contributions; `readFiniteCommitClosure` in
[`sourceAdmission.ts`](../../packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts)
loads complete published physical requirements before selecting touched tables.
This is a responsibility/lifetime defect to replace, not merely batch.

The shared [`rootEvaluator.ts`](../../packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts)
already owns native pending rows/dependencies. Application `finite.points`,
`appPoints` hydration seeds, detached native contributions, `finite.entries`,
`prepareFiniteRootRows` and sealed SQL journal reconstruction in
[`sessionJournalStore.ts`](../../packages/persistence-postgres/src/sessionJournalStore.ts)
still form distinct representations. Source proves their duplication; it does
not establish its exclusive CPU share or quadratic growth.

## Convex Principle And Required Divergences

The checked-in Convex
[`retry_mutation`](../../../../crates/application/src/application_function_runner/mod.rs)
starts a logical transaction, checks a previously committed request, executes
the mutation, and stages successful result/logs in that same transaction.
OCC starts a new transaction and reruns admitted code. Its
[`SessionRequest`](../../../../crates/model/src/session_requests/types.rs)
has no incomplete-mutation record. The
[`committer`](../../../../crates/database/src/committer.rs)
validates a final transaction against committed history and pending writes,
persists its effects, and orders visibility.

Adopt one logical attempt and one final acceptance. Do not copy Convex's
in-process registry or storage implementation as a Postgres/Cloudflare guarantee.
Its transaction-level request deduplication does not itself establish exclusive
pre-execution ownership; outer dispatch exclusivity was not established by this
source audit. Flarex retains a compact durable anchor
for its selected exact-request ownership/fencing, snapshot/history and metadata
reservations, and uncertainty serialization. No SQL transaction spans callbacks,
sandbox execution, workflow waits or external effects.

## Recommended Execution Contract

| Boundary | One owning responsibility | Work removed from this profile |
| --- | --- | --- |
| Installation and preparation | Existing managed installation/maintenance owner proves structure and interlock. Existing bounded preparation authenticates selected immutable executable/schema/binding metadata. | Rebuilding installation/catalogue proof or compiling unrelated definitions for every attempt or framework call. Live permission is never cached. |
| Entry | One trusted owner authenticates request/principal, profile, placement/incarnation, revocation, executable/source policy and snapshot; persists the exact fence/owner/deadline and history/metadata reservation. Only confirmed entry issues a usable attempt. | Separate finite session/lease/claim/journal-body construction where those rows only repeat the same authority. Full-source serving readiness is replaced by actual-demand readiness. |
| Execution | Extend the existing core evaluator into one owner of original observations, pending values, consumed metadata, ordered operation receipts, events and budgets. Application syscalls and native adapters use restricted views of it. | Application-to-native pending hydration and per-child exported global effects/dependency contributions. Child completion never commits. |
| Storage frontier | Fetch the captured native demand at the original snapshot plus pending work; freshly accept required authority, retention and demanded access-path lifecycle/coverage. | Empty admission transactions for local work and unrelated same-source index readiness. Fresh revocation/fencing and exact negative/range/page/relation evidence remain. |
| Operation close | Preserve native constraint/error timing, result, event policy, local replay identity, accounting and sticky failure; revoke the child view. | Re-projecting the complete global commit input for each operation. A caught staged failure remains rollback-only. |
| Freeze | Drain or interrupt owned runners, prohibit late work, and detach one immutable final graph. Existing planners derive final dependencies, rows, keys and relations outside SQL once. | Finite entry/point/range/event SQL projection and repeated healthy journal encoding, decoding and hashing. Canonical encoding remains at real wire and durable boundaries. |
| Final settlement | One short Postgres transaction freshly accepts exact authority, consumed metadata and data OCC; resolves affected write mechanics and constraints; commits data/history/indexes/relations, result/outcome and event intents; consumes the anchor/reservation. | Healthy finite durable seal, separate finishing, and their proof reconstruction, conditional on the recovery decision below. |

This replaces interfaces and their consumers, not just their implementations.
It does not add another global working set, framework-specific storage engine,
transaction-engine registry, generic CRUD interpreter or competing finalizer.
Core owners retain their actual responsibilities; new interfaces must remove a
proved duplicate responsibility.

The durable anchor binds the stable request/idempotency identity to exact
arguments, function/executable identity, principal and access policy across
attempt fences. Entry and final locked acceptance check the exact correlated
committed outcome before effects. Retry and takeover serialize on that same
identity: an old final transaction cannot race replacement execution, nor can
different request semantics reuse the key. Per-attempt snapshot and metadata
reservations remain distinct from this stable request identity.

Repeated writes retain the original snapshot preimage and only the final pending
value. Replacing journal projections must preserve the history/index/constraint
owners' ability to derive exact old-to-new effects.

Entry authenticates the selected metadata and capability envelope. An unused
unready index is not an entry or tentative-read prerequisite. Final acceptance
must still prove every currently affected write-maintenance obligation. These
refusal changes need witnesses; they do not weaken permissions or permit an
unready demanded path to return partial or false-empty data.

## Current Write Maintenance Once Per Touched Table

Collect distinct touched tables from the final graph, irrespective of how many
framework operations wrote them. Resolve each table's **complete current** row,
ordered/unique/search/JSON/reverse-relation/reference maintenance closure once
for this final transaction. Untouched tables are not catalogue prerequisites.
Repeated business calls still cost native work and ordered receipts, not another
whole-schema identity pass.

Lower coalesced old-to-final row changes through the existing materialization
owners. Derive index/search/unique/relation deltas from those preimages and final
values, and avoid unchanged auxiliary writes only where their owner proves the
same history, constraint and coverage behavior. Do not persist intermediate
business values merely because several callbacks edited the same row. Native
storage bindings must also retain efficient bounded query demands; shared
business code alone does not establish native database performance.

An issued immutable closure can be reused only with a complete canonical
writer-owned projection and fresh semantic acceptance. Inventory every schema,
binding, definition, activation/retirement and maintenance writer before replacing
the current complete-catalogue loader. Each must atomically maintain the relevant
projection under the compatible authority/commit-lane protocol. A partial
consumer compilation, digest alone or TTL is insufficient.

Under the final lock order, accept current affected build/spec/coverage and
physical availability, and detect definitions activated during execution and
incoming relation/unique/reference obligations. Authenticate and revalidate the
prepared closure's exact semantic identity, consumed metadata and entry-watermark
ABA evidence. A relevant closure change after freeze causes conflict before
writes; final acceptance cannot substitute newly activated mechanics into the
frozen plan. Fresh mutable coverage/lifecycle checks do not themselves replace
that semantic acceptance. Preserve complete
operation provenance, domain write permissions and resource bounds.

## Recovery Decision And Workflow Profiles

**Recommend:** finite database-only execution remains tentative until final
COMMIT. After a proven precommit abort or process loss whose old attempt can no
longer settle, admit a new fenced attempt and rerun the whole operation. This
removes the promise that a confirmed uncommitted seal can finish without rerunning
code. The owner is being asked to select that exact behavioral change.

| Authoritative observation | Required action |
| --- | --- |
| Confirmed COMMIT or exact correlated committed outcome | Return its stored result; preserve event/delivery identity; never rerun business callbacks. |
| Confirmed noncommit, with the old terminal transaction settled or conclusively fenced from acceptance | Allow bounded whole-root re-execution only in the admitted replay-safe profile, with fresh request/framework state and snapshot. |
| Lost COMMIT response, failed outcome lookup, unproven absent outcome or interrupted cleanup | Resolve the exact old decision and fence further execution. Absence, timeout, host death and lease expiry alone do not prove rollback. |
| OCC | Preserve exact dependency/conflict evidence and admit a fresh whole-root attempt within its retry budget. Permanent business/authority failures do not become retries. |
| Cancellation racing settlement | Revoke local work, settle owned SQL/cleanup and report the actual durable outcome. Cancellation cannot undo a commit. |

The alternative is to retain durable seal and callback-free finishing recovery,
while replacing the other duplicated representations. That preserves a larger
terminal graph. No dependent runtime change may silently choose between them.

Profiles follow execution behavior, not framework names:

- **Finite database-only attempt:** native business code/hooks may read/write
  admitted storage, transform results and capture supported event intents. The
  complete callback graph must be replay-safe under its available capabilities.
  A wrapper or method name does not prove arbitrary hooks safe.
- **Durable/effect workflow:** actual pauses, remote effects and non-replay-safe
  callbacks retain workflow-owned checkpoints, idempotency and compensation.
  Its independently committed atomic database steps may use shared mechanics;
  the whole workflow does not become one atomic mutation or a SQL transaction.
- **Existing direct commands and ordinary durable operations:** keep their named
  settlement/recovery policies. They do not acquire the finite replay contract
  merely by sharing storage.

Resource coordination is orthogonal. A bounded root-scoped lease needs explicit
acquisition, renewal, fencing, release and abort/crash handling before admission;
a lock spanning commits or suspension belongs to durable coordination. Current
finite Medusa lock refusals remain until a real lock capability is proved. OCC
does not supply a resource lock, and a PostgreSQL advisory transaction lock cannot
be held across a native callback under this architecture.

Current finite SDK compensators must be `transactionCovered`. Those database
inverses do not run to undo discarded provisional writes. Lock release, resource
cleanup and compensation for externally visible or previously committed work
require their own admitted lifecycle and recovery contract. See the executing
[`definition.ts`](../../packages/medusa-workflows-sdk/src/definition.ts) and
[`runtime.ts`](../../packages/medusa-workflows-sdk/src/runtime.ts), and native
[`acquire-lock.ts`](../../third_party/medusa/upstream/packages/core/core-flows/src/locking/steps/acquire-lock.ts).

Payload validation, nested Local API calls and `afterChange` retain native order
before outer settlement. Medusa service/workflow event calls capture the admitted
intents. External delivery starts from committed intents. Moving all hooks after
commit would break business semantics and does not establish this redesign.

The actual native lifecycle and existing decisive consumers ground these gates:
[`Payload create`](../../packages/payload-adapter/node_modules/payload/dist/collections/operations/create.js),
[`nested hooks and rollback-only`](../../packages/flarex-backend/test/mixedMutationPayload.workerd.test.ts),
[`fresh whole-root Payload retry`](../../packages/flarex-backend/test/mixedMutationPayloadRetry.workerd.test.ts),
and [`workflow outcome/events and lost-COMMIT`](../../packages/flarex-backend/test/mixedMutationWorkflow.workerd.test.ts).
The pinned PostgreSQL
[`lock provider`](../../third_party/medusa/upstream/packages/modules/providers/locking-postgres/src/services/advisory-lock.ts)
also proves why its transaction-held callback cannot be reused directly.

## Breaking Contracts, Durable Data And Removal

| Existing contract | Disposition and gate |
| --- | --- |
| Finite journal attempts/handles, confirmed-entry/seal captures and executor assembly | Replace with an issued finite attempt, restricted views, one frozen graph and final settlement/resolution. Migrate real Product/Payload/workflow and direct proof construction together. |
| `finite.points`, `appPoints` seeds, `finite.entries`, finite `SourceContribution`/global effect carriage and `prepareFiniteRootRows` | Replace/delete on the finite path after interleaved Application/native reads/writes, exact dependencies, local replay and constraint timing pass. |
| Finite seal/finishing verification, liveness, retry/redelivery and recovery formats | Replace together after the terminal choice, complete recovery witnesses and old-record disposition. Do not bypass finishing in an adapter. |
| Per-contribution complete-catalogue closure acquisition | Delete after the canonical distinct-table closure and complete writer/locking proofs; no retained comparison or fallback engine. |
| Finite session/claim/lease/journal correlation, metadata reservation and retirement readers | Consolidate only where one compact durable anchor supplies all real ownership/retention duties. Migrate pruning, physical retirement, claim renewal, abort and conflict/retry readers together. |
| Ordinary Application journal/syscall/seal and real durable-operation checkpoint consumers | Retain under their named profiles. Shared tables/code remain only for actual callers, not because an old finite test uses them. |
| Committed outcomes/results, event intents/delivery identity, history/tombstones and retained conflict evidence | Preserve or migrate explicitly. Breaking changes provide no deletion authority. |

Prefer a quiescent drain: stop old finite admission, settle active owners, drain
sealed/finishing/conflicted obligations through their current authenticated
recovery, terminalize lost running ownership safely, and inventory actual
scope/placement/fence/format/counts. Preserve committed evidence. Prove no remaining
old nonterminal obligations before activating the new profile and removing its
readers/routes/columns. If a real environment cannot drain, record a reviewed
exact migration; do not fabricate pending state or reset durable rows. There is
no named-environment activation authority in this preflight.

## Finite Delivery And Acceptance

1. **Select the full contract.** Resolve the recovery choice, inventory owners,
   canonical metadata/maintenance writers and affected formats, and reconcile
   the accepted design before runtime changes. The recommendation above is the
   reviewable target; no helper experiment precedes it.
2. **Deliver the connected finite cutover.** Entry, one pending owner, operation
   close/freeze, current table closure, final transaction, retry/recovery,
   reservations and all existing private consumers migrate together. Workers
   own disjoint edits; root owns orchestration and Git. Preserve native code,
   migrate decisive tests, remove displaced finite paths, validate both database
   lanes, obtain both project reviews and commit one complete verified slice.
3. **Meet integrated acceptance.** Retain fixed native 5/10 ms median/P95 added
   latency and mixed 100/200, 200/400, 500/1,000 ms median/P95 targets. Measure the
   final complete graph with matched native operations and unchanged business
   results; architectural delivery and numeric acceptance remain separate.

Warm transaction structure targets one target-database entry, actual required
storage frontiers, and one final settlement. Charge control/preparation misses,
initial authentication, liveness and every fresh check explicitly; do not hide
them outside the request or count nested server work as free. The structural
target is not a measured SQL ceiling.

Overhead must scale with actual demands, consumed metadata, distinct touched
tables, final rows/keys/relations/events and compact operation receipts. Prove
no repeated complete-catalogue work as untouched schema grows or more operations
touch the same tables. Keep the 1/100 metadata matrix, complete ordered-catalogue
capacity and genuine late-activation/ABA witnesses. Native work may grow with
business calls; real maintenance may grow with affected keys/definitions.

Run PGlite and ordinary-role PostgreSQL for authority/installation, writer
serialization, snapshot and negative/range/page/unique/reference/relation OCC,
native constraint timing, rollback-only, retention/retirement, duplicate/fence,
precommit crash, unknown-COMMIT, cancellation and actual durable-profile regression
witnesses. Exercise real Worker Product, Payload access/hooks/nested calls, finite
workflow results/events and complete root retry. Run affected types/builds/source
guards/lint and both reviewers against the final owned checkpoint; fix and rerun
substantive changes. Stop owned runtime resources. No hosted/production or arbitrary
future-workflow readiness follows from these bounded proofs.
