# Second FlarexDB System API Vertical: One Point Query

## Status And Scope

**Status:** complete private implementation vertical. `PQV-A1`, `PQV-A2`, and
`SAP05` are complete. Roadmap 43 stays closed as the completed first
relation-free point-mutation vertical. This completion remains private,
route-independent, and production-inert; it does not authorize FSV07 or a
public query API.

This roadmap owns one bounded, route-independent, production-inert point-query
vertical:

```text
coherent FSV05 active revision
  -> PQV-A1 scoped target-native snapshot and bounded point reads
  -> PQV-A2 candidate-bound exact query runtime and syscall ABI
  -> SAP05 private System query plus thin Standard consumer
  -> validated query result with no mutation publication
```

It does not authorize FSV07, a public SDK, production routing, actions,
workflows, schedules, nested calls, generic queries, SQL batches, relations,
developer indexes, Payload, Medusa, or a second read/OCC/commit system.

## Existing Owners And Missing Composition

- FSV05 owns the coherent, Scope-revoked active-revision selection and exact
  scope generation/fence/epoch plus schema/function evidence.
- `getAppRowAtSnapshotInTransactionEffect` owns target-native authoritative
  document history reads at an exact `SnapshotToken`.
- the located scope clock owns the current commit sequence and inclusive
  `oldest_available_commit_seq` history floor.
- the current `fx_system_snapshot_lease` is mutation-session/attempt authority;
  it is not a general query lease and must not be repurposed.
- FSV06-A1 and the generated exact runtime are deliberately mutation-only.
  PQV-A2 must add a separately reviewed query target/ABI rather than widening
  the mutation identity or falling back to legacy `SingleShardTransaction`.

## `[x] PQV-A1`: Scoped Target-Native Point-Query Snapshot Authority

### Authority And Lifetime

PQV-A1 derives one process-local WeakMap-authenticated capability from one live
FSV05 selection inside `Scope.Scope`. Opening it resolves the trusted target,
locks the located scope clock for share in one short READ COMMITTED transaction,
revalidates the exact active selection, and captures:

- deployment and scope identity;
- `flarexdb_v1` storage generation, generation fence, and scope epoch;
- the exact active revision, activation head, readiness receipt, candidate,
  schema, and canonical function-metadata commitments;
- one selected public query function's canonical metadata; and
- `SnapshotToken { scopeId, epoch, commitSeq }` at the authoritative clock.

Scope finalization revokes the exact capability. Structural clones, foreign
capabilities, closed scopes, mixed selections, and caller-authored snapshot
tokens never authorize a read.

### Retained-History Decision

PQV-A1 does not create or borrow a snapshot lease. The retained floor is fixed
at `0` today because O11 has no writer. Every point read nevertheless locks the
scope clock for share, revalidates generation/fence/epoch and the active head,
then verifies the inclusive retained floor is not greater than the pinned
snapshot before reading history. The lock prevents a future compliant O11
floor advancement from racing that read. If O11 later advances the floor, an
already-open capability fails typed-stale once its snapshot is outside retained
history. A future product requirement for query snapshots that survive floor
advancement requires a separately approved query-lease owner; Scope lifetime
alone is not a retention pin.

### Read Contract

PQV-A1 permits only a bounded document point read identified by an active
schema table name and a canonical document ID for that exact table. Each read:

1. charges the capability's atomic count budget;
2. opens one short located READ COMMITTED transaction;
3. locks and revalidates the scope clock and active head;
4. validates the retained floor;
5. delegates to the existing exact-snapshot app-row kernel; and
6. returns only an owned immutable document value or `missing`, then charges
   the cumulative returned-document byte budget.

It exposes no transaction, database, read set, raw row revision, write,
journal, index scan, commit, feed, outbox, route, or runtime invocation.

### Failure Ownership

Owner failures remain direct: trusted target resolution, scope-clock locking,
active-selection revalidation, canonical function metadata, and app-row read
errors are not collapsed. PQV-A1 adds only tagged invalid-capability/input,
unsupported-target/function, retained-history-stale, corruption, budget, and
foreign integration failures. Interruption remains in full `Cause`; defects
are not converted into ordinary failures.

### Acceptance Evidence

- PGlite and genuine PostgreSQL prove open/read/missing/repeated pinned reads,
  stale generation/fence/epoch/head/floor,
  forged/cloned/closed/mixed authority, invalid identities, cancellation,
  budgets, and cold reconstruction through a new coherent selection.
- Genuine PostgreSQL uses independent connections and a scope-clock barrier to
  prove a writer cannot advance the clock while a pinned read holds its share
  lock, then proves deterministic reader and writer settlement.
- before/after evidence proves no app-row mutation, journal acceptance,
  committed outcome, commit/change-feed, or outbox publication.
- PostgreSQL reports the real server version and zero skipped dedicated cases.
- package typecheck/build, database metadata, Effect-boundary, diff checks, and
  both exact-final project reviewers pass.

## `[x] PQV-A2`: Candidate-Bound Exact Query Runtime And ABI

PQV-A2 is a separate protocol/runtime capability, not a variant or widening of
the mutation-only FSV06-A1 identity. Its private persistence adapter proves
that one live PQV-A1 snapshot and one live FSV05 selection bind the same active
revision, candidate, scope generation/fence/epoch, query function, canonical
function metadata, transaction projection, and function-group publication.
The adapter exposes only immutable authority facts; the PQV-A1 capability
remains the sole database-read authority.

The backend then owns one separately versioned query target/profile/ABI. Its
canonical target binds those authority facts plus the pinned snapshot commit,
exact query handler/module/export/group, compatibility date, checked Worker
graph basis, R2 projection/module/manifest references, and bounded execution
policy. Cold materialization reads every required body from R2, verifies its
codec, length, digest, kind, candidate relationship, group, module order, and
manifest roots, and builds an exact query-only registry and Worker definition.
PostgreSQL never stores those bodies.

The only syscall is the existing PQV-A1 point-document read. A scoped opaque
runtime target retains the exact live snapshot capability and delegates every
read through `readApplicationPointQueryDocumentV1`; it exposes neither that
capability nor a database or transaction handle. The query runtime admits one
public query, validates canonical arguments and results against the registered
validators, preserves typed read and budget failures, leaves interruption in
full Cause, and revokes its target at Scope close. Writes, index scans,
pagination, nested calls, actions, mutations, journals, outcomes, feeds,
outbox publication, and an alternate snapshot/OCC/commit path are unavailable.

Acceptance requires deterministic protocol and Worker-graph vectors; genuine
query-handler reads of present and missing documents; hostile function,
validator, authority, R2 reference/body, projection, manifest, group, module,
budget, cancellation, stale, superseded, and closed-scope cases; warm/cold
replay; PGlite and genuine PostgreSQL lifecycle/concurrency proof; a real
Worker-runtime lane; exact no-mutation-publication evidence; proportional
regressions; and both final project reviewers. PQV-A2 remains private,
route-independent, production-inert, and unwired. It does not authorize SAP05.

The accepted implementation uses
`flarex.system/candidate-bound-query-runtime-target/v1`,
`point-query-exact-runtime-v1`, and
`flarex.system/point-query-syscall-abi/v1`. The persistence adapter joins the
live FSV05 selection to the live PQV-A1 capability without exporting either
raw authority. The backend verifies every selected publication object through
its content-addressed R2 reference, builds the exact query-only registry and
Worker graph, and retains the PQV-A1 capability behind a Scope-revoked opaque
target. The only database syscall delegates to PQV-A1 point-document read.
Immediately before handler dispatch, the target also invokes PQV-A1's located
liveness revalidation, so a zero-read handler cannot run after its active
revision, scope authority, or retained snapshot has become stale.
Protocol, function-runtime, Workerd, PGlite, and genuine PostgreSQL acceptance
lanes prove query-only execution, cold replay, hostile authority and artifact
rejection, bounded cancellation, and no mutation publication. There is no
schema migration, PostgreSQL body storage, route, trigger, or production
consumer.

## `[x] SAP05`: Invoke One Standard Application Point Query

The accepted implementation provides the private System operation
`invokeApplicationPointQueryV1` and thin Standard
`invokeStandardApplicationPointQueryV1`. The operation returns only a validated
query result and proves that no mutation journal, app-row revision, committed
outcome, commit/change feed, or outbox fact is produced. This remains private,
route-independent, and production-inert; it is not FSV07 or a public SDK.

The accepted composition reads one coherent FSV05 selection, opens one scoped
PQV-A1 snapshot, derives one PQV-A2 target from the exact candidate/R2
publication, and dispatches the generated query-only Worker through a private
route-independent host port. The only runtime database operation delegates to
the live target's PQV-A1 point-document read. Snapshot table bindings are
projected only from the authenticated captured schema manifest; callers cannot
author table IDs, snapshot tokens, runtime targets, or database handles. After
the foreign Worker boundary, the scoped PQV-A2 target re-applies the exact
registered return validator with those authenticated table bindings before the
System operation returns the canonical value.

`@flarex/standard-application-invocation` owns the private System service/Layer
and thin Standard consumer. Their Effects retain `Scope.Scope`; scope closure
revokes the active selection, snapshot, and runtime target and releases the
Worker host. Owner failures remain typed, foreign Worker dispatch failures are
classified at the private host port, cleanup uncertainty remains typed, and
read defects, unknown Worker failures, and interruption retain their full
Cause across the test-owned Workerd bridge. The
dedicated PGlite and genuine PostgreSQL lanes cross real Standard definition,
analysis, inactive registration, readiness, activation, active read, PQV-A1,
PQV-A2 R2 materialization, and Workerd execution. They cover present/missing
documents, invalid arguments and foreign result rejection, unknown functions,
closed authority, corrupt R2 content, cancellation, read defects, cleanup
uncertainty, cold reconstruction, deterministic unchanged-state replay, and
exact before/after proof of zero mutation publication.
