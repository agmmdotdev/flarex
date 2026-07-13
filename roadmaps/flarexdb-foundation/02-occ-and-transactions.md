# FlarexDB OCC And Transaction Plan

Status: private non-routing `O02` snapshot resolution complete; standalone
`O01` retired before implementation; `O03` and later OCC gates remain planned

This plan owns exact snapshots, typed read dependencies, conflict validation,
the short scope-local commit lane, result-bearing idempotency, retry classes,
retention floors, and generation cutover safety.

It consumes physical tables from
[01-schema-and-migrations.md](./01-schema-and-migrations.md) and supplies the
trusted transaction primitive used by
[03-commit-compiler.md](./03-commit-compiler.md).

Hosted production execution uses a dedicated private Cloudflare executor
Worker and a request-scoped Postgres client through cache-disabled Hyperdrive.
This changes the host, not OCC semantics: the executor still holds no SQL
transaction while untrusted user code runs, and only the short final trusted
commit lane owns locks and publication. The existing `/invoke/*` Fetch
protocol remains the first private service-binding adapter; Nitro/Vercel is an
optional compatibility lane.

## Authoritative Inputs

- [Accepted snapshot, idempotency, and retry rules](../../design-notes/flarex-db-accepted-design.md)
- [V1 schema/OCC cutline](../../design-notes/flarex-commerce-cms-v1-schema-cutline.md)
- [Long-form OCC and transaction tables](../../design-notes/flarex-internal-db-schema.md)
- [OCC domain history](../03-occ-and-transactions.md)
- [Trusted executor boundary](../20-postgres-executor.md)
- [Commit compiler/session boundary](../35-commit-compiler-and-session-intent.md)

Current implementation evidence:

- [`packages/executor/src/sessions.ts`](../../packages/executor/src/sessions.ts)
  uses wall-clock `beginTs` and Postgres staging.
- [`packages/executor/src/retry.ts`](../../packages/executor/src/retry.ts)
  currently combines OCC and SQL serialization into one full-attempt retry and
  does not yet model deadlock or uncertain-decision recovery correctly.
- [`packages/persistence-postgres/src/commits.ts`](../../packages/persistence-postgres/src/commits.ts)
  is the legacy all-in-one commit path.

Convex-first implementation references:

- [`crates/database/src/reads.rs`](../../../../crates/database/src/reads.rs)
  records present, missing, and range reads and checks overlapping writes;
- [`crates/database/src/transaction.rs`](../../../../crates/database/src/transaction.rs)
  provides exact begin-snapshot and read-your-writes semantics;
- [`crates/database/src/committer.rs`](../../../../crates/database/src/committer.rs)
  validates reads before ordered publication and accounts for pending writes;
- [`crates/model/src/session_requests/types.rs`](../../../../crates/model/src/session_requests/types.rs)
  stores successful mutation outcomes durably;
- [`crates/application/src/application_function_runner/mod.rs`](../../../../crates/application/src/application_function_runner/mod.rs)
  checks prior outcomes before execution and stores results atomically.

## Fixed OCC Invariants

- The authoritative token is exactly
  `SnapshotToken { scopeId, epoch, commitSeq }`.
- A new FlarexDB session never uses wall-clock time as its snapshot. Legacy
  `beginTs/readTs` remains private to the legacy adapter during coexistence.
- Snapshot creation reads the current scope clock. A commit locks that clock,
  validates the token epoch/fence and dependencies, then allocates
  `lastCommitSeq + 1` inside the same transaction.
- Rollback consumes no sequence. The scope commit feed is dense and contiguous.
- Epoch is a fence, not a row-visibility predicate. Exact reads include the
  newest revision at or before `commitSeq` even if that revision was written in
  an older epoch.
- Missing rows are dependencies. Inserting a row after a transaction observed
  it missing is a conflict when that absence affected the result.
- All authoritative writers participate in the same scope commit lane or a
  formally equivalent serializable/fenced protocol. Backfills, repairs,
  Payload, and Medusa do not bypass it.
- User code, hooks, workflows, network calls, and long actions never run while
  a Postgres transaction or scope-clock row lock is open.
- Exactly one storage generation is authoritative for a scope. Active attempts
  are pinned and cannot cross a cutover.

## Typed Dependency Baseline

Dependency types are introduced just in time by the gates that can prove their
semantics. `O04` owns present and missing point dependencies, `O10` owns index
ranges, and relation gates own edge ranges after stable relation identity is
accepted. A conservative table-version fence is added only if its consuming
gate demonstrates that it is necessary. Do not predeclare unsupported variants
or allocate a second row-version authority beside `CommitSeq`.

## Turn Checklist

### O01 — Retired Before Implementation

The standalone contract-and-port extraction gate was premature. It duplicated
the existing `ScopeClockReader`/trusted authority resolver and guessed session,
row, commit, outcome, and feed contracts before their consumers and physical
stores existed. Its immediately necessary seam was folded into `O02`.

Introduce later contracts only at their real owners: row revisions at `S06`,
session authority at `S07`/`O03`, point dependencies at `O04`, point conflict
decisions at `O05`, commit/feed capabilities at `S08`/`O06`, and committed
outcomes at `S09`/`O07`. A row revision derives from `CommitSeq`; it never owns
another sequence. The legacy adapter never treats wall-clock `ts` as a
replacement commit sequence.

### [x] O02 — Resolve Current App-Data Snapshots

Outcome:

- Bind one private `AppDataSnapshotResolver` to trusted construction-time
  authority readers. Request code supplies only an already-authorized
  deployment identity; no public route or user code receives this capability.
- Control metadata locates the data plane. One read of the located data-plane
  scope clock supplies the exact `SnapshotToken { scopeId, epoch, commitSeq }`,
  `storageGeneration`, and `storageGenerationFence` together.
- Treat the result as an ephemeral selection, not a durable pin or commit
  authorization. `O03` owns session/package/schema/policy binding and leases;
  `O06` owns final transactional epoch/generation/fence revalidation.
- Leave legacy `beginTs` and production storage-generation routing unchanged.

Exit gate:

- empty scope returns sequence `0`;
- two scopes have independent tokens;
- trusted placement/clock failures retain typed fail-closed resolution;
- exact bigint sequences survive PGlite and real-Postgres resolution;
- the resolver and nested token are immutable snapshots of one clock read;
- no code aliases legacy `ts` to the dense `commitSeq`.

### [ ] O03 — Create And Fence Session Anchors

Outcome:

- Create authoritative session/grant anchor and snapshot lease atomically.
- Pin scope, storage generation, snapshot, package/artifact/function,
  canonical validated arguments, identity/policy fingerprint, authorization
  grant/revocation epoch, schema version, request identity, attempt fence,
  expiry, and protocol version.
- Keep one request anchor across OCC attempts. A rerun advances its attempt
  fence and snapshot but retains storage generation/fence. An OCC conflict
  atomically moves `committing -> retrying`, increments the attempt fence,
  discards the old journal, replaces the snapshot lease, and returns the same
  non-terminal request anchor to `running`. If the generation fence changed,
  stop active attempts with typed `StorageGenerationChanged` instead. The same
  request key can rebind after cutover only when outcome lookup proves no
  commit and a fenced CAS makes the old anchor terminal; uncertain outcomes do
  not rebind.
- Implement compare-and-set lifecycle primitives without moving the logical
  journal to SessionDO.

Exit gate:

- stale owner, wrong generation, expired lease, revoked grant, epoch rollover,
  and terminal-session reopen all fail closed;
- history GC can discover the active snapshot floor.

### [ ] O04 — Implement Exact-Snapshot Point Reads

Outcome:

- Implement `getRowAtSnapshot` from revision history, using current rows only
  when they are a proven safe optimization.
- Return the value plus either a present-row revision dependency or a
  missing-row dependency.
- Never use wall-clock comparisons on the FlarexDB path.

Exit gate:

- present, missing, tombstone, insert-after-missing, update, delete/reinsert,
  older snapshot, old-epoch untouched row, and cross-scope cases pass;
- a row written after the snapshot is never returned.

### [ ] O05 — Build The Pure Point-OCC Validator

Outcome:

- Implement a side-effect-free validator for present revision unchanged,
  missing row still missing, insert absence, expected revision for
  patch/replace/delete, scope/generation agreement, and epoch fence.
- Produce typed, deterministic conflicts suitable for full user-code rerun.
- Validate against committed rows and any same-lane pending/locked state needed
  by the chosen Postgres protocol.

Exit gate:

- exhaustive unit tests cover read/write, write/write, missing/insert,
  delete/reinsert, same-row coalescing, unrelated rows, scope mismatch, and
  stale epoch/generation;
- no physical writes occur in this turn.

### [ ] O06 — Build The Private Atomic Point-Commit Harness

Outcome:

- Add the short trusted transaction primitive that accepts only a typed,
  immutable prepared point plan.
- Inside one transaction: lock the data-plane scope clock that owns the active
  generation/fence, recheck session/fence/epoch,
  validate point dependencies, allocate the sequence, write row revision and
  current state, write commit/change atoms, advance the clock, and commit.
- Inject failures at each publication step to prove rollback.
- Keep this harness private and unreachable from storage-generation routing,
  HTTP, artifacts, or user mutations until O07 adds atomic outcome/idempotency/
  outbox and C05 consumes the complete primitive.

Required real-Postgres cases:

- two writers from one snapshot change the same row: exactly one commits;
- disjoint writes commit with unique contiguous sequences;
- independent scopes progress concurrently;
- injected failure leaves no row, commit atom, or clock advancement.

Exit gate:

- the real-Postgres lane passes; PGlite alone cannot close this turn;
- untrusted journals cannot call the primitive with physical identifiers;
- no externally routable mutation can commit through this incomplete harness.

### [ ] O07 — Add Atomic Outcome, Idempotency, And Outbox

Outcome:

- Lock/claim `(scope_id, request_key)` and bind it to identity fingerprint,
  function reference, and canonical request hash.
- Store the successful encoded result, commit token, data, commit/change atoms,
  outbox rows, and committed session state in the same transaction.
- Retain a compact non-reusable committed tombstone after result payload expiry.

All authoritative writers use one lock order:

```text
fast committed-outcome lookup outside the transaction
  -> begin transaction
  -> lock data-plane scope clock/generation fence
  -> lock or insert idempotency row
  -> compare identity/function/request hash
  -> validate and publish
```

Exit gate:

- repeated finish returns the same outcome;
- mismatched request-key reuse fails;
- concurrent duplicates apply once;
- an uncertain response resolves from the stored outcome;
- failed or rolled-back attempts do not appear committed.

### [ ] O08 — Separate The Three Retry Coordinators

Outcome:

1. OCC conflict uses the O03 `committing -> retrying -> running` transition,
   discards the journal, and reruns deterministic user code from a new snapshot
   under the same request-level generation/fence pin.
2. PostgreSQL `40001` or `40P01` before a known decision retries the same
   immutable physical plan within a strict bound.
3. An uncertain connection outcome performs authoritative outcome lookup before
   any retry.

After a generation fence change, the same request identity may start on the new
generation only through S15's no-commit/terminal-anchor rebind CAS. It never
silently crosses during an active OCC retry.

Every SQL-plan retry opens a new transaction, reacquires the scope clock,
rechecks session/generation/epoch/idempotency, and derives tentative commit/
outbox sequences, IDs, timestamps, and transaction locks again. The immutable
prepared plan contains none of those transaction-derived facts.

Exit gate:

- SQL retries do not rerun user code;
- OCC conflicts do rerun it;
- a successful uncertain commit is never applied twice;
- authorization, validation, codec, and deterministic constraint errors are not
  retried;
- real-Postgres serialization and deadlock tests pass.

### [ ] O09 — Add Multi-Row Atomicity And Unique Conflicts

Outcome:

- Expand the prepared plan to multiple rows with deterministic lock/write
  ordering and same-row write coalescing.
- Validate and publish unique claims in the same transaction.
- Translate database constraint races into stable typed conflicts/errors.

Exit gate:

- all-or-nothing multi-row writes, competing unique claims, delete/reuse,
  deterministic ordering, and sidecar rollback pass on PGlite and real
  Postgres;
- Payload and Medusa behavior remains excluded.

### [ ] O10 — Prove One Exact Indexed Dependency

Outcome:

- After the schema and compiler provide the ordered-key codec and index
  sidecars, implement one exact indexed dependency including codec version,
  bounds, empty range, insertion/deletion, key movement, and pagination
  frontier.
- Add complete local read-your-writes overlay for that exact supported query
  shape before enabling it in mutations.

Exit gate:

- phantom insert/delete/key-move tests pass on PGlite and real Postgres;
- unsupported range, relation, scan, or pagination shapes still reject rather
  than fall back;
- this turn does not claim all query shapes.

### [ ] O11 — Enforce Retention Floors

Outcome:

- Compute engine-history retention from active snapshot leases and reconnect
  leases plus a safety margin.
- Persist and advance `oldest_available_commit_seq` only after compaction
  succeeds so restart can reject tokens below the actual retained floor.
- For every row identity and index-entry membership identity, retain the newest
  revision/tombstone at or before the floor plus every required later revision,
  or materialize an equivalent checkpoint. Deleting all pre-floor rows would
  make snapshots at the floor incorrect.
- Advance the global floor only after row, index, commit/change, and required
  dependency histories are mutually safe at that floor.
- Keep engine revision retention, Payload user-visible versions, and outbox
  retention as separate policies.
- Return an explicit reset/out-of-retention outcome for a token below the floor
  or from another epoch.

Exit gate:

- active sessions prevent required history deletion;
- expired leases release history;
- a row revised at 5 and 100 still returns revision 5 at snapshot 50 after the
  floor advances to 50;
- a row/index membership deleted before the floor remains absent rather than
  resurrecting after compaction;
- pending/claimed outbox rows are never collected;
- epoch rollover does not hide or delete untouched data.

### [ ] O12 — Drain And Cut Over One Isolated Canary Scope

State model:

```text
legacy_authoritative
  -> legacy_authoritative_flarexdb_shadow
  -> flarexdb_authoritative_rollback_window
  -> flarexdb_authoritative
```

Outcome:

- Backfill and compare at explicit watermarks from the schema plan.
- Enter a fenced `draining` phase, block new legacy starts, wait for or
  expire/abort old attempts, catch up to a final legacy watermark, and verify
  again before authority changes.
- Resolve every drained request through the generation-independent outcome
  store. Only proved-uncommitted terminal requests become eligible for S15's
  same-key rebind after the flip; uncertain requests remain blocked.
- Require S13's historical outcome/tombstone import and S15's same-transaction
  legacy outcome bridge to be complete. Seal the implicit legacy request
  namespace; an unknown/GCed legacy key returns `LegacyOutcomeUnknown` and is
  never rebound or executed.
- Keep the request-level generation/fence pin across OCC reruns. A stale pin
  fails instead of crossing engines.
- Allow only one commit authority. Shadow publication is either part of the
  authoritative SQL transaction or an ordered mirror with a verified
  `appliedThrough` watermark.
- During the rollback window, every allowed FlarexDB write uses S15's complete
  same-transaction legacy compatibility publisher. If the bridge is stopped or
  a replacement-only write without a complete legacy projection is allowed,
  rollback becomes a fenced stop-the-world reverse catch-up plus verification,
  not a flag flip.
- Never serve a shadow mismatch through silent legacy fallback.
- Until the separate sync plan is implemented, require zero active
  subscriptions/reconnect leases for this canary and keep live subscriptions
  disabled. A later production cutover must generation-fence registrations and
  force reset/resnapshot at the authority flip.

Exit gate:

- one isolated canary scope passes read/write/outcome comparison;
- generation fences prevent mixed reads and writes;
- rollback works throughout the declared window;
- the cutover protocol atomically bumps the data-plane generation fence and
  active generation only after drain/final verification;
- replacement-only operations without a complete legacy projection remain
  disabled until the rollback promise is explicitly ended or a verified
  reverse projection exists.

### [ ] O13 — Retire Legacy OCC

This turn is not part of the low-level foundation completion and cannot run
until the separate sync migration provides generation-aware registration,
reconnect, commit-feed catch-up, reset/resnapshot, and eviction/recovery proof.

Retirement gate:

- no legacy-authoritative scope remains;
- no active legacy session, lease, or reconnect cursor remains;
- backfill/invariant/shadow reports are clean;
- the rollback window is formally closed;
- PGlite, real Postgres, executor, private Worker Fetch adapter,
  artifact-runtime, and sync integration gates pass; optional Nitro/Vercel
  compatibility is validated separately while it remains supported;
- equivalent legacy tests have been ported;
- only then remove legacy document/index OCC and Postgres invoke staging.

PartitionDO/ExecutionDO cleanup remains a separate bridge-retirement change.

## Future Adapter Participation

Reserve trusted entry paths rather than a generic raw transaction callback:

```text
AppCommitExecutor
PayloadTransactionAdapter
MedusaTransactionAdapter
SystemWriteAdapter
```

- The app compiler derives app rows and sidecars.
- Payload later owns Payload request semantics and conformance.
- Medusa later preserves its repository/workflow transaction and joins the
  same scope clock, commit/change, and outbox protocol.
- All paths validate scope/generation and use one commit lane, but they do not
  pretend to share one journal or physical schema.

## Verification Template

Fast gates for every OCC turn:

```sh
corepack pnpm --filter @flarex/persistence-postgres db:check
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
```

Lock, conflict, idempotency, retry, outbox, and cutover turns additionally run:

```sh
corepack pnpm --filter @flarex/persistence-postgres test:postgres
corepack pnpm --filter @flarex/executor test:postgres
```

Phase checkpoints run both package builds and workspace `typecheck`, `test`,
and `build`. Significant code turns update only active roadmaps whose durable
truth changed; compatibility inventories remain historical evidence. Both
standing diff reviewers run before the automatic checkpoint commit.
