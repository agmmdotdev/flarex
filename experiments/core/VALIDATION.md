# Correctness and performance gates

The [bounded create](./PAYLOAD-CREATE.md) and
[standalone Application](./APPLICATION.md) slices have executable contract,
PGlite and ordinary-role PostgreSQL witnesses. These establish their stated
construction profiles only. Full-core gates, general Application support,
connected reactivity and performance acceptance remain open. No speedup is
established; the optional comparison preserves preparation failures as evidence.

## Three comparison lanes

| Lane | Purpose |
| --- | --- |
| Native Payload/Medusa | Complete business reference using genuine framework behavior |
| Active Flarex | Current complete behavior and measured overhead baseline |
| Experimental Flarex | Candidate with its declared full guarantees and supported profile |

Standalone Application queries/mutations need independent coverage within the
active and experimental lanes. Run the same actual Application function and
assertions, with source and profile identity recorded. The native framework lane
does not supply an equivalent Application implementation; its SQL surrogates do not
prove Application snapshots, dependencies, retries or atomic outcomes.

All lanes must execute the same admitted business graph, data size, selections,
hook branches and complete result assertions. Native independent framework commits
are not atomic mixed execution: explicitly attribute Flarex's additional snapshot,
OCC, history and atomic outcome obligations. Do not pretend that difference proves
either unavoidable overhead or equal semantics.

Use the existing harness semantics and native workload definitions. Local
experimental wiring may invoke them; it must not rewrite business work to suit
the candidate. Record a missing match as a missing match, not a synthetic baseline.

## Required behavioral witnesses

| Area | Witnesses |
| --- | --- |
| Access | Foreign tenant/source/method, revoked principal, denied membership/body access, stale capabilities; no protected body escapes before acceptance |
| Generation/readiness | Concurrent activation/retirement, unrelated unavailable index, required unavailable index, maintenance crash/reopen and actual protected-writer enforcement |
| Snapshot/dependencies | Read-your-writes, repeated point read, missing row, insert/update/delete phantom, bounded pagination and changed membership, retained-history expiry |
| Standalone Application | Genuine query/mutation entry without framework runtimes; exact snapshot and pending visibility; consumed point/missing/range dependencies; row/phantom conflicts and non-overlapping controls; outer-only eligible retry; revision/tombstone history and dependency output usable by the existing reactivity owner |
| Scalar/projected queries | Count/exists/page over original snapshot plus pending insert/update/delete; repeated edits counted once; missing/negative answers retain required evidence; budget exhaustion never becomes false/partial success |
| Indexed root state | Compound/null/locale unique keys, release/reclaim and delete/recreate; stale-cache invalidation; ordered pending membership; failed/nested edits leave all derived structures coherent |
| Direct-command profile | Native visibility witness, same-command nesting, hooks outside physical transactions, declared conflict mapping, no automatic replay, unknown outcome resolved before re-execution |
| Native contracts | Payload Local API access/default/validation/hooks/nesting; Medusa service normalization/errors/visibility; exact values/null/omitted fields; complete results |
| Settlement | Same-row conflicts, independent writes, concurrent unique claims, reference races, atomic cross-framework rollback, history/index/fact/event/outcome agreement |
| Failure/recovery | Caught rejection still poisons root where required, cancellation during each owned phase, late callback, stale attempt, lost COMMIT response, idempotent resolution before replay |
| Resources | Bounded rows/bytes/time/cache lifetime, cancellation settlement/quarantine, all owned resources closed, no transaction across untrusted callbacks or remote effects |
| Modularity | A material module implementation can be replaced through its declared contract without rewriting framework business behavior or unrelated lifecycle owners |

The connected candidate must exercise its own working-set and atomic lifecycle
through the real repository/workflow bridges. Audit imports and execution traces
to rule out delegation to the old admission/working-set/settlement path. Reusing
native services and workflow definitions is expected; retaining the old core
under a new SQL facade does not establish the intended replacement. Test changed
bridge contracts explicitly; do not claim that minimal integration edits are
already proven.

Also execute the [standalone Application witness](./IMPLEMENTATION.md#early-standalone-application-witness)
through the candidate's Application bridge. Point/missing/range evidence must
participate in real acceptance; a passing local map test or create-only unique
constraint test is insufficient. For read-only queries verify absence of mutation
machinery. Reuse existing reactivity consumers where practical and label missing
end-to-end evidence; this does not establish subscription-host deployment.

Expected failures, defects and interruption stay distinct. For error-order changes,
include a witness showing which callback, external effect or disclosure can occur
before refusal. Preserve unresolved barriers. Each gate runs on PGlite and focused
ordinary-role PostgreSQL when it claims database semantics; report the two lanes
separately. Mocks and PGlite alone do not establish real PostgreSQL behavior.

Exercise the writer matrix: installation replacement, revocation, placement/fence
changes, selected-definition retirement, build publication and retention/GC must
race with reads and settlement. Test unrelated metadata changes independently
from consumed-definition changes. Verify restricted roles cannot bypass the
protocol; a mocked gate cannot establish writer participation.

For predicate pushdown and projections, compare exact value/null/collation/numeric
semantics with the executing native contract and original/pending values. Test
that a concurrent commit cannot replace the root's captured snapshot, and that
derived query projections remain consistent with authoritative data/history.

Count-before/after-population and access callbacks are observable boundaries.
Combined queries and root-scoped module bindings need witnesses for those orders,
single hook execution, mutable instance isolation and per-call cancellation.

## Measurement protocol

- Pin source and settings before and after each run. Active integration is moving:
  Git HEAD alone is insufficient when inputs are dirty. Retain hashes of every
  executing candidate, active/native implementation and workload file.
  Explicitly include experimental files, installed SQL and local configuration;
  the existing source inventory must be extended in experimental composition.
- Separate installation/preparation/seeding/readback/cleanup from request time.
  Request time includes admission, business work, native hooks, result handling
  and confirmed settlement. Report cold/preparation costs separately.
- Use matched alternating complete-request comparisons after at least five
  warmups and at least 30 measured pairs, preferably 100 for acceptance. Keep
  every sample/failure; calculate percentiles of paired differences.
- Run quiet latency, client CPU and SQL/profiler diagnostics separately. Label
  CPU quantum and observer costs. Driver-await elapsed time is not client CPU
  or exclusive PostgreSQL execution. Do not add nested timing spans.
- Report latency median/P95, paired excess, client CPU, server timing where
  available, peak memory, exchanges, statements, checkouts, explicit transactions,
  rows/bytes and publication work. Distinguish implicit SQL transactions.
  Separate internal SQL calls/index probes/rows, WAL and lock hold/wait time from
  client exchanges. One function invocation may execute many server operations.
  Report unavailable metrics as unavailable; collect intrusive diagnostics apart
  from quiet latency. Track canonical encoding, allocation and transferred bytes.
- Use ordinary-role PostgreSQL with durability settings matching the reference.
  Faster tests obtained by disabling durability do not qualify.
- Concurrent coding can continue. Quiet measurement requires no competing heavy
  benchmark/test load; record interference and rerun invalid comparisons. Never
  stop another owner's resources to obtain an idle machine.

## Early algorithm and concurrency checks

Run these before expanding native coverage, alongside the first complete roots:

| Variable | Required observation |
| --- | --- |
| Count/existence/page result shape | Eligible scalar queries avoid full document-result construction; page work includes lookahead and examined entries. Exact-count scan cost remains visible. |
| Growing pending insert/update batch | Local unique validation no longer performs a retained-row scan per claim. Record key construction, map maintenance, memory and end-to-end cost rather than asserting complexity from SQL count. |
| Unrelated schema and retained tables | A selective operation's preparation/execution does not repeatedly traverse unrelated definitions or unrelated retained rows. |
| Indexed versus nonindexed edits | Measure key lowering, predecessor validation, index writes and WAL. Prove any skipped work against the selected integrity contract. |
| PostgreSQL predicate with pending changes | Record committed-row transfer avoided, delta bytes and exact snapshot/overlay results, including multiple edits and deletion. |
| Independent writers in one scope | Record throughput, median/P95, conflict/retry/failure rates and serialized lock hold/wait time. Low single-request latency does not establish capacity. |
| Same load across different scopes | Distinguish per-scope sequencing from global coordination, pool limits and resource saturation. |

Choose and record admitted sizes/concurrency levels before running. Include a
steady-state load beyond a single pair, with bounded work and explicit failure
accounting. Select an intended same-scope workload and throughput/tail target
before interpreting contention results; no throughput target is claimed passed
by the existing five small mutation graphs.

The Worker/Hyperdrive lane must verify transaction-pooling behavior, connection
lifetime, cancellation and cross-segment state ownership. Do not rely on a pinned
PostgreSQL session or session-local temporary data across short transactions.

## Acceptance

The existing complete mutation targets remain **at most 5 ms added median and
10 ms added P95 latency**, and **at most 16 ms median added client thread CPU**,
against the matched native graph. Report CPU below measurement resolution as
unresolved, not zero. These are inherited goals, not predicted prototype results.
See the [native baseline contract](../../roadmaps/mixed-mutation-core/26-native-business-baseline-preflight.md)
and [CPU gate](../../roadmaps/mixed-mutation-core/27-shared-execution-evidence-redesign-preflight.md#full-document-pipeline-redesign).

First-workload measurements guide iteration but do not establish full acceptance.
All five existing complete graphs must pass before claiming the experiment meets
the mutation performance goal. They do not close standalone Application acceptance.
Report standalone Application query/mutation correctness and measurements
separately, using their existing owning contracts and targets where defined.
Record an absent matched baseline or numerical target as unresolved; do not invent
one or substitute framework mutation budgets for Application query goals.

Also vary touched rows, unrelated schema size, index/relation fanout, batch size,
concurrent roots and scope distribution. Record the changed variable and all
limits. Flat helper counts do not prove scale; hot shared locks can erase a
single-request win. Hosted claims require the actual Worker/Hyperdrive lane.

Acceptance also requires the algorithmic properties above: no repeated unrelated
schema/root scans for selective operations, no full document-result construction
for eligible scalar queries, and no quadratic retained-row unique-claim scan.
Bounded projection/delta maintenance and lock occupancy must be reported, not
hidden by a smaller driver-call count. A 1-2 ms small warm read aspiration does
not replace the complete native-workflow baseline plus the Flarex allowance.

Do not weaken correctness assertions, remove necessary business branches, raise
limits or change a baseline to pass. An experiment can be informative and still
fail acceptance. Preserve that disposition and select a different hypothesis.

## Reviews and checks

Run explicit experimental typechecks/lint/build/source guards plus affected
behavioral suites. Root lint commands may omit this directory; inspect their
scope. Significant code requires the two reviewers specified in root AGENTS.md,
with exact owned paths/checkpoint and both-driver evidence. Re-review substantive
changes. No runtime tests or reviewer passes are claimed by this documentation.
