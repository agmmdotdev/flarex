# Commit Compiler And Session Intent

## Add The Commit Compiler Turn Plan

Previous completed checkpoint: `478be74` Correct FlarexDB transaction and sync
design.

What changed:

- Added the executor-ready
  [commit compiler plan](./flarexdb-foundation/03-commit-compiler.md).
- Ordered narrow compatibility ports, versioned logical protocol, point
  read-your-writes, pure planning, atomic execution, idempotent finish,
  real-Postgres proof, and derived index/unique/edge lowering.
- Moved SessionDO journal storage to the final optional optimization turn after
  the compiler is proven through the current Postgres-backed journal path.
- Kept Payload and Medusa behind their own later adapter/transaction lanes.

Why it changed:

The current commit function mixes planning, validation, allocation,
publication, outbox, and session completion. A turn-by-turn split is required
before changing the storage generation or retry semantics safely.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/database/src/transaction.rs`
- `crates/database/src/reads.rs`
- `crates/model/src/session_requests/types.rs`
- `crates/application/src/application_function_runner/mod.rs`

How Flarex differs:

- Flarex authenticates a remote journal with a session anchor, attempt fence,
  protocol version, sequence, and digest. Those boundaries are unnecessary in
  the same form inside Convex's colocated backend.

Known limitations:

- No new compiler protocol, planner, executor integration, SessionDO journal,
  Payload lowerer, or Medusa lowerer is implemented by this docs checkpoint.

Verification:

```sh
git diff --check
```

## Correct Commit Compiler Trust And Transaction Boundaries

Previous completed checkpoint: `01c11ab` Clarify SessionDO cache read bridge.

What changed:

- Replaced the earlier universal `CommitIntent` proposal with four explicit
  boundaries: `SessionJournal`, `CommitEnvelopeV1`, trusted `CommitPlanner`, and
  authoritative `CommitExecutor`.
- Replaced `beginTs` ambiguity with one scope-local
  `SnapshotToken { scopeId, epoch, commitSeq }`.
- Limited the first SessionDO compiler slice to Flarex app operations whose
  read-your-writes overlay is complete.
- Kept a small authoritative Postgres session/grant anchor while allowing
  temporary read/write journals in SessionDO SQLite.
- Separated the generic app OCC lane, Payload adapter transaction lane, and
  Medusa-owned transaction lane.
- Required result-bearing idempotency, an explicit fenced session lifecycle,
  and separate OCC, SQL, and uncertain-outcome retry behavior.
- Removed caller-supplied physical scope, locks, unique-key rows, freshness
  rows, and system outbox rows from the commit protocol.

Why it changed:

The previous direction correctly kept user code outside the final SQL
transaction, but it gave the session intent too much authority and assumed that
Postgres fallback could repair unsupported read-your-writes overlays. It also
treated wall time and commit sequence as interchangeable and implied that
Payload and Medusa operations could use the same generic journal before their
transaction contracts were proven.

Those assumptions would allow stale mutation reads, forged or omitted system
side effects, ambiguous recovery after a lost response, and incorrect adapter
semantics.

## Accepted Runtime Split

| Component | Owns | Must not own |
| --- | --- | --- |
| Postgres/PGlite trusted executor | authority scope, catalog/policy lookup, snapshots, OCC, constraints, commit tokens, committed rows, idempotency outcome, commit feed, system outbox | long-running untrusted user code |
| Postgres session/grant anchor | scope, package/artifact, function, identity fingerprint, schema/policy version, snapshot, expiry, attempt fence, request identity | large mutation journal |
| SessionDO SQLite | temporary syscall sequence, logical app read dependencies, supported staged app writes, journal digest, supported overlay | committed authority or physical schema facts |
| Dynamic Worker | calls restricted generated APIs | raw SQL, raw database/DO handles, physical commit facts |
| Cache DOs | optional committed read accelerators | mutation snapshot authority, idempotency, locks, uncommitted overlay |

The current Postgres invoke-session implementation remains the compatibility
baseline. Moving a journal to SessionDO is an optimization behind a protocol,
not a reason to delete the authoritative session anchor.

## Snapshot Contract

Use one branded token everywhere:

```ts
type SnapshotToken = {
  scopeId: ScopeId;
  epoch: ScopeEpoch;
  commitSeq: CommitSeq;
};
```

Postgres obtains this token from the scope clock when it creates the attempt.
The same scope and epoch bind read dependencies, revisions, the session anchor,
the commit outcome, and the live-sync feed.

Mutation reads mean:

```text
authoritative state as of the exact SnapshotToken
+ supported SessionDO staged-write overlay
```

Do not use Worker wall-clock time as the authoritative snapshot. Do not accept
a cache value merely because its sequence is greater than the attempt's begin
sequence. A later value can violate the earlier snapshot.

V1 mutation reads use Postgres history. A future cache is eligible only when it
can return the MVCC version valid at the exact snapshot and prove absent
rows/ranges. Live queries use a separate `requiredFreshThrough` rule described
in `design-notes/postgres-authoritative-sync.md`.

Epoch rollover fences old sessions and forces subscription/client resnapshot,
but does not reset data. Scope-local commit/outbox sequences remain monotonic
and are never reused. Records that interpret those sequences carry epoch, and
an old-epoch attempt cannot commit.

## Protocol Boundaries

### SessionJournal

The journal stores logical, bounded facts:

```ts
type SessionJournal = {
  protocolVersion: 1;
  sessionId: SessionId;
  attempt: AttemptFence;
  nextSyscallSeq: SyscallSeq;
  reads: readonly LogicalReadDependency[];
  writes: readonly LogicalAppWrite[];
  result?: EncodedFunctionResult;
};
```

It does not store caller-authoritative physical table names, scope, actor,
locks, constraint rows, freshness atoms, or system outbox rows.

Apply incremental limits while recording each syscall, not only at finish:

- encoded journal bytes;
- read/write bytes and row counts;
- scanned rows and index/range reads;
- number of logical writes and domain-event requests;
- total execution and session lease time.

### CommitEnvelopeV1

At finish, SessionDO sends a small authenticated reference:

```ts
type CommitEnvelopeV1 = {
  protocolVersion: 1;
  sessionId: SessionId;
  attempt: AttemptFence;
  lastSyscallSeq: SyscallSeq;
  journalDigest: JournalDigest;
  encodedJournal: EncodedSessionJournal;
};
```

The executor loads the authoritative session anchor and verifies the attempt,
digest, expiry, function, package, identity, policy, catalog, snapshot, and
request identity before planning.

The trusted executor validates arguments against the pinned authoritative
argument validator before the attempt starts and validates the encoded return
against the pinned return validator before commit. Dynamic Worker validation is
only early feedback.
The anchor stores validated canonical arguments plus an authenticated inert
authorization grant with the claims/capabilities needed by policy, policy
version, expiry, and revocation epoch. Policy stays pinned for the short grant
lifetime unless the authoritative revocation epoch advances.

### CommitPlanner

The planner is a pure logical-to-physical lowering step after trusted catalog
and policy lookup. It:

- resolves stable logical table/index/relation/constraint identities;
- validates logical writes against the pinned schema and write policy;
- derives row revisions/current writes, ordered index keys, edge occurrences,
  unique keys, typed dependency checks, change atoms, and system outbox rows;
- invokes adapter-specific lowerers only for protocols explicitly supported;
- sorts locks and physical writes deterministically;
- returns typed preflight errors before the SQL transaction opens.

The planner never accepts raw SQL or arbitrary physical identifiers from the
Dynamic Worker journal.

### CommitExecutor

The executor owns the short physical transaction:

```text
load/lock scope commit lane and idempotency outcome
  -> verify session attempt and pinned authority
  -> validate typed read dependencies and constraints
  -> allocate commit sequence
  -> publish authoritative writes and sidecars
  -> store successful result-bearing idempotency outcome
  -> write commit/change atoms and system outbox
  -> mark session committed
  -> commit
```

All authoritative writers must acquire the scope-clock/commit-lane lock or use
a formally equivalent serializable/fencing protocol that participates in the
same conflict validation. Merely appending version/commit/outbox metadata is
not sufficient. This includes migrations, backfills, admin repairs, Payload,
and Medusa adapters.

## Session Lifecycle And Recovery

The state machine is:

```text
created -> running -> finishing -> committing -> committed
             ^                         |
             |                         | OCC conflict
             +------ retrying <--------+
                                       | aborted
                                       | expired
```

Required invariants:

- one active fenced attempt owner;
- an OCC conflict atomically moves the same request anchor through `retrying`,
  increments its attempt fence, replaces the snapshot lease, discards the old
  journal, and returns to `running` on the pinned storage generation;
- monotonic syscall sequence numbers;
- a canonical journal encoding and digest;
- no new syscall after `finishing` begins;
- repeated `finish` is idempotent;
- a restart can reconstruct or reject the attempt from durable state;
- a lost commit response is resolved from the authoritative outcome;
- abandoned journals and sensitive values have bounded TTL cleanup;
- committed/aborted/expired sessions cannot be reopened by a stale DO.

A minimal authoritative snapshot lease carries:

```text
scope_id, session_id, begin_epoch, begin_commit_seq, storage_generation,
storage_generation_fence, expires_at
```

History GC must not advance past the minimum active lease.

## Read-Your-Writes Support Matrix

Read-your-writes is a semantic requirement, not a best-effort optimization.

| Read after a relevant staged write | Initial policy |
| --- | --- |
| `get(id)` for an app row | Supported by exact local overlay |
| small app query with a proven local predicate/order overlay | May be enabled with conformance tests |
| index/range query without complete insertion, deletion, ordering, and pagination overlay | Reject |
| relation query without stable edge-occurrence overlay | Reject |
| table scan | Reject |
| Payload lifecycle/nested-field operation | Use Payload adapter lane or reject |
| Medusa repository/query operation | Use Medusa transaction lane; never generic fallback |

Falling back to Postgres after a relevant local write is incorrect because
Postgres cannot see the SessionDO journal. Recording a conservative dependency
can improve conflict detection, but it cannot repair the value already returned
to user code.

## Idempotency Contract

The database uniqueness/lookup key is:

```text
scope
client mutation/idempotency key
```

The stored row also carries:

```text
identity/access fingerprint
function reference
canonical argument/request hash
```

The successful encoded result, commit token, and relevant log metadata are
written in the same SQL transaction as the data and commit record. Reusing the
same key for a different identity, function, or request hash fails. After an
uncertain network response, the executor reads and replays the stored outcome.

Only the `in_progress` attempt lease expires. Committed request keys are never
reusable. After the result replay window, clear large result/log payloads but
retain a compact key + identity/function/hash + commit-token tombstone for the
scope lifetime; a late retry returns `CommittedResultExpired` and never reruns
the mutation. Tombstone compaction requires proof that the client request
namespace is permanently retired.

An index on an optional idempotency string is not sufficient. The database must
enforce the stable uniqueness boundary.

## Retry Classes

Do not use one generic retry loop:

1. An OCC conflict means the snapshot is invalid. Discard the journal and
   rerun deterministic user code from a new snapshot.
2. A SQL serialization failure or deadlock before a known commit decision may
   retry the same deterministic `CommitPlan` within a strict bound.
3. A connection loss with an uncertain commit decision must query the
   idempotency/session outcome before any retry.

Recognize both PostgreSQL serialization (`40001`) and deadlock (`40P01`) where
the physical adapter supports them. External side effects never run inside a
retriable mutation body or final commit.

## Adapter Boundaries

### Flarex App Data

The first compiler implementation is intentionally narrow:

- point CRUD over typed app row JSON;
- deterministic row revision/current, declared index, edge occurrence, and
  unique-key derivation;
- exact snapshot point reads and row dependencies;
- result-bearing idempotency and atomic commit/outbox.

Index/range/edge reads are added only with complete overlay and phantom tests.

### Payload

Payload transactions are an adapter contract, not automatically a
`SessionJournal`. Start with a small scalar CRUD/request-transaction slice over
reserved logical Payload collections. Add relations, collection/global
versions and drafts, polymorphic locks/auth, access rules, and hook ordering in
separate conformance-tested slices.

### Medusa

Medusa keeps its repository, transaction-manager, module, workflow, link, and
migration semantics in a trusted Postgres transaction lane. That lane writes
Flarex change atoms and outbox rows atomically with Medusa state.

There is no general atomic `ctx.db + ctx.commerce` transaction. Commerce
invariants and atomic extension writes belong behind a Medusa-owned
facade/workflow. Generic app state connects through stable commerce IDs and
transactional outbox processing.

## Final Transaction Optimization Order

Optimization must follow a proven protocol:

1. Bulk persistence helpers.
2. Typed set-based validation and write CTEs.
3. Optional versioned database-side commit function callable only by the
   executor role, with fixed search path and schema-qualified objects.

Do not create `select flarexdb_commit(jsonb)` before the input IR, authority
checks, typed errors, and idempotent recovery have conformance tests.

## Convex References

- `../../../crates/database/src/committer.rs`
  - validates transaction reads against writes after the begin snapshot and
    publishes ordered updates.
- `../../../crates/database/src/transaction.rs`
  - transaction-local reads, writes, and read-your-writes behavior.
- `../../../crates/database/src/reads.rs`
  - bounded read dependency accounting.
- `../../../crates/model/src/session_requests/types.rs`
  - durable session-request outcomes.
- `../../../crates/application/src/application_function_runner/mod.rs`
  - checks prior session requests and stores successful results atomically.

## How Flarex Differs

Convex keeps its function runner, transaction state, database engine, and
committer close together. Flarex crosses Dynamic Worker, Durable Object, and
Postgres boundaries. The Postgres session anchor, attempt fence, digest,
protocol version, and explicit recovery lookup are therefore required. A DO
journal is a latency optimization, never an authority transfer.

## Known Limitations And Next Gate

- Current code still uses Postgres invoke-session staging and a wall-clock
  `beginTs`; this document does not claim the new protocol is implemented.
- The shared app row/index/edge schema is not yet the current storage path.
- Exact range OCC and overlays remain unproven.
- Payload and Medusa adapter conformance remain separate projects.
- The per-scope commit lane is a safe v1 serialization point but may become a
  throughput bottleneck; measure it on real Postgres before partitioning it.

The next executor design/implementation gate is one end-to-end app point
mutation using the scope/epoch/commit-sequence token, fenced session anchor,
logical journal, trusted derivation, atomic result outcome, commit atoms, and
outbox.

## Verification

Docs-only checkpoint:

```sh
git diff --check
```

## Superseded Checkpoint

The original checkpoint, `fc5a78b` Document commit compiler session intent,
established the useful idea of temporary SessionDO intent plus a short
Postgres-authoritative final commit. It is superseded only where it used an
ambiguous `beginTs`, allowed caller-described physical/system batches, treated
unsupported overlay reads as Postgres fallbacks, and implied one compiler could
cover Payload and Medusa before adapter parity.
