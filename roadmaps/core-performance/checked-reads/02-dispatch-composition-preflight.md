# Checked Reads: Ordered Dispatch Composition

## Status And Scope

Status: **second checked-read iteration delivered for structural transport
composition; latency acceptance remains open.** This iteration connects two
existing persistence owners: sequential running-attempt tail acquisition and
selected readiness table-frontier batching. Group 1 stays active. This is not
the inactive [publication group 02](../02-publication-preflight.md).

The outcome is fewer client dispatches for genuine checked Product reads with
the same fresh authority, lock/refusal order, snapshot data and protected tail.
There is no new public API, host lifecycle, framework capability, cached live
verdict, durable encoding or data deletion. The private database function is an
additive schema migration with the installation/attestation contract below.
Native row-codec failure ordering is retained by the audited native mappings and
actual driver-boundary witnesses. No latency improvement is established.

## Evidence And Current Owners

The [group preflight](../01-checked-reads-preflight.md) owns the real Product
measurement policy and delivered immutable preparation reuse. The
[component evidence](../../../packages/flarex-backend/benchmarks/core-performance/checked-reads/README.md)
retains the original and provenance-matched observations. The first iteration
retains six ordered kernel and ten source/readiness dispatches. This iteration
composes those to four and nine respectively. Both use genuine checked reads;
neither timing comparison establishes a causal speedup.

The accepted [DB design](../../../design-notes/flarex-db-accepted-design.md),
[mixed design](../../../design-notes/flarexdb-mixed-mutation-execution.md) and
[package boundaries](../../16-package-boundaries.md) govern authority. Source
and decisive tests own exact row decoders, error precedence and lifecycle.

| Owner | In-scope responsibility |
| --- | --- |
| `transactionSessionActivation.ts`, `transactionSessionAttemptKernel.ts` | `loadLockedRunningAttempt`, fresh clock/session/lease boundaries, exact root/claim tail, original claim and expiry validation, shared load/replay/exact consumers |
| Persistence schema/migration and target protection owners | Private function installation, pinned schema/relations, ordinary-role invocation, replacement/tamper proof and supported-driver migration |
| `logicalStorageReadiness.ts` | Add selected search requirements to the existing needed ordered-table batch; preserve lazy unique inspection/refusal order |
| `indexBuildStates.ts`, `appRows.ts` | Existing frontier batch, issuer/transaction/clock/active correlation and bounded detached per-table Results |
| `logicalSearchBuild.ts`, unique eligibility owner | Consume their own frontier Results at their existing acceptance position, preserving state/physical/coverage order |
| Session journal, seal/cancel/drain consumers and test instrumentation | Migrate genuine load paths and truthful lock observations without creating a second kernel |
| Backend checked-read harness | Invoke real native Product operations, retain setup/authentication accounting and compare bounded component lanes |

## Selected Kernel Cut

Keep the clock, session and lease as **three separate fresh JavaScript refusal
boundaries**. Preserve their current modes and predicates: the logical read
clock uses `NO KEY UPDATE`, session/lease locks remain ordered, and lifecycle,
fence, snapshot and absent-lease refusal precede tail acquisition.

Replace the root/claim/time dispatch sequence in the existing
`loadLockedRunningAttempt` owner with one private, pinned-schema **VOLATILE
SECURITY INVOKER** function. Its sequence is explicit:

1. Acquire the exact journal root `FOR UPDATE` with current cardinality bounds.
   Refuse a missing or non-unique root before attempting the claim lock.
2. Acquire the exact execution claim `FOR UPDATE` with current cardinality
   bounds. Preserve the existing claim missing/non-unique refusal before time.
3. Observe the existing authoritative database time **after both locks**.

Use sequential server statements, not planner-dependent join/CTE execution
order. This is dispatch composition, not removal of server lock/read work.
Expand returned row composites through the existing Drizzle columns and
`mapWith` decoders. Preserve bigint, timestamp, bytea and nullable representations;
do not add JSON transport or a parallel row codec. Keep every current validation
after time, including original claim/holder pins, schema, lease and grant/hard/
claim deadlines. Driver failures, domain refusals, defects and interruption
retain the existing error/lifecycle owner and full Cause.

The checked kernel moves **six to four dispatches**. Migrate all genuine shared
tail consumers, including load, replay and exact read callers, through the
existing owner. Do not retain an old kernel fallback. Root/claim helpers remain
for their real liveness and terminalization callers, with those obligations
named instead of deleting unrelated behavior.

The `afterLoadLock` root/claim JavaScript checkpoints cannot describe pauses
between statements now executed inside the function. Replace those load-tail
observations with truthful `attemptTailLocked`. Migrate seal, cancel and drain
tests to actual PostgreSQL blocking witnesses where they require an intermediate
root/claim lock boundary. Do not preserve fictional callback checkpoints.

### Private Function Installation Contract

Persistence owns `fx_lock_running_attempt_tail`, installed by additive migration
`0121` in `current_schema()`. Arguments are `p_scope_uuid uuid`,
`p_session_id uuid`, `p_attempt_fence bigint` and `p_scope_id text`. Its TABLE
outputs are `disposition`, `journal_root` in the actual schema's journal composite
type, `execution_claim` in its execution-claim composite type, and
`database_now_epoch_milliseconds`. The existing owner maps the named dispositions
to its current corruption failures; no protocol or durable-row format changes.

The PL/pgSQL function is invoker, volatile, parallel unsafe, non-strict and
non-leakproof, with `search_path=pg_catalog,pg_temp`. Its body and composite
row types are pinned to the migration's actual schema; no schema name comes
from an adapter. Calls resolve through the existing trusted transaction search
path, matching current table routing. A preliminary logical locator may name
`public` while the actual test connection uses an isolated schema; it must not
override that real transaction composition. Default PUBLIC EXECUTE uses only
the caller's original table SELECT/UPDATE privileges and is not a definer grant.

The existing metadata epoch protection query, in the same dispatch, attests one
unique function name (rejecting overloads), exact input/output types, names and
modes, composite row-type OIDs, name resolution, invoker/volatility/language/
parallel/strict/leakproof flags, absence of a planner support callback
(`prosupport=0`), exact search path, runtime execute privilege and
a non-runtime owner matching the root table's owner. It checks the exact body
SHA-256; normalization is limited to CRLF and the quoted actual-schema prefix
replaced by a fixed marker. Ordinary roles cannot CREATE/ALTER/DROP or own the
function. Privileged replacement retains the existing quiescence promise.
Unsupported/tampered installations refuse; this extends the existing attestation
query rather than introducing another scheme or protection profile. PGlite runs
the same installed function and native codecs, retains full canonical validation
and receives no fabricated protected token. Preserve all durable rows and formats.

### Native Codec First-Failure Gate

Combined driver mapping occurs after the function's root/claim/time sequence.
The native decoder audit establishes nonthrowing mapping for actual stored
bigint, timestamp, bytea, nullable and other root/claim column values; no JSON
column is involved. Current Schema/policy refusals remain after time, so no
earlier decode refusal is moved behind a later lock or clock failure. Actual
bigint beyond JavaScript safe-number range, out-of-JavaScript-
Date-range timestamp, bytea and nullable-field witnesses preserve those actual
driver representations. Invoke the function once through a FROM alias, not repeated composite
expansion of a function call. No JSON conversion or parallel decoder may repair
an ordering gap.

## Selected Readiness Cut

Expand the **first already-required ordered-index table-frontier batch** with
the selected search table requirements derived by the readiness owner. Search
reads every inspected requirement table when its first eligible state and
physical proof reach the original frontier cut. Unique readiness instead
derives needed frontier tables from its freshly inspected build states; retain
that original lazy cut and borrow the ordered/search map only when complete.
Do not speculate about mutable unique eligibility during ordered inspection.
This is not every table in the source closure and is not
an adapter-supplied table set. Deduplicate and bound membership using existing
owner limits; keep actual table Results separate, detached and correlated to
the exact issuer, transaction, observed clock and active Application context.
The preparation owner retains one sorted search requirement-table array,
bounded by the existing 256 candidate table-binding limit, and charges only that
new array through its existing host allocation. Selected calls filter it through
their existing selected table set into a transient array. Frontier queries
retain the existing 64-table chunks; no host byte ceiling or candidate bound
changes. Closed/sticky allocation refusal remains with the current charge owner.

The initial measured composition included every selected unique requirement,
producing 13 distinct table IDs against the original two calls' eight-table
union. Five of those IDs had no observed needed frontier call in the baseline.
That overfetch is displaced by search-only additional membership. The real
Product target is the eight-table union of its five ordered frontier tables and
seven search tables; validate that membership through forwarded owner calls.
Preserve the initial candidate and outliers as evidence, rather than replacing
them with the amended comparison. Dispatch reduction does not establish less
server work, and the kernel function retains its original server lock/read work.

Read the union only at the existing ordered-index frontier dispatch position.
If that path needs no frontier, do not add an early dispatch. Consumers retain
their original index, unique and search order. Preserve per-table failures as
Results until the corresponding consumer reaches its own observation cut;
eager collection must not move a later corruption refusal ahead of an earlier
state or physical refusal. Missing search state still refuses before its
physical proof; physical failure still refuses before consuming its own
frontier Result. No later consumer may use a foreign, incomplete or closed
transaction observation.

Fresh binding/Application heads, provisional Application build checks, sorted
`KEY SHARE` build locking, clock refresh/retry semantics and complete protected
tail remain unchanged. The existing source preparation still checks its current
lease on every invocation. The source cut is **ten to nine dispatches** for the
measured Product path; it grants no cached readiness verdict.

## Measured Structural Contract And Measurement Policy

| Genuine Product demand | Baseline dispatches / transactions | Final candidate |
| --- | --- | --- |
| First positive ID selection | 21 / 1 | 18 / 1 |
| Distinct ID miss or handle selection | 20 / 1 | 17 / 1 |
| Pending-local ID hit | 0 / 0 | 0 / 0 |

Reuse the existing checked-read harness and issued native Product borrow. Each
lane uses a genuine admitted attempt with complete initial authentication and
renewal counted separately. Shared load-tail or full-readiness consumers may
also change that initial interval's dispatch graph; record and correlate the
actual change rather than requiring the old admission count to stay equal.
Authentication semantics and all proofs remain complete. Retain one positive observation per case, six
untraced and two traced demands per miss/pending case, first/successive labels,
identical settings/cardinality/predicates/order and actual returned JSON bytes.
Preserve the first iteration artifacts; write this iteration's baseline and
candidate into a separate artifact folder with exact owner/harness provenance.
Update expected counts only after owner implementation establishes the selected
graph. No fake attempt, raw-storage benchmark or copied validator is permitted.

The table is a dispatch gate, not a server-statement, CPU or latency claim.
Internal function/trigger statements remain unavailable unless actually observed;
report the server-side composition explicitly. Quiet timings are diagnostic
unless the comparison and control establish the attributed improvement. Retain
all samples, including pending-local control, failures and outliers. Full mixed
performance measurement remains a declared group/integration milestone, not an
automatic requirement for this owner iteration.

The [matched component evidence](../../../packages/flarex-backend/benchmarks/core-performance/checked-reads/dispatch-composition/README.md)
records the final eight-table frontier membership, equal business/result and
transaction outcomes, and unchanged frozen harness/settings. The two baseline
frontier calls become one; the root/claim/time calls become one function call.
Full initial admission changes 97 to 96 dispatches, with four transactions
retained, through its full-readiness frontier composition. Strengthened function
attestation remains in the existing epoch queries. Setup and complete initial
authentication/renewal remain separately observed work.

The small untraced miss medians are higher than baseline. Retain that result,
the initial overfetch candidate and all outliers; do not infer server CPU,
pure lock time, an outlier cause or a causal latency benefit from dispatch counts.
The delivered outcome is structural transport composition, with latency and whole-goal
acceptance still open. The mandatory next gate is
[orchestration simplification](../orchestration-simplification-preflight.md),
before publication or another minor performance iteration.

## Migration, Cleanup And Completion Gates

- Inventory every shared load/replay/exact caller and every test lock checkpoint;
  migrate them coherently. Retain separate root/claim helper calls only for
  actual liveness/terminal obligations. Remove displaced load-tail SQL and
  obsolete instrumentation/expectations; no compatibility wrapper or fallback.
- PGlite proves native row mapping, malformed/missing/cardinality refusals,
  nullable fields, bigint/bytea/timestamps, bounds and domain error precedence.
  Ordinary-role PostgreSQL proves installation/permissions, actual root-before-
  claim blocking, fresh time after waits and retained clock/session/lease refusal
  boundaries. Neither lane substitutes for the other.
- Preserve deadline/revocation/fence changes while blocked, original-claim and
  sealed-lease checks, typed errors versus defects/interruption, rollback and
  cleanup, genuine OCC rerun/replay and durable recovery. No transaction spans
  native/framework callbacks.
- Readiness witnesses cover exact selected ordered/search membership and lazy unique
  requirements on distinct tables, no-needed-frontier behavior, missing state,
  physical failure versus stored frontier corruption, byte limits, wrong issuer/
  transaction/clock/active context and changed-clock refresh. Full protected tail
  and fresh selected readiness remain mandatory.
- Run affected typechecks, guards and lint, bounded connected consumers, both
  final reviewers, substantive-fix reruns and matched component comparison.
  Root owns queued heavy lanes, cleanup and the scoped Git commit. Delivery
  requires both connected cuts and truthful migration/proof; whole latency
  acceptance and groups 2–5 remain separate.
