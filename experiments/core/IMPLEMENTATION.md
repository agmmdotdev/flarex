# Implementation sequence

Status: [bounded Payload create](./PAYLOAD-CREATE.md) and the
[standalone Application construction slice](./APPLICATION.md), plus the
[native Product scalar-update binding](./MEDUSA-PRODUCT.md), connect actual
developer/framework entry points to experimental roots and shared Drizzle
persistence/materialization. The [multi-table foundation](./MIXED.md) provides
selected-definition admission, callback-scoped borrowing and one publication,
now connected to actual Application, Product update/retrieve/list and Payload
CRUD with native preference cleanup. Initial [measurements](./RESULTS.md) miss the
latency goals. Batch/contention diagnostics complete the initial assessment and
identify per-row database work; the local contention target passes. General
queries, connected reactivity, wider native lifecycle, performance acceptance and
promotion remain pending. The stages below
describe the full experiment, not completed support.

## Stage 1: executable scope and contract map

Choose the starting workloads from existing native/Flarex scenarios: Payload
scalar create, Medusa Product scalar update, and one mixed
Application/Product/Payload mutation, plus the standalone Application witness
below. Record native versions, executing exports,
dirty-source fingerprints, inputs, complete outputs, hooks, errors and events.
The [references](./REFERENCES.md) locate the existing harness and framework sources.

For each workload write its minimum operation trace: admission, business-required
reads, local edits, native callbacks, constraints and durable settlement. Classify
each check by obligation, invalidating writer and enforcement lifetime. Distinguish
framework semantics from an internal order only witnessed by an old test.

Use the current Payload/Medusa integrations to discover requirements, not to
constrain the replacement's internal compatibility. For every reused requirement
identify native source or a real supported/durable obligation, its consumer and
behavioral witness. Inventory old readiness/admission, repository/workflow handoffs
and per-call lifetimes separately as replaceable mechanisms and measured costs.
Do not port their sequence or bottlenecks into the experiment to preserve glue.
Record removed interactions and show the same required behavior through the new
owners. See the [integration reference rule](./MODULES.md#framework-reuse-and-integration-replacement).

Resolve the direct command's isolation/retry contract and the mixed root's
snapshot/retention/fence contract. Define a counterexample test for each proposed
removed boundary. Record exact assumptions and unresolved gates in DESIGN.md.

Complete five concrete specifications before the corresponding runtime work:

1. Bind the [query operations](./DESIGN.md#complete-query-operations) to each actual
   workload: input/result, authorization point, snapshot, dependencies, bounds
   and unsupported cases.
2. Select the [root structures](./MODULES.md#root-owned-indexed-state), mutation
   ownership, derived-state invalidation and freeze behavior.
3. Expand the [writer matrix](./DESIGN.md#identity-and-invalidating-writers) into
   concrete SQL writers, roles, lock modes/order and invalidation witnesses.
4. Prove the [direct-command profile](./DESIGN.md#direct-command-contract-for-the-first-candidate)
   against native visibility/hooks/nesting, failure mapping and replay eligibility.
5. Record before/after operation traces with the precise removed visits, packets,
   scans and intermediate representations. A renamed helper is not removed work.

Capture a reproducible current baseline for all five existing complete workloads
before comparing a candidate. Retain raw paired reports, executing source hashes,
database/durability settings and failures. The experiment's source fingerprint
must include `experiments/core/`, its SQL/configuration and actual imported native
code; the existing package-oriented inventory does not cover this folder by itself.

### Initial operation-trace hypotheses

These are source-derived starting points, not measured improvements. Pin the exact
executing branch before filling visit/byte/CPU/lock counts. A workload that does
not execute a path receives no attributed saving from replacing it.

| Path | Existing work to trace | Candidate work and elimination claim | Boundary that remains |
| --- | --- | --- | --- |
| Eligible indexed page | Index capture -> membership acceptance -> unseen row-body capture -> hydration | One bounded selection/acquisition result; remove eligible external handoff and duplicate interpretation | Native access callback between selection and body disclosure, if required; exact dependencies and work limits |
| Count | Relational find -> candidate documents -> predicate -> sorting/projection -> discarded documents | Scalar execution with exact dependencies and relevant pending delta; remove unnecessary result construction/transfer | Access policy, native ordering, snapshot semantics and bounded work |
| PostgreSQL predicate | Acquire original/current documents -> JSON packet -> SQL predicate -> Boolean packet | Evaluate committed snapshot data near storage and combine relevant pending values; remove eligible committed-row echo | Exact PostgreSQL value semantics and read-your-writes, with no reread at a newer snapshot |
| Batch unique changes | For each row/definition, traverse retained rows and lower their keys again | Maintain canonical key ownership as state changes; remove repeated whole-root comparison | Native conflict timing, release/reclaim, integrity and final concurrent enforcement |
| Repeated module use | Construct request-bound repositories/services/resources per call | Reuse eligible bindings for the root; remove repeated construction only where ownership permits | Per-call failure/cancellation and service state isolation |
| Settlement | Acquire scope commit lock -> acceptance/planning/materialization/publication | Prepare immutable encodings/plans first, then short database-local acceptance | Fresh checks, concurrent constraints, scalar commit order and atomic durable outcome |

For every removed visit, list where its authority, dependency, accounting and
failure duties moved. Compare driver exchanges, internal SQL and physical work;
packing the old interpreter into one SQL function is not by itself success.

Inventory the selected module/workflow's business code separately from its
repository, manager/context, participant, event and workflow-host plumbing.
For each integration dependency mark reuse, experimental replacement or a real
framework seam requiring coordination. Do not assume the old adapter contract
must survive or that all adapter changes will be mechanical.

Add explicit local package/tool/test configuration here when implementation starts.
Do not enroll this folder in root workspace or ambient test discovery. Prefer
existing installed tools when sufficient; otherwise use an independently scoped
manifest and lockfile here, with reproducible dependency versions and no edits
to the active workspace. Wire the comparison through local composition.

### Early standalone Application witness

Develop this witness alongside the first Payload foundation so Application
requirements shape the shared contracts early. The bounded Payload create slice
remains a useful deliverable; it cannot by itself close Application support. The
witness must execute the candidate's own query, root and accepting path without
Payload/Medusa runtime construction or delegation to the active core's evaluator.

| Part | Minimum connected behavior |
| --- | --- |
| Standalone query | Execute an Application query at one authorized exact snapshot; perform a point read, a missing-row read and a bounded indexed-range read. Return the actual values plus owner-consumable precise dependencies, with no write journal or commit capability. |
| Standalone mutation | Execute an Application mutation using those read contracts; stage an insert and an update, observe its own pending changes while retaining the original snapshot/dependencies, and settle data/history/outcome once. |
| Row conflict | Pause after a root observes a row; let another admitted writer change it and commit; the first mutation must conflict under its declared protocol. |
| Missing/range conflict | Commit an insertion of the observed missing identity or into the observed indexed predicate while the first root is paused; final acceptance must detect the relevant conflict. Include changed membership and a non-overlapping control. |
| Retry ownership | Exercise an eligible whole-attempt Application retry and an ineligible failure. No participant/helper replay, arbitrary external effect, or retry of an unresolved COMMIT. |

Use the existing Application developer/entry contract through a narrow experimental
bridge. Core unit tests support this consumer proof; a SQL surrogate or framework
repository call cannot replace it. No new language, SDK or universal framework
transaction API is required for the witness.

Identify the exact active/experimental Application function, inputs, source
fingerprints, dependency assertions and complete committed readback before running.
If an existing fixture lacks a matching standalone workload, add explicit
experimental comparison wiring and label any missing baseline; do not pretend the
native mixed benchmark's SQL surrogate supplies Application semantics.

Prove these behaviors on PGlite and ordinary-role PostgreSQL before claiming
Application compatibility or broadening the shared contracts around framework
coverage. Extend to delete/tombstone history, retained-snapshot expiry, rollback,
cancellation, uncertain outcomes and reactivity/dependency consumption under the
full validation contract before declaring the Application profile supported.

## Stage 2: minimum owned database lifecycle

Design the required persisted concepts before creating SQL. Inventory all writers,
roles and invalidation paths; specify lock order and fresh database time. Implement
disposable resource ownership, restricted serving access, installation generations,
maintenance/reopen and snapshot retention/refusal. A new layout is allowed.

Implement physical execution once, including deadlines, cancellation/draining,
quarantine, release and shutdown. Reuse a proven narrow primitive only after its
dependency audit. Do not copy the current full host to acquire a connection.

Prove the new authority and lifecycle contract on both drivers before using it
to remove a live check. Test unauthorized callers, stale generation, expired
attempt, maintenance races and interrupted acquisition.

## Stage 3: complete storage and settlement slice

Implement point read/missing read and the actual bounded indexed selection needed
by the chosen workloads, with pending-state overlay and exact dependencies.
Connect one root owner, immutable preparation and the fresh accepting DB gate.
Add only the unique/reference behavior those real workloads require.

Exercise the early standalone Application witness through these same neutral
owners. Original point/missing/range observations must reach actual acceptance;
recording them locally without checking them at settlement is not Application OCC.

Implement atomic settlement, history, necessary index/unique/relation maintenance,
durable result/idempotency/event intent and uncertain-COMMIT resolution. Exercise
concurrent changes, rollback and replay before calling the path correct. A
data-only insert without these obligations is a storage microbenchmark only.

Preserve scalar per-scope commit order for the first candidate. Move safe immutable
planning outside its lock, and instrument the remaining serialized acceptance.
Do not replace order with an unproved sequence allocator or partitioned visibility.

Run an early complete-root comparison. Reject a failed hypothesis before adding
more wrappers or expanding framework coverage. Lower SQL count alone is not success.

## Stage 4: real framework bridges

Compose real Payload Local API and actual promoted Medusa service behavior with
the experimental storage contracts. Bridge code lives here and owns translation
only. Do not fork native business algorithms or alter active adapter imports.

Replace the repository and workflow execution handoffs where they depend on the
old working set or atomic lifetime. Exercise the new Attempt/Settlement owners
through these bridges; importing the old execution host to keep a wrapper
unchanged would defeat the experiment. Preserve native steps, hooks and results,
including genuine module-specific semantics. Adapter plumbing may change broadly
inside this folder without pausing active Medusa integration.

### First Medusa reuse slice

After the bounded foundation, take the existing Medusa Product scalar-update
path as the next integration slice. Use its current implementation and native
witnesses before inventing another repository/service framework. Record a small
reuse/adapt/replace inventory for the connected path: source implementation,
semantic responsibility, current core dependency, target owner, and behavioral
witness. Include the native service, normalization/projection, repository binding,
manager/lifetime translation, events and settlement handoff.

Reuse the native service and sound translation code wherever the dependency audit
permits. Rebind or replace only the core-coupled mechanisms identified by that
inventory. Run the same intended behavior through the experimental binding and
measure the complete request, including setup, callbacks and settlement. Keep
existing behavioral assertions while replacing fixture setup tied to old internals.

Extend the proven path to one existing native workflow and then the explicit
mixed boundary, subject to the query, concurrency and failure gates below. Let
these real consumers expose missing core contracts early. Do not turn broad
adapter coverage or a general integration framework into a prerequisite for the
first connected comparison. An existing interface is reusable only if it allows
the candidate's execution granularity and preserves the required behavior.

### Connected lifecycle and expansion gates

Prove normal/error results, defaults, visibility, nested access and hooks, caught
failure rollback, events and fresh committed readback. Test the complete standalone
commands, not only repository methods. Add the actual mixed root: all participants
borrow its snapshot/pending state, and only it settles.

A required change to active framework code is an overlap issue, not permission to
edit the integration work. Preserve the witness, identify the seam and continue
independent experimental work. Resolve that seam with its owner before depending
on the change; no adapter SQL workaround.

Before broadening framework coverage, exercise the complete candidate with an
indexed projected page, exact count/existence, a supported PostgreSQL predicate
over pending edits, growing insert/update batches, indexed versus nonindexed-field
updates and independent concurrent writers in one scope. Use admitted real paths
and root contract witnesses; do not build a general aggregate engine in advance
of a consumer. These are early rejection gates, not post-promotion optimizations.

## Stage 5: replacement and scaling proof

Demonstrate modularity by replacing one material storage/query or readiness
mechanism while preserving the owning contract tests and native bridge code.
This must change actual execution, not an unused interface implementation.

Expand the chosen candidate to the five existing complete business graphs and
the relevant scaling/contention/failure witnesses. Use the three-lane comparison
and unchanged acceptance rules in VALIDATION.md. Report remaining costs rather
than declaring the experimental folder itself a successful redesign.

Run the private Worker/cache-disabled Hyperdrive lane after local correctness and
performance. Transaction pooling must not invalidate the design's state/resource
assumptions. Report same-scope and different-scope throughput, tails and lock
occupancy; local warm-session reuse does not prove hosted behavior.

## Stage 6: promotion recommendation

After correctness, performance, review and cleanup, describe the exact proposed
core cutover: consumers, public/private contracts, changed schemas/codecs, named
durable data, migration or approved reset, deployment order and removal list.
Active Medusa integration may have advanced: rerun against its current executing
source before recommending promotion.

Passing the experiment does not authorize deploying or modifying existing data.
The owner chooses promotion, another hypothesis or retirement. Production must
not keep two settlement engines, an automatic fallback or permanent duplicate
schema authority as a consequence of this experiment.

## Iteration record

For each material candidate retain the hypothesis, changed modules, precise removed
work, source/settings fingerprint, behavioral witnesses, complete measurements
and accept/reject disposition. Store detailed receipts with the experiment's
validation artifacts and Git; keep these design files focused on current truth.

Incomplete database proofs or failed gates remain explicit. Root commit/review
rules still apply; an experimental label does not authorize committing failing
runtime work or deleting failed evidence to present a clean result.
