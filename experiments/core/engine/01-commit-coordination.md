# Concept 01: app ownership and commit coordination

Status: **Accepted design decisions; implementation not started**. One independent
app has one logical owner, shared by Application, Medusa and Payload. The initial
Cloudflare design places its commit coordinator inside the app DO. Independent
accepted writes may finish saving to PostgreSQL out of order; normal publication
and success acknowledgement follow acceptance order. Uncertain persistence enters
app-owner recovery. Replication is **open and explicitly deferred**.

These decisions refine the [accepted architecture](../../../design-notes/flarex-db-accepted-design.md#portable-core-refactor-direction)
and [ownership card](./01-ownership-and-lifetime.md). They do not close every
question in concept 01 or authorize runtime, schema, data or deployment changes.
[OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md) owns remaining decisions.

## App boundary and placement

An independent app is the ownership scope. A shop was only the discussion example;
cart, storefront, framework and table identities do not create separate owners.
Medusa and Payload share the app's data and coordination while retaining domain
ownership, native behavior and distinct execution profiles. Independent calls
are not automatically one atomic operation; cross-app atomicity is not selected.

```text
inside the app DO
  admitted operation -> private reads/pending changes -> commit coordinator
                                                        |
                             PostgreSQL transaction <---+
                             ownership/conditions + durable changes/outcome
                                                        |
                  ordered local cache publication <-----+
                  then success acknowledgement
```

Logical conflict validation, accepted-pending tracking, ordering and commit
orchestration run in portable core modules hosted inside the DO. A separate
Worker committer or a network call between each local module is not required.
PostgreSQL performs the physical durable commit and enforces ownership and the
required transactional conditions. In-memory validation alone cannot fence a
stale owner or protect against an untracked writer. Exact SQL enforcement, all
writer participation and native branch hosting remain proof obligations.

Keep application/native execution outside the final persistence transaction.
The coordinator does not hold a lock across the entire business workflow. One DO
still has one JavaScript execution thread; overlapping persistence addresses I/O
serialization, not that CPU limit. Untrusted code keeps restricted capabilities.

## Accepted order and visibility contract

Keep private proposals, accepted pending changes, durable changes and published
changes distinct. Acceptance is not a successful business result.

| Stage | Required behavior |
| --- | --- |
| Prepare | Each operation owns its reads and pending changes against an admitted view |
| Validate and accept | Establish one app-local order; check complete dependencies against committed and already accepted pending changes |
| Save | Allow bounded overlapping PostgreSQL transactions for independent accepted operations; B may become durable before A |
| Publish normally | Advance visible engine state in acceptance order; B waits behind A even if B saved first |
| Acknowledge | Report normal success after the operation's durable result and ordered publication; recovery resolves stored outcomes without replaying committed effects |

All data-reading paths, including PostgreSQL fallback reads, obey the accepted
[timestamped-snapshot contract](./02-timestamped-snapshots.md): an operation pins
one safe published timestamp, and every committed-data read answers at that
timestamp. A saved row is not automatically eligible for disclosure.
Do not derive a safe publication position from the largest persisted sequence:
earlier accepted work can still be unresolved. Stable identities, ordering
representation, bounds, snapshot lifetime and concrete cache/history storage
mechanisms remain open.

The reason to permit overlap is to avoid one database round-trip wait between
every independent save and follow Convex's mechanism. It is not a measured
throughput claim: slow A can delay B's publication, locks may serialize storage
work, and CPU, queue and memory limits still apply.

## Cart examples

For two independent carts in the same app, assuming no conflicting shared reads:

```text
A: Alice's cart 1 -> 2     accepted first; PostgreSQL is still saving
B: Bob's cart   4 -> 5     accepted second; PostgreSQL has saved it

B is durable but not yet published or acknowledged.
When A is confirmed durable: publish A, then B; complete their responses.
```

For two add-one requests based on the same old quantity of the same cart, both
cannot pass: A's accepted pending change invalidates B's read even before A is
durable. An eligible retry discards B's proposal and recomputes from a valid newer
view. This is not automatic replay permission for arbitrary Medusa/Payload hooks,
workflow steps or remote effects.

## Accepted uncertainty recovery

On an unresolved persistence outcome, the app owner follows:

```text
stop acceptance and normal publication
  -> fence old authority and settle outstanding database work
  -> reconcile every in-flight operation's durable outcome
  -> rebuild/reconcile the app's committed view and caches
  -> resume under valid ownership
```

Persist a stable operation identity and its outcome atomically with the data
change. Bind identity to the operation's authorized request; a current cart value
is not proof that a particular request committed. Reconcile B and every other
in-flight save, not only the operation whose connection failed.

- Confirmed committed: retain the change and resolve its recorded outcome; never
  repeat the increment or erase it because its acknowledgement was lost.
- Confirmed noncommitted: only an eligible operation may execute again against
  a fresh admitted view, under its profile's retry contract.
- Still uncertain: preserve uncertainty and stop progression; missing outcome on
  an immediate query or cancellation of a local task does not prove rollback.

If B is durable and A is not, recovery must preserve B and establish a valid new
view after proving A's disposition. It cannot fabricate a contiguous successful
commit prefix. The durable representation of such cases and the fencing/drain
protocol are unresolved; accepting this contract does not claim they exist.
The [read-after-write policy](./02-read-after-write.md#accepted-recovery-and-cold-cache-behavior)
gates new ordinary reads during recovery: bounded wait or explicit unavailable
failure until a safe view is reconstructed. Concrete readiness interlocks,
already-running operation handling, outcome retention/expiry and late callbacks
still require explicit protocols before implementation.

This is scoped engine recovery, not permission to crash unrelated apps. A thrown
request handler or automatic DO restart alone does not establish the contract.

## Pinned Convex mechanism and necessary differences

Reference revision: `84fbb0e70b4e857913673871cb847ad11a55f3d5`.
Use [REFERENCES.md](../REFERENCES.md#convex-source-identity) for file hashes,
provenance and the [source and divergence rules](../REFERENCES.md#source-and-divergence-rules).

| Convex owner / symbol | Mechanism to preserve or deliberately adapt |
| --- | --- |
| [committer.rs](../../../../../crates/database/src/committer.rs): `validate_commit`, `commit_has_conflict`, `pending_writes` | Serialize acceptance and include accepted pending changes in conflict checks |
| Same file: `persistence_writes: FuturesOrdered`, `start_commit`, `write_to_persistence`, `publish_commit` | Overlap saves, consume results in order, persist before publication/acknowledgement |
| Same file: `go`, `start`, persistence error branch | Escaping persistence failure stops the committer and signals shutdown; classified transient storage errors have a separate retry path |
| [database.rs](../../../../../crates/database/src/database.rs): `Database::load` | Reconstruct state from persistence under ownership, not from presumed success in old memory |
| [PostgreSQL driver](../../../../../crates/postgres/src/lib.rs): `Lease::transact` | Fence durable writes and resynchronize after ownership loss |

Accepted adaptations and their reasons:

- Portable TypeScript owners with Cloudflare adapters replace Rust runtime
  mechanisms because the selected initial host is a DO. Preserve the observable
  ordering/recovery guarantees; exact data structures and scheduling remain open.
- App-owner recovery replaces reliance on restarting a Rust backend process
  because a DO host has different lifecycle controls. The replacement must fence
  old work and rebuild state; it is not a weaker catch-and-continue policy.
- Framework-owned visibility/retry remains distinct because native Medusa and
  Payload operations are not all deterministic Convex mutations.
- Existing Flarex durable outcome guarantees remain requirements. Inspect the
  relevant Convex request identity/deduplication owners before mapping them; the
  committer's tracing `commit_id` alone is not a durable idempotency protocol.

There is no accepted divergence to force all independent saves into completion
order merely to retain old plumbing. The current [clock allocator](../../../packages/persistence-postgres/src/commit/publication/publication.ts)
and [previous-sequence enforcement](../../../packages/persistence-postgres/src/commit/publication/installation.ts)
couple publication to the existing sequence. A connected replacement must redesign
their callers, readers, recovery and data layout where necessary. Running those
unchanged calls concurrently is not this design.

## Remaining design and proof boundary

The published-read-view question is answered by
[timestamped snapshots](./02-timestamped-snapshots.md), including a PostgreSQL miss
while B is durable but unpublished. The [operation-lifetime policy](./02-operation-lifetime.md)
separates pre-acceptance expiry from accepted/uncertain outcomes that require
settlement or recovery. Next is
[resumable index backfill](./OPEN-QUESTIONS.md#next-question-resumable-index-backfill).
Detailed fencing, outcome representation and resource limits remain open.
Replication is deferred, not a prerequisite for proving this single-owner path.

Later proof must include nonconflicting saves completing out of order, same-cart
pending conflicts, no premature B disclosure through any read path, lost COMMIT
responses, B committed while A is unresolved, old-owner writes, cold reconstruction
and bounded queued work. Use actual framework witnesses and the existing
[validation gates](../VALIDATION.md); no implementation or measurement is claimed.
