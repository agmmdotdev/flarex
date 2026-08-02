# Second FlarexDB System API Vertical: One Point Query

## Status And Scope

**Status:** active private implementation plan. `PQV-A1` is complete.
`PQV-A2` and `SAP05` remain separate later gates. Roadmap 43 stays
closed as the completed first relation-free point-mutation vertical.

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

## `[ ] PQV-A2`: Candidate-Bound Exact Query Runtime And ABI

PQV-A2 is a separate protocol/runtime capability. It must bind the PQV-A1
selection and snapshot to the exact candidate, query function, projection,
function group, R2 references, budgets, cancellation, document-read syscall,
argument validator, and result validator. R2 remains the sole body store.
It must not widen the mutation-only FSV06-A1 identity, invent a second snapshot
engine, or use the legacy query executor as a fallback.

## `[ ] SAP05`: Invoke One Standard Application Point Query

After PQV-A1 and PQV-A2 are accepted, implement the private System operation
`invokeApplicationPointQueryV1` and thin Standard
`invokeStandardApplicationPointQueryV1`. The operation returns only a validated
query result and proves that no mutation journal, app-row revision, committed
outcome, commit/change feed, or outbox fact is produced. This remains private,
route-independent, and production-inert; it is not FSV07 or a public SDK.
