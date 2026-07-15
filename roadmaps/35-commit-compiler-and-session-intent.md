# Commit Compiler And Session Intent

## Status And Scope

Status: accepted bounded design with an implemented `legacy_v1` prototype path;
the replacement commit compiler is planned and no `C01` through `C09`
slice is complete.

This roadmap owns the durable direction for:

- the logical session journal and authenticated finish envelope;
- the trusted logical-to-physical commit planner;
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
   owns the executable `C01` through `C09` gates.
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
physical transaction-session/snapshot-lease tables exist internally, but no
production lifecycle operation creates or consumes them. `SessionJournalV1`,
`CommitEnvelopeV1`, `PreparedCommitV1`, and the trusted commit planner remain
unimplemented.

### Accepted replacement boundary

The replacement separates four responsibilities:

```text
SessionJournalV1
  bounded logical app reads, staged logical writes, canonical result
             |
CommitEnvelopeV1
  protocol version, session id, attempt fence, syscall sequence,
  canonical journal bytes or authenticated journal reference, digest
             |
CommitPlannerV1
  verified anchor/catalog/policy input -> deterministic physical plan
             |
PreparedCommitV1
  internal immutable capability; never serialized over /invoke/*
             |
CommitExecutor
  authority/fence checks, OCC, constraint checks, sequence allocation,
  atomic publication, outcome, commit feed, and outbox
```

The compiler is a lowering boundary, not a new authority. User code and the
journal describe logical operations only. Trusted code derives physical rows,
index/unique/edge sidecars, locks, change atoms, and system outbox records from
the pinned catalog, policy, codecs, and final row bodies.

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
replay, O03-B2a owns restart-safe exact-attempt reload, and O03-B2b owns
mutating exact-fence lease mechanics and active-child invariants. C02 owns
journal sequence/digest,
C05 introduces the private exact-fence transition to `finishing`, C06
orchestrates it idempotently through the finish endpoint, C03 rejects late
syscalls, O07 atomically deletes the exact lease and stores committed state plus
public idempotency/outcomes, O08 owns retry replacement, and O11 first consumes
active floors.

Temporary journal placement does not change this anchor. It authenticates a
remote journal and fences stale attempts without making SessionDO transaction
authority.

### Conditional facet-backed journal placement

If `C07A` selects Durable Object placement, use one server-issued supervisor
Durable Object per top-level query/mutation session and one dynamically loaded
facet per positive attempt fence. Do not use one execution actor per scope or
deployment. The exact content-addressed artifact remains pinned by the
authoritative Postgres session anchor and loaded from the existing artifact
store; supervisor or facet SQLite is not a second code authority.

The generated facet shell records the bounded logical journal and supported
read-your-writes overlay in its isolated SQLite while actual snapshot reads
still cross the restricted executor syscall capability. On handler completion,
the facet seals canonical journal bytes, canonical result bytes, final syscall
sequence, digest, session identity, and attempt fence. Because Cloudflare
isolates parent and facet storage, the supervisor retrieves that envelope only
through an RPC or `fetch` call on the exact facet stub; it cannot query the
child database directly. The supervisor then forwards the envelope to trusted
executor finish.

The executor treats the returned journal as logical intent, not a transaction
or authoritative row set. It reloads and validates the Postgres anchor and
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
terminalization, and O03-B2b2 adds renewal. S07's `created` literal is not a
durable active state without a lease.
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

Before planning, trusted code verifies:

- protocol version, canonical journal bytes/reference, digest, and last syscall
  sequence;
- session lifecycle, attempt fence, expiry, generation/fence, and snapshot;
- package, function, schema, policy, identity, grant, and revocation state;
- request/idempotency identity and canonical arguments; and
- the encoded function result against the pinned authoritative return
  validator.

Only a branded verified input can reach the pure planner. The planner accepts
no database handle, clock, network service, raw SQL, untrusted physical name,
or transaction-specific sequence/lock fact. Identical trusted inputs produce
equivalent deterministic plans and typed preflight errors before SQL opens.

The short commit transaction then:

```text
lock scope commit lane and look up authoritative outcome
  -> recheck session, attempt, generation, epoch, and authority
  -> validate typed dependencies and constraints
  -> allocate commit/outbox sequences
  -> publish row revisions/current rows and derived sidecars
  -> store result-bearing idempotency outcome
  -> write commit/change atoms and system outbox
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

Each syscall enforces incremental journal, read/write byte, row, scan, syscall,
and lease limits. Waiting until finish to reject an oversized journal is not
sufficient.

## Idempotency And Recovery Contract

The authoritative uniqueness key is:

```text
(scope_id, request_key)
```

The outcome also binds identity/access fingerprint, function reference, and
canonical argument/request hash. Successful result, commit token, and relevant
log metadata are stored atomically with data, commit/change rows, outbox, and
committed session state.

Repeated finish returns the stored outcome. Reusing a request key for another
identity, function, or request hash fails. After the replay window, large
result/log payloads may be removed, but a compact committed tombstone remains
for the scope lifetime; late retries return `CommittedResultExpired` and never
rerun the mutation.

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
   `PreparedCommitV1` within a strict bound, including PostgreSQL `40001` and
   `40P01` where supported.
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
4. **Canonical bytes and digest bind finish to the observed journal.** Unknown
   protocol versions and forged fields fail before planning.
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
12. **Committed request keys are never reusable.** Expiry applies only to an
    in-progress lease, not committed idempotency identity.
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
| Journal authentication | Transaction state is internal to the backend. | Remote journal carriage needs protocol version, session identity, attempt fence, sequence, canonical bytes/reference, and digest. |
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
stable catalogs, ordered-key codec work, and the host-neutral general value
codec in adjacent domains. Those prerequisites do not define the later
journal/envelope codec and do not mean the new compiler, durable session pin,
or exact-snapshot invoke path is active.

## Known Gaps And Limitations

- `C01` through `C09` remain unchecked in the focused plan.
- Current invoke sessions use wall-clock `beginTs`, not authoritative
  `SnapshotToken` reads.
- The legacy journal persists directly in broad Postgres invoke-session tables;
  no versioned logical journal/envelope/digest contract exists.
- No branded verified compiler input, pure `CommitPlannerV1`, immutable
  `PreparedCommitV1`, or replacement `CommitExecutor` integration exists.
- Current `commitInvokeSessionWrites` combines planning, OCC, timestamp
  allocation, physical publication, index maintenance, commit/outbox, and
  session completion.
- Current retry coordination reruns whole attempts for prototype OCC but
  does not implement the final three-class outcome protocol.
- The final `(scope_id, request_key)` result-bearing idempotency row,
  committed-outcome replay, expiry tombstone, and target-generation activation
  rules are not implemented. Legacy outcome import remains conditional.
- Replacement app-row revision/current and physical transaction-session/
  snapshot-lease tables exist internally. Production session lifecycle,
  commit/change, idempotency, leased outbox, and compiler composition remain
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
  -> finishing CAS and canonical journal digest
  -> verified compiler input
  -> pure deterministic PreparedCommitV1
  -> short authoritative Postgres OCC/constraint transaction
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
O03-B2b1 exact abort/expiry terminalization is also complete. O03-B2b2 renewal
and renewal-versus-terminalization race proof is next, followed by O04 exact-
snapshot point reads and O05 pure OCC validation before C01.
Operational revocation and hosted Worker/key adapters are deferred and do not
block the private C07 proof.
Hosted compiler execution still waits for the required schema, exact-snapshot
OCC, commit, target activation, target-only caller/recovery, and hosted
prerequisites. Shipped-state migration prerequisites are conditional.

The compiler gates are:

1. `C01`: extract narrow journal, catalog, planner-input, executor, and
   post-commit ports without changing `/invoke/*` behavior.
2. `C02`: define versioned logical dependencies/writes, `SessionJournalV1`,
   `CommitEnvelopeV1`, immutable `PreparedCommitV1`, canonical encoding,
   digest, fences, sequences, limits, and typed rejection.
3. `C03`: implement point CRUD journaling, deterministic coalescing, exact
   point overlays, and fail-closed unsupported shapes.
4. `C04`: build authoritative envelope/anchor verification plus a pure
   deterministic point-row planner with typed preflight errors.
5. `C05`: execute one replacement point mutation through the complete atomic
   OCC/outcome/commit/outbox primitive.
6. `C06`: add fenced idempotent finish, duplicate/concurrent finish behavior,
   restart, expiry, and lost-response outcome recovery through stable
   `/invoke/*` endpoints.
7. `C07`: close PGlite and real-Postgres concurrency, rollback, serialization,
   deadlock, uncertain-outcome, and contiguous-sequence gates.
8. `C07A`: immediately measure journal persistence and move only the temporary
   journal to a per-session supervisor/per-attempt facet if that path beats the
   Postgres-backed and custom-binding-only control baselines by the predeclared
   material-improvement threshold; otherwise retain Postgres journaling.
9. `C08`: lower declared index and unique sidecars after their schema/OCC gates.
10. `C09`: lower stable edge occurrences after relation identity and semantics
    are frozen.

Each gate updates this roadmap only when it changes durable status,
architecture, gaps, direction, or correctness criteria. Commit and verification
history remains in Git and task reports.
