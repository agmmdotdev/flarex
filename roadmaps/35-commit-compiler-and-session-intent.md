# Commit Compiler And Session Intent

## Status And Scope

Status: accepted bounded design with an implemented `legacy_v1` prototype path;
standalone `C01` was retired before implementation. C02's replacement logical
journal/result/envelope protocol, C03's first trusted Postgres point-journal
consumer, and C04A's private exact stored-attempt authentication are complete;
C04B1's same-factory current commit-authority authentication and C04B2's
private-C07 final-document/result proof are also complete. Corrected C04C1
private logical point planning is complete; C04C2 remains
conditional and unapproved.

This roadmap owns the durable direction for:

- the logical session journal and integrity-bound finish envelope with trusted
  carriage provenance;
- private logical point planning and consumer-owned physical lowering;
- the authoritative short Postgres commit executor;
- session fencing, lifecycle, restart, expiry, and lost-outcome recovery;
- exact-snapshot read-your-writes rules;
- result-bearing idempotency and distinct retry classes;
- the narrow Flarex app-data compiler boundary; and
- the evidence gate for optionally moving temporary journal persistence from
  Postgres to facet-backed per-session Durable Object SQLite.

This roadmap does not own:

- physical schema/catalog construction, target activation, prototype
  retirement, or conditional shipped-state migration;
- the low-level OCC transaction primitives;
- live-query activation, commit-feed catch-up, or cache coordination;
- Payload database parity or Medusa transaction semantics; or
- chronological implementation history.

Roadmap 20 owns the executor/data authority, roadmap 21 owns sync/freshness,
and the focused foundation plans own executable turn order. Git owns the
historical checkpoint record previously accumulated here.

## Current Sources Of Truth

Use these sources in order:

1. [`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md)
   owns the accepted snapshot, compiler trust, idempotency, retry, adapter,
   replacement, and conditional migration boundaries.
2. [`flarexdb-foundation/README.md`](./flarexdb-foundation/README.md) owns the
   interleaved schema/OCC/compiler execution order.
3. [`flarexdb-foundation/03-commit-compiler.md`](./flarexdb-foundation/03-commit-compiler.md)
   owns the C01 retirement decision and executable `C02` through `C09` gates.
4. [`flarexdb-foundation/02-occ-and-transactions.md`](./flarexdb-foundation/02-occ-and-transactions.md)
   owns snapshot issuance, session anchors, OCC validation, atomic outcome,
   retention, and retry primitives consumed by the compiler.
5. [`20-postgres-executor.md`](./20-postgres-executor.md) owns current storage
   generations, the hosted Worker, and production routing.
6. [`21-cloudflare-freshness-cache.md`](./21-cloudflare-freshness-cache.md) owns
   the distinct live-query freshness rule and deferred committed-read caches.
7. Current code and decisive tests prove exact implemented behavior. The active
   replacement session-start boundary is:
   - [`packages/executor/src/pointMutationSessionActivation.ts`](../packages/executor/src/pointMutationSessionActivation.ts)
   - [`packages/persistence-postgres/src/transactionSessionActivation.ts`](../packages/persistence-postgres/src/transactionSessionActivation.ts)
   The older prototype behavior remains visible in:
   - [`packages/executor/src/sessions.ts`](../packages/executor/src/sessions.ts)
   - [`packages/executor/src/retry.ts`](../packages/executor/src/retry.ts)
   - [`packages/persistence-postgres/src/commits.ts`](../packages/persistence-postgres/src/commits.ts)
   - [`packages/persistence-postgres/src/invokeSessions.ts`](../packages/persistence-postgres/src/invokeSessions.ts)
   - [`packages/persistence-postgres/src/invokeSessionReads.ts`](../packages/persistence-postgres/src/invokeSessionReads.ts)
   - [`packages/persistence-postgres/src/invokeSessionTableReads.ts`](../packages/persistence-postgres/src/invokeSessionTableReads.ts)
   - [`packages/persistence-postgres/src/invokeSessionIndexReads.ts`](../packages/persistence-postgres/src/invokeSessionIndexReads.ts)
   - [`packages/persistence-postgres/src/invokeSessionWrites.ts`](../packages/persistence-postgres/src/invokeSessionWrites.ts)
   - [`packages/executor/test/sessions.test.ts`](../packages/executor/test/sessions.test.ts)
   - [`packages/executor/test/postgresRetry.test.ts`](../packages/executor/test/postgresRetry.test.ts)

[`../design-notes/flarex-instant-like-medusa-storage.md`](../design-notes/flarex-instant-like-medusa-storage.md)
is long-form research and provenance. Its historical mixed-transaction and
cache-first proposals are not accepted when they conflict with the sources
above.

## Current Architecture

### Implemented legacy path

The working `legacy_v1` path is:

```text
prepare invoke metadata
  -> begin Postgres invoke session at wall-clock beginTs
  -> execute user code outside a transaction
  -> persist document/table/index reads and staged document writes
  -> serve supported read-your-writes overlays
  -> finish through commitInvokeSessionWrites(...)
  -> validate legacy read sets
  -> allocate a wall-clock-compatible commit timestamp
  -> write documents, indexes, commit row, outbox, and finished session
     in one persistence transaction
  -> trigger post-commit live-query work
```

The prototype path supports inserts, patches, replaces, deletes, point
reads, table scans, index reads, staged-write coalescing, point/table/index
overlays, OCC conflicts, mutation reruns, abort, stale-session cleanup, commit
rows, outbox rows, and post-commit notification.

This is evidence for behavior worth preserving. It is not the accepted
replacement because it still uses deployment/partition vocabulary, wall-clock
`beginTs`/commit timestamps, broad persistence interfaces, one mixed commit
function, optional idempotency metadata without the final outcome contract,
and a combined retry coordinator.

The repository defines the branded `SnapshotToken` protocol type and a private,
non-routing resolver that captures one ephemeral exact snapshot plus its
generation/fence from trusted placement and the data-plane scope clock. Current
invoke sessions do not use that selection as read/commit authority. S07's
physical transaction-session/snapshot-lease tables are now consumed by private,
non-routing activation/reload/terminalization and C03 point-journal operations,
but no production route uses them. `SessionJournalV1`, separate successful-
result evidence, and `CommitEnvelopeV1` form the host-neutral contract sealed by
that private C03 consumer. C04A authenticates the exact stored seal, and C04B1
authenticates current stored argument/grant/revocation/schema authority into a
second same-factory process-local capability. C04B2 now mints private
same-factory `VerifiedCommitInputV1` after zero-I/O final-value/result proof;
corrected private `PreparedPointCommitV1` planning belongs to the approved
C04C1 gate. Physical/change/outbox lowering remains with S08/S09-A/S09-B/O06/
O07 unless those first consumers later justify conditional C04C2.

### Accepted replacement boundary

The replacement separates protocol evidence from private logical planning and
transaction-owned physical execution:

```text
SessionJournalV1
  bounded logical point-read dependencies and raw staged logical writes

SuccessfulResultEvidenceV1
  separate canonical Value Codec result bytes, semantic size, and digest
             |
CommitEnvelopeV1
  protocol versions, session id, attempt fence, final syscall sequence,
  stored-attempt or dormant inline-untrusted carriage and journal digest,
  sibling successful-result evidence
             |
AuthenticatedStoredAttemptV1 (introduced by C04A)
  runtime-unforgeable process-local proof of the exact stored seal
             |
AuthenticatedCommitAuthorityV1 (introduced by C04B1)
  current database-time argument/grant/revocation/schema authority
             |
VerifiedCommitInput (introduced by C04B2)
  private-C07 logical proof using already-authenticated pinned proof validators
             |
PointCommitPlannerV1 (introduced by C04C1)
  same-factory database-free logical point/dependency planning
             |
PreparedPointCommitV1 (introduced by C04C1)
  internal immutable logical capability; never serialized over /invoke/*
             |
CommitExecutor
  authority/fence checks, actual SQL locks, OCC, physical revision/current
  lowering, sequence/time allocation, atomic publication, outcome, feed/outbox
```

The compiler is a lowering boundary, not a new authority. User code and the
journal describe logical operations only. C04C1 retains authenticated logical
dependencies, net final logical row intent, and successful result evidence. An
insert followed by delete keeps its qualified-missing dependency but produces
no row intent; only deletion of a snapshot-present row produces a logical
delete. O06/O07 later derive and publish physical rows, locks, change atoms,
and system outbox records under current transaction authority; O09 owns
multi-row/unique ordering.

### Authoritative session anchor

Postgres stores immutable request authority on one transaction-session anchor:

```text
native scope/session identity and immutable flarexdb_v1 generation/fence
package/dynamic-worker artifact/mutation function/schema/policy pins
canonical argument JSON, Value Codec V1 bytes, and SHA-256
cryptographic identity/access-policy SHA-256 for matching only
canonical grant JSON/bytes/SHA-256 containing minimized inert claims and
  capabilities, plus grant identity, expiry, and revocation epoch
internal request key bounded to 1,024 UTF-8 bytes, request hash, lifecycle,
  current attempt fence, protocol version, hard expiry, and timestamps
```

One constrained snapshot-lease row stores only the exact current attempt fence,
`SnapshotToken`, and lease expiry. It is not a second generation or request
authority, and parent updates/deletes do not cascade through it. S07 defines
these physical rows; S07-A supplies current revocation storage, O03-A supplies
signed-grant semantics, O03-B1 owns atomic activation/exact active-anchor
replay, O03-B2a owns restart-safe exact-attempt reload, and O03-B2b1 owns
exact abort/expiry terminalization and active-child invariants. Conditional
O03-B2b2 renewal belongs to its first proven long-running-attempt consumer. C02
owns only canonical sequence fields, logical evidence shapes, and integrity
digests; C03 owns operational sequencing, accounting, and the first trusted
stored attempt journal; C04A owns exact stored-evidence authentication, C04B1
owns current commit-authority authentication, C04B2 owns final value/return
verification and `VerifiedCommitInput`, and C04C1 owns only concrete private
logical `PreparedPointCommitV1`. Conditional C04C2 exists only if S08/S09-A/
S09-B/O06/O07 later prove a separate physical lowering capability useful. C03 seals while
the attempt is `running`, and
the sealed root rejects late syscalls. C05 locks and revalidates the scalar seal
identity before the private exact-fence transition to `finishing`; C06
orchestrates it idempotently through the finish endpoint. O07 atomically
deletes the exact lease and stores committed state plus the internal S09-A
committed-success receipt and S09-B outbox, O08 owns retry replacement, and O11
first consumes active floors.

Temporary journal placement does not change this anchor. Reloading it
authenticates the exact Postgres attempt and fences stale attempts; it does not
authenticate arbitrary inline journal bytes. SHA-256 supplies integrity only.
Through C07, C04A may operationally consume only the exact journal/result seal
reloaded from the C03-owned Postgres store.

### Conditional facet-backed journal placement

The C02 `inlineUntrusted` carriage is schema-defined but dormant. If `C07A`
selects Durable Object placement and first proves non-forgeable provenance for
the exact supervisor/facet call path (or an equivalent host capability), use
one server-issued supervisor
Durable Object per top-level query/mutation session and one dynamically loaded
facet per positive attempt fence. Do not use one execution actor per scope or
deployment. The exact content-addressed artifact remains pinned by the
authoritative Postgres session anchor and loaded from the existing artifact
store; supervisor or facet SQLite is not a second code authority.

The generated facet shell records the bounded logical journal and supported
read-your-writes overlay in its isolated SQLite while actual snapshot reads
still cross the restricted executor syscall capability. On handler completion,
the facet seals canonical journal bytes, separate successful-result evidence,
final syscall sequence, digest, session identity, and attempt fence. Because Cloudflare
isolates parent and facet storage, the supervisor retrieves that envelope only
through an RPC or `fetch` call on the exact facet stub; it cannot query the
child database directly. The supervisor then forwards the envelope to trusted
executor finish.

The executor treats the returned journal as logical intent, not a transaction
or authoritative row set. Inline evidence is consumable only under the C07A
provenance boundary; a matching digest plus session/fence is insufficient. It
reloads and validates the Postgres anchor and
lowers the verified operations into physical revisions/current rows, derived
sidecars, result-bearing idempotency outcome, commit/change feed, and outbox.
Commit/abort/expiry deletes the attempt facet. OCC retry advances the trusted
attempt fence, discards and deletes the old facet, issues a new exact snapshot,
and creates a fresh facet before rerunning deterministic user code.

Facet SQLite can preserve a sealed envelope across hibernation, but it cannot
resume an interrupted JavaScript call stack. Mid-handler failure reruns a new
attempt; uncertain finish outcome first consults Postgres. Cleanup is bounded
and idempotent, and an abandoned facet can never reopen a terminal session.

### Snapshot contract

The replacement token is:

```ts
type SnapshotToken = {
  scopeId: ScopeId;
  epoch: ScopeEpoch;
  commitSeq: CommitSeq;
};
```

Mutation reads mean exactly:

```text
authoritative Postgres state as of SnapshotToken
+ the attempt's supported staged-write overlay
```

A cache value from commit 105 cannot serve a mutation snapshot at commit 100
merely because 105 is newer. V1 mutation/session reads use Postgres history.
A future cache must return the MVCC version valid at the exact token and prove
missing rows/ranges. Live queries have a different
`requiredFreshThrough` rule owned by roadmap 21.

Epoch rollover fences old attempts and forces resnapshot. It does not reset
authoritative data or reuse scope commit/outbox sequences.

### Session lifecycle

The accepted fenced lifecycle is:

```text
atomic activation -> running -> finishing -> committed
                        ^          |
                        |          +-- trusted OCC conflict -> retrying --+
                        +-----------------------------------------------<--+

running or finishing -> aborted | expired
```

O03-B1 commits initial activation directly as `running` and exactly replays only
the same live request anchor. O03-B2a reloads one exact active attempt after
fresh placement and database revalidation; O03-B2b1 adds exact abort/expiry
terminalization and closes the required pre-consumer session-authority core.
O03-B2b2 renewal is conditional on a proven long-running-attempt consumer.
S07's `created` literal is not a durable active state without a lease.
S07's `committing` literal is
also transaction-local/reserved in V1 rather than a separately durable state.
C05 introduces the private exact-fence transition to `finishing`; C06
orchestrates it idempotently through the finish endpoint, and C03 rejects late
syscalls. O07 deletes the exact current lease and records `committed` only with
atomic data/outcome publication. O08 keeps the same request anchor and storage
generation during trusted OCC retry, increments the attempt fence, replaces
the snapshot lease, discards the old journal, and reruns deterministic user code
at a new snapshot. A stale journal or Durable Object cannot reopen a terminal
session.

### Planner and executor split

Before planning, trusted code verifies in distinct authority stages:

- C04A accepts `storedForSessionAttempt` carriage through C07, followed by an
  exact opaque-authority reload of the C03-owned journal/result/point seal and
  comparison of canonical bytes, digests, final syscall sequence, counters,
  sibling result evidence, and the complete scalar seal identity;
- protocol versions and structural evidence. `inlineUntrusted` is rejected
  regardless of a matching digest until C07A proves its provenance boundary;
- C04A accepts only a live `running + sealed` attempt for initial planning or
  `finishing + sealed` for reconstruction; committed is typed already-
  committed/non-plannable and replay stays with C06/O07;
- C04B1 accepts only a genuine same-factory C04A capability, then uses one
  bounded read-only repeatable-read snapshot and one database timestamp to
  reauthenticate stored arguments/grant, current revocation, immutable pinned
  schema, and corroborating stable bindings. It closes SQL before JSON/Schema,
  SHA-256, Ed25519, and immutable proof-metadata work and returns only
  `AuthenticatedCommitAuthorityV1`;
- C04B2 accepts only the genuine same-factory C04B1 capability, performs no
  database/catalog/clock/metadata I/O, validates complete live final documents
  and recanonicalized successful-result evidence against already-authenticated
  pinned proof validators, and produces private `VerifiedCommitInputV1`; and
- C04C1 performs only same-factory database-free deterministic logical point
  lowering. C04C2 remains conditional and unapproved.

Only runtime-unforgeable process-local authenticated and verified capabilities
can reach the pure planner. The planner accepts
no database handle, clock, network service, raw SQL, untrusted physical name,
or transaction-specific sequence/lock fact. C04A's one bounded read-only
repeatable-read transaction closes before canonical decoding, hashing, Schema
validation, or point correlation; C04B1's second bounded snapshot likewise
closes before payload decoding and cryptography. C04B2/C04C1 finish before the
later commit transaction opens. Identical authenticated inputs produce
equivalent deterministic logical plans and contained bytes.

C04B1 shares the exact grant-verification kernel with prepared-start
verification without manufacturing that handle. Both trusted preparation
paths and the stored recheck apply Convex's exact implicit argument-array cost:
`2 + argumentSemanticBytes <= 16 MiB`. Separately, C04B1 rejects more than
64 MiB across stored argument JSON/bytes, grant JSON/bytes, and pinned-schema
JSON/bytes before selecting those payloads. That six-representation ceiling is
a Flarex materialization/corruption guard, not a Convex semantic.

The immutable setup-seeded function metadata remains a temporary proof adapter:
its consumer is the private C07 proof, its reason is deferred production
activation-snapshot authority, and roadmap 17 plus S03-D4/S04 publishing one
coherent package/artifact/source/function-validator/schema snapshot is its
deletion/replacement gate. Production selection cannot reach it, and C04B1
does not consult `activePackageId`, `analysisJson`, or an active-schema pointer.

C04B2 is only the private C07 consumer of that authenticated proof adapter. It
does not promote mutable current metadata into production authority. It also
validates after execution and final overlay construction, whereas Convex
normally validates writes at syscall time. The later production preflight must
decide whether a narrow pinned validator capability moves into C03 to restore
syscall-time/catchable-failure parity. Roadmap 17 plus S03-D4/S04 continue to
own the coherent activation-fenced package/artifact/source/function-validator/
schema snapshot.

The commit path then:

```text
fast S09-A committed-outcome lookup outside SQL
  -> begin transaction and lock scope commit lane
  -> recheck session, attempt, generation, epoch, and authority
  -> validate typed dependencies and constraints
  -> allocate commit/outbox sequences
  -> publish row revisions/current rows and derived sidecars
  -> insert the S09-A successful receipt
  -> write S08 commit/change atoms and S09-B system outbox
  -> mark session committed
  -> commit
```

Untrusted user code never runs while this transaction is open.

## Read-Your-Writes Contract

Read-your-writes is a semantic requirement, not an optimization. After a
relevant staged write, falling back to Postgres is incorrect because Postgres
cannot see the private journal.

| Read shape after a relevant staged write | Initial replacement policy |
| --- | --- |
| App `get(id)` | Exact local overlay |
| Point insert/patch/replace/delete | Exact deterministic coalesced overlay |
| One specifically proven indexed query | Enabled only after its overlay and phantom tests pass |
| Other index/range/relation/scan/pagination shapes | Typed rejection |
| Payload operation | Payload adapter lane or rejection |
| Medusa operation | Medusa transaction lane; never generic fallback |

C03 incrementally enforces the applicable Convex execution ceilings: 32,000
documents read, 16 MiB of document bytes read, 4,096 point-read dependencies,
16,000 user write operations before same-row coalescing, 16 MiB of resulting
write-document bytes, and 16 MiB of successful-result semantic bytes.
Structurally derivable totals are recomputed instead of trusted from envelope
aggregates; C03 owns or verifies non-derivable read rows/bytes. C02 defines no
scan counter, syscall-count authority, or journal-authored lease time.

The separate 64 MiB canonical-evidence ceiling is a Flarex resource/transport
divergence based on Convex's bounded function-runner response, not a transaction
semantic. C07A must re-prove the appropriate hosted transport ceiling before it
activates inline carriage. Temporary-evidence TTL remains owned by the journal
store and lifecycle/retention gates.

C03 also enforces a distinct 64 MiB cumulative
`materialWriteEventEvidenceBytes` ceiling over temporary canonical event rows.
That ceiling prevents Postgres amplification from patch/remove-heavy raw events;
it is not a Convex transaction semantic, final-journal substitute, lease, or
hosted transport guarantee. The final canonical journal retains its independent
64 MiB gate.

### Current C03 operational contract

- C03A resolves only one opaque point-table capability from the session-pinned
  deployment/schema version and table name. The immutable manifest is
  authoritative; the stable binding corroborates the same ID. The mutable
  active-schema pointer is never consulted, while C04B1 reauthenticates the
  complete pinned schema and stable bindings, C04B2 retains final value/return
  validation, and C04C1 retains only final logical point/dependency planning.
  O06/O07 retain physical revision/current lowering and publication.
- Initial activation creates the exact-attempt root with database time as its
  `_creationTime` seed/cursor. Insert draws exactly one server UUIDv4 only after
  replay classification, uses the current binary64 time, and atomically advances
  to `nextUp`. Live and historical-tombstone collisions fail closed; replay
  draws neither a new ID nor a new time. O08 must repeat root creation with a
  fresh database-time seed for every new attempt.
- The durable replay surface is one latest receipt, not syscall history:
  `last + 1` executes; byte-identical `last` replays; changed `last` conflicts;
  lower values are stale; higher values are gaps. Per-attempt executor
  serialization guarantees a lost response for `N` is resolved before `N + 1`.
  Missing, no-op, and catchable failures advance the same receipt without
  cardinality growth; incremental resource failure is sticky.
- Point dependencies and raw successful material-write events are separate.
  Dependencies keep immutable present or qualified-missing OCC evidence and a
  deterministic final-row overlay. Raw events preserve pre-coalescing operation
  accounting. Overlay reads add Convex-compatible logical row/byte accounting
  but no second Postgres base-row read.
- Each material event is strictly normalized and canonicalized once, charged
  before mutation, and inserted from that same detached evidence. Overflow
  advances the sequence into a replayable sticky failure without an event,
  overlay change, or counter overflow; no-op/catchable failures consume zero.
- Seal preparation selects at most each child limit plus one under read-only
  repeatable read and detaches raw rows before closing SQL. It rejects excess
  cardinality before decoding, recomputes event bytes against the root counter,
  and keeps the private candidate and strict successful-result evidence
  detached from callers. Canonicalization and SHA-256 occur after the
  transaction closes. A short normal exact-attempt lock path revalidates and
  stores the sealed journal and sibling result; changed evidence rejects the
  stale candidate. Only `storedForSessionAttempt` is produced.
- Abort and expiry lock and delete the exact root before lease deletion and
  terminal session update, cascading all temporary children atomically. A
  terminal session with retained journal evidence, or a running session without
  its exact root, is corruption.

## Idempotency And Recovery Contract

S09-A defines the private uniqueness key `(scope_uuid, request_key)`. The
current `request_key` is the server-prepared internal
`TransactionRequestKeyV1`, not the final public client namespace. It is
nonblank and bounded to 1,024 UTF-8 bytes. Each committed-success row binds the
exact identity/access-policy and canonical-request SHA-256 evidence, mutation
function path, and immutable positive `(epoch_uuid, commit_seq)` receipt.

`available` retains strict Value Codec V1 successful-result bytes, digest, and
semantic size; `expired` retains no result evidence and records a finite
database-owned expiry timestamp. There is no in-progress, error, diagnostic-
failure, log, claim, or attempt-expiry row. This matches Convex's success-only
recording but deliberately omits Convex log-line replay in the private C07
proof. Public key mapping and log parity require a later preflight.

O07 later inserts the outcome atomically with data, committed session state,
the S08 header/change atoms, and S09-B outbox. Reusing a key for another
identity, function, or request fails. Repeated finish and lost-response lookup
remain C06/O07 behavior, not S09-A schema behavior. After payload expiry the
compact committed receipt remains for the scope lifetime; late retries return
`CommittedResultExpired` and never rerun the mutation.

The commit token has no foreign key to compactable S08 feed history. O07 proves
the same token while publishing both records; O11 may remove pre-floor headers
without deleting the receipt or making replay ambiguous. Result-payload,
committed-key, feed, outbox-delivery, reconnect, and Payload-version retention
remain separate policies.

If shipped legacy request keys are discovered, their storage-generation cutover
imports recoverable outcomes, creates permanent tombstones for known commits
without replayable results, and rejects unknown keys rather than risking double
execution. Under the current clean replacement, target canonical keys start in
a server-issued namespace and no prototype outcome import is required.

## Retry Classes

The replacement keeps three classes separate:

1. **OCC conflict:** discard the journal and rerun user code at a new exact
   snapshot.
2. **Known pre-decision SQL serialization/deadlock:** retry the same immutable
   O06/O07-owned physical SQL operation plan within a strict bound, including
   PostgreSQL `40001` and `40P01` where supported. C04C1's logical
   `PreparedPointCommitV1` does not claim that physical retry authority.
3. **Uncertain commit outcome:** look up the authoritative idempotency/session
   outcome before rerunning anything.

External side effects never run inside a retriable mutation body or final
commit transaction.

## Invariants And Trust Boundaries

1. **Logical journals carry no physical authority.** They cannot select scope,
   generation, catalog, SQL, locks, physical rows, freshness atoms, change
   records, system outbox rows, or actor identity.
2. **Postgres retains the authoritative anchor and outcome.** SessionDO may
   store temporary bookkeeping only.
3. **Every attempt is fenced and sequenced.** Syscall sequence is monotonic;
   late calls after `finishing` and calls from stale attempts are rejected.
4. **Canonical bytes and digest prove integrity, not provenance.** Unknown
   protocol versions and forged fields fail before planning. Initially, exact
   trusted-store reload supplies journal provenance; inline bytes remain
   non-consumable until C07A proves a non-forgeable host boundary.
5. **Arguments and results are authoritatively validated.** Dynamic Worker
   validation is early feedback, not commit authority.
6. **The planner is pure and deterministic.** It allocates no commit sequence,
   timestamp, outbox identity, lock fact, or database resource.
7. **The executor transaction is short.** No user code, service-binding call,
   cache lookup, or unbounded operation runs inside it.
8. **All authoritative writers share one commit lane.** Migrations, backfills,
   repairs, Payload, and Medusa participate or use a formally equivalent
   fencing protocol; appending metadata afterward is not equivalent.
9. **Unsupported overlays fail closed.** Conservative dependency recording
   cannot repair an incorrect value already returned to user code.
10. **Result, outcome, data, commit/change atoms, and outbox are atomic.** A
    partial success is not a committed mutation.
11. **Retry meaning is explicit.** OCC, safe SQL retry, and uncertain outcome
    never share one generic rerun rule.
12. **Committed request keys are never reusable.** Attempt leases and committed-
    result payloads may expire under separate owners, but the S09-A committed
    request identity, match evidence, and commit token remain non-reusable.
13. **Journal cleanup is bounded and privacy aware.** Aborted, expired, and
    committed temporary values have explicit TTL/cleanup behavior.
14. **Host placement cannot change semantics.** Postgres-backed and optional
    facet-backed session journal stores conform to the same protocol and
    outcome rules.
15. **Facet storage is isolated and non-authoritative.** A supervisor retrieves
    a sealed envelope through the exact attempt facet API; it never reads facet
    SQLite directly or treats it as committed state.
16. **Attempts do not share facets.** Every retry uses a new attempt-fenced
    facet, and terminal Postgres state wins over delayed facet work or cleanup.

## Decisions And Rationale

### Start with a Postgres-backed journal

The safest route to the replacement protocol is to prove snapshot, OCC,
planning, finish, outcome, and recovery through the accepted host-neutral
Postgres package boundary and target FlarexDB storage contracts. Reusing a
package seam does not authorize reusing the prototype schema/session semantics.
Starting with SessionDO would combine protocol replacement with a distributed-
state optimization and make failures harder to classify.

### Measure journal placement immediately after C07

After the point-commit path passes PGlite and real-Postgres correctness, the
hosted path measures service-binding latency, authoritative data-read latency,
Postgres journal-persistence latency, and finish latency separately. A
material-improvement threshold is declared before comparison.

If journal persistence meets that threshold, moving only the temporary journal
to deterministic per-session DO SQLite becomes `C07A` before derived sidecars.
The accepted candidate uses a per-session supervisor and per-attempt dynamic
facet, but the measurement must compare it with a custom-binding-only control
that retains Postgres journaling rather than assuming facets improve transport.
Otherwise Postgres journaling may remain permanently. Either outcome preserves
the Postgres anchor, data reads, OCC, result, idempotency, commit feed, and
outbox.

`DocCacheDO` and `QueryCacheDO` are unrelated committed-read optimizations and
are not part of `C07A`.

### Keep adapter transaction models separate

The generic compiler initially supports only bounded Flarex app-data
operations. Payload requires a Payload-owned request/transaction adapter and
feature conformance. Medusa retains its repositories, transaction manager,
modules, links, migrations, and workflows, and later participates through a
narrow trusted scope-commit/change/outbox capability.

There is no automatic atomic `ctx.db + ctx.commerce` transaction. Commerce
invariants belong behind Medusa-owned workflows/facades.

### Optimize the final transaction only after conformance

Use bulk helpers and typed set-based SQL first. A versioned database-side
commit function may be considered only after the input IR, authority checks,
typed errors, and idempotent recovery have conformance tests. Do not start with
an opaque `flarexdb_commit(jsonb)` escape hatch.

## Convex Compatibility And Flarex Divergences

Flarex follows these Convex sources and patterns:

- [`../../../crates/database/src/transaction.rs`](../../../crates/database/src/transaction.rs)
  for transaction-local reads, writes, and read-your-writes;
- [`../../../crates/database/src/reads.rs`](../../../crates/database/src/reads.rs)
  for bounded typed dependency accounting;
- [`../../../crates/common/src/knobs.rs`](../../../crates/common/src/knobs.rs)
  and
  [`../../../crates/database/src/execution_size.rs`](../../../crates/database/src/execution_size.rs)
  for exact execution-limit constants and dimensions;
- [`../../../crates/database/src/writes.rs`](../../../crates/database/src/writes.rs)
  for pre-coalescing write counts and resulting-document byte accounting;
- [`../../../crates/isolate/src/helpers.rs`](../../../crates/isolate/src/helpers.rs)
  for successful-result semantic-size enforcement;
- [`../../../crates/database/src/committer.rs`](../../../crates/database/src/committer.rs)
  for authoritative validation, deterministic derivation, and ordered
  publication;
- [`../../../crates/model/src/session_requests/types.rs`](../../../crates/model/src/session_requests/types.rs)
  for durable request outcomes; and
- [`../../../crates/application/src/application_function_runner/mod.rs`](../../../crates/application/src/application_function_runner/mod.rs)
  for prior-outcome lookup and atomic successful-result storage.

The necessary Flarex divergences are:

| Concern | Convex pattern | Flarex divergence |
| --- | --- | --- |
| Placement | Function runner, transaction state, database, and committer are close together. | Dynamic Worker, private executor Worker, optional per-session supervisor/per-attempt facet, and Postgres are separate failure domains. |
| Journal integrity and provenance | Transaction state is internal to the backend. | C02 binds canonical journal/result evidence with SHA-256 for integrity. Through C07, C04A authenticates provenance only by reloading the exact C03-owned Postgres attempt seal. C02's inline variant is dormant until C07A proves non-forgeable supervisor/facet provenance; session/fence plus digest alone is insufficient. |
| Session recovery | Backend request state and outcome lookup share one hosted system. | Flarex retains an authoritative Postgres anchor/outcome so DO restart or a lost response cannot duplicate a mutation. |
| Physical lowering | Convex's integrated backend derives storage writes directly. | Flarex makes the trusted planner/executor split explicit so host adapters and untrusted journals cannot author physical/system facts. |
| Adapter lanes | Convex app transactions operate on Convex data. | Payload and Medusa retain separate compatibility/transaction contracts instead of entering one universal journal. |

The developer-facing query/mutation mental model remains Convex-like despite
the explicit distributed protocol.

## Implemented Capabilities

The `legacy_v1` prototype path currently proves:

- preparation and begin/finish/abort session APIs;
- wall-clock snapshot reads and persisted document/table/index dependencies;
- point CRUD staging, deterministic same-row coalescing, and staged point
  overlays;
- prototype table/index overlays and phantom-oriented OCC checks;
- validator enforcement for document writes;
- one persistence transaction covering document/index publication, commit,
  outbox, and session completion;
- mutation rerun after commit-time OCC conflicts;
- query finish with accumulated read sets;
- stale-session abort and maintenance; and
- post-commit live-query notification that does not roll back an already
  committed mutation when notification fails.

The replacement foundation also has private ephemeral snapshot resolution,
branded scope/epoch/commit token types, storage-generation/fence primitives,
stable catalogs, ordered-key codec work, the host-neutral general value codec,
a private durable session anchor/current-attempt lease, and O04's private exact-
snapshot point reader with present/qualified-missing dependencies. C02 now adds
the strict host-neutral `SessionJournalV1`, separate successful-result evidence,
`CommitEnvelopeV1`, canonical encoding/digests, exact execution ceilings, and
dormant inline carriage. C03 now composes current-attempt authorization, O04
semantics, a narrow pinned-manifest table capability, the trusted bounded
Postgres journal store, and the staged read-your-writes overlay. C04B1 adds
only the private current-authority capability, C04B2 adds the private-C07 final
value/result proof, and corrected C04C1 is the approved private logical point
planner. None of these makes committed publication, production routing, inline
carriage, or conditional C04C2 active.

## Known Gaps And Limitations

- Standalone `C01` was retired before implementation; C02's protocol-only gate,
  C03's operational point-journal gate, C04A's private stored-attempt gate, and
  C04B1's private commit-authority gate and C04B2's private-C07 final-value gate
  are complete. Corrected C04C1 is complete; C04C2 and C05-C09
  remain unapproved or incomplete as their statuses state.
- Current invoke sessions use wall-clock `beginTs`, not authoritative
  `SnapshotToken` reads.
- The legacy journal persists directly in broad Postgres invoke-session tables.
  The replacement C03 journal exists behind a new explicit internal subpath and
  process-local attempt/table capabilities, but no production route consumes it
  and no compatibility bridge targets the legacy engine.
- A private same-factory `VerifiedCommitInputV1` now exists for the C07 proof;
  corrected C04C1 provides only private logical `PreparedPointCommitV1`. No
  production-authoritative validator binding, physical lowering capability, or
  replacement `CommitExecutor` integration exists.
- Current `commitInvokeSessionWrites` combines planning, OCC, timestamp
  allocation, physical publication, index maintenance, commit/outbox, and
  session completion.
- Current retry coordination reruns whole attempts for prototype OCC but
  does not implement the final three-class outcome protocol.
- S09-A's final `(scope_uuid, request_key)` committed-success table and
  available/expired state constraints are implemented. Its writer, outcome
  lookup/replay, expiry transition, public key mapping, and target-generation
  activation remain unimplemented; legacy outcome import remains conditional.
- Replacement app-row revision/current and physical transaction-session/
  snapshot-lease tables plus the private O04 point-read kernel and O05 pure
  point-OCC validator exist internally. Production syscall/session composition,
  commit-time point-OCC integration/serialization, commit/change, S09-A
  consumption, S09-B leased outbox, and compiler composition remain
  prerequisites.
- Exact range/relation/pagination overlays and phantom tests are incomplete.
- Payload and Medusa adapter conformance remain separate future domains.
- The scope-local commit lane may become a throughput bottleneck and must be
  measured on real Postgres before any partitioning optimization.
- No hosted journal latency threshold or `C07A` decision receipt exists.

## Target Direction

The target point-mutation lifecycle is:

```text
trusted preparation and exact SnapshotToken
  -> fenced running session
  -> bounded logical syscalls and exact supported overlay
  -> C03 sealed canonical journal/result evidence while still running
  -> C04A authenticated stored attempt
  -> C04B1 authenticated current commit authority
  -> C04B2 verified compiler input
  -> C04C1 pure deterministic logical PreparedPointCommitV1
  -> locked scalar seal revalidation and finishing CAS
  -> O06/O07 short authoritative Postgres OCC/physical/publication transaction
  -> atomic result, idempotency outcome, rows/sidecars,
     commit/change feed, outbox, and committed session
  -> replayable finish response and post-commit sync wake
```

The first complete outcome is intentionally narrow: one Flarex app point
mutation through the replacement schema and exact-snapshot OCC path. It does
not imply Payload parity, Medusa integration, arbitrary scans/ranges, cache
reads, or legacy retirement.

## Next Correctness Gates

Private O02 snapshot resolution, S05-B value codec, S06 row storage, and S07
physical session/snapshot-lease DDL are complete. S07-A current revocation
storage is also complete. The O03-A parent, protocol-only O03-A1,
auth-provenance O03-A2a, and host-neutral grant authority O03-A2b are complete.
Corrected O03-A2c's located current-epoch and two-sided point-mutation
preparation boundaries are also complete, so O03-A2 and O03-A are complete.
O03-B1 activation and O03-B2a restart-safe exact-attempt reload are complete.
O03-B2b1 exact abort/expiry terminalization is also complete and closes the
required session-authority core. O04 private exact-snapshot point reads and
typed dependencies and O05 pure OCC validation are complete. Standalone C01
was retired before implementation; C02's inert logical protocol, C03's
operational point-journal consumer, and C04A's private stored-attempt
 authentication plus C04B1's current commit-authority authentication and C04B2's
 private-C07 final-value proof are complete. Corrected C04C1, S08 commit/feed
 DDL, and S09-A private committed-success DDL are complete; S09-B is the next
 schema gate and C04C2 remains conditional and unapproved.
O03-B2b2 renewal and renewal-
versus-terminalization race proof are deferred until a real runtime or
retention consumer proves that a bounded attempt must outlive its initial lease.
Operational revocation and hosted Worker/key adapters are deferred and do not
block the private C07 proof.
Hosted compiler execution still waits for the required schema, exact-snapshot
OCC, commit, target activation, target-only caller/recovery, and hosted
prerequisites. Shipped-state migration prerequisites are conditional.

The former C01 standalone port-extraction gate is retired. Its proposed
compatibility-wrapper work is dropped rather than redistributed: C03
introduces its first required journal-store boundary, C04A owns exact stored-
evidence authentication, C04B1 owns current argument/grant/revocation/schema
authority, C04B2 owns final value/return verification and verified input, and
C04C1 owns the concrete private logical prepared-point capability. O06/O07 own
actual locks, physical lowering, sequence/time allocation, and atomic execution
with C05 as the first compiler consumer; O09 owns multi-row/unique ordering, and C06
owns post-commit wake after durable evidence exists.

The remaining compiler gates are:

1. `C02` (complete, inert): define versioned logical dependencies/writes,
   `SessionJournalV1`, separate successful-result evidence,
   `CommitEnvelopeV1`, canonical encoding, integrity digests, fences, sequence
   representation, exact execution limits, dormant inline carriage, and typed
   rejection. It defines no concrete prepared-plan capability.
2. `C03` (complete): trusted Postgres-backed point CRUD journaling, narrow
   pinned-manifest table resolution, constant-cardinality replay, operational
   sequence/limit accounting, deterministic coalescing, exact point overlays,
   two-phase seal, and fail-closed unsupported shapes.
3. `C04A` (complete): reject inline carriage before I/O, freshly reload and
   compare the exact live `running + sealed` or `finishing + sealed` attempt,
   and return only a private runtime-unforgeable
   `AuthenticatedStoredAttemptV1` after bounded detached verification.
4. `C04B1` (complete): same-factory database-time authentication of stored
   arguments/grant, current revocation, pinned schema/stable bindings, and the
   temporary immutable proof-metadata snapshot into a private
   `AuthenticatedCommitAuthorityV1`.
5. `C04B2` (complete for private C07): validate final logical values and
   successful return evidence against already-authenticated proof validators
   and produce private same-factory `VerifiedCommitInputV1` without I/O.
6. `C04C1` (complete): build the same-factory database-free
   deterministic logical point planner and private process-local
   `PreparedPointCommitV1`, preserving every protocol dependency and at most
   one material logical row intent.
   `C04C2` remains conditional on S08/S09-A/S09-B/O06/O07 proving that a
   separate physical/change/outbox lowering capability is useful.
7. `C05`: execute one replacement point mutation through the complete atomic
   OCC/outcome/commit/outbox primitive.
8. `C06`: add fenced idempotent finish, duplicate/concurrent finish behavior,
   restart, expiry, and lost-response outcome recovery through stable
   `/invoke/*` endpoints.
9. `C07`: close PGlite and real-Postgres concurrency, rollback, serialization,
   deadlock, uncertain-outcome, and contiguous-sequence gates.
10. `C07A`: immediately measure journal persistence and move only the temporary
   journal to a per-session supervisor/per-attempt facet if that path beats the
   Postgres-backed and custom-binding-only control baselines by the predeclared
   material-improvement threshold; otherwise retain Postgres journaling.
11. `C08`: lower declared index and unique sidecars after their schema/OCC gates.
11. `C09`: lower stable edge occurrences after relation identity and semantics
    are frozen.

Each gate updates this roadmap only when it changes durable status,
architecture, gaps, direction, or correctness criteria. Commit and verification
history remains in Git and task reports.
