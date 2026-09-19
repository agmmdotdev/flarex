# Active Request Concurrency Baseline

Status: complete-request CMS concurrency baseline implemented under standing
core-redesign approval. The coordinated concurrency replacement remains open.

## Outcome And Evidence

Establish complete-request concurrency behavior before changing commit exclusion.
The existing CMS PostgreSQL test proves that another clock row can be locked
while one request holds its scope and build rows. That is insufficient evidence
that a second active scope can admit, materialize, publish and settle a request.
The active measurement fixture already supplies genuine activation, ordered and
unique maintenance certificates, actual commands and durable-state assertions.

Use two scopes in one PostgreSQL schema over the same generic physical families.
Hold the first request at the existing fault-injection boundary after its rows,
indexes, claims and publication prefix are written but before clock advancement
and COMMIT. A second scope must complete a real request while that barrier remains
closed, including with the same natural unique value and request key. Verify
scoped outcomes, claims, facts, wakes, dense clocks, unchanged build tuples and
cross-scope read isolation. Separate deployment metadata is part of this fixture;
it does not prove multi-scope hosting within one shared deployment installation.

Within one active scope, start both an independent insert and, separately, a
duplicate request against the held request. Observe the real PostgreSQL blocker
and waiting scope-clock statement before releasing it. Independent writes must
eventually publish both results without an OCC conflict; duplicate execution must
reuse one durable result and publish only once. The observed serialization is a
baseline to replace in the coordinated CE3 protocol, not a permanent requirement
that future independent preparation must block.

## Owners, Alternatives And Breaks

Extend the existing test fixture with scope-qualified inventory and its existing
CMS fault hook; keep production admission, materialization, recovery and locking
unchanged. Both fixtures must use the same physical tables and real authority.
Do not substitute manual row writes, a synthetic second clock, cloned authority,
an alternate publisher or a test engine. Remove the displaced clock-only
cross-scope assertion while preserving its other lifecycle-lock witnesses.

No production schema, API, storage or transaction break is required. The shared
test inventory changes from schema-wide to scope-specific; migrate its existing
single-scope users through the same helper. No compatibility branch is needed.
Use scoped fibers and bounded waits, release all barriers and await interrupted
work on failure. Do not claim parallelism from two sequential successful calls.

## Current Finding

The initial baseline located the same-scope wait in preparation's shared
scope-clock read. [Unlocked planning](./31-ce3-unlocked-planning.md) replaces that
preliminary exclusion: the active request witness now reaches the main exclusive
scope-clock acquisition while the first publication remains held. Its command
callback has not executed, and the first request's rows, memberships, claims
and publication prefix remain invisible to other connections. After release,
disjoint writes settle densely and duplicates reuse one outcome.

A different active scope still completes its full request before the barrier is
released. Shared physical families do not impose a global request mutex in this
composition. These witnesses distinguish cross-scope progress and same-scope
preparation overlap from parallel command execution. Authoritative validation,
sequence-consuming materialization and final publication remain protected by the
main clock; the coordinated CE3 replacement remains open.

The [physical deadline witness](./30-ce3-publication-deadline.md) extends this
baseline with a publication that never voluntarily resumes. The PostgreSQL
physical owner terminates its callback before COMMIT and releases or quarantines
its connection; durable state rolls back and explicit retry remains possible.
This is an existing owner guarantee to preserve, not another host timer or a
whole-request deadline covering preparation.

## Completion Gates And Limits

Keep PGlite coverage of the shared fixture and ordinary request/rollback/replay
semantics. Real overlap/blocking requires separate ordinary-role PostgreSQL
connections. Assert the held prefix is not externally visible, and verify pool
release after each experiment. Rerun the replaced CMS lifecycle test, affected
typecheck/lint and both reviewers; remove temporary resources and commit.

These deterministic witnesses establish isolation and blocking behavior, not
throughput, fairness or scale. Native/framework mixed traffic, lifecycle changes,
matched references and the new coordinated concurrency protocol remain open.
