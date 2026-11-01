# Scoped app-generation supervision

Status: **Selected shared supervisor, actual DO/native consumers and connected
proof complete; broader profile and hosting gates remain open.**
Owner: [Scoped app-owner recovery](../slices/16a-app-owner-recovery.md).

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318`
`crates/database/src/committer.rs` stops the committer on an escaping persistence
failure; `Database::load` reconstructs authoritative state from persistence.
Its write batcher has separately classified retries of derived storage batches.
None of this grants automatic replay of native callbacks.

Cloudflare cannot rely on crashing an entire Rust backend process. The
[accepted app-scoped contract](../01-commit-coordination.md#accepted-uncertainty-recovery)
instead requires one portable generation supervisor, with Cloudflare supplying
hosting, wake, cancellation and resource adapters. Preserve the stop rule and
existing PostgreSQL fence/bootstrap mechanisms.

The [portable owner](../../../../packages/persistence-postgres/src/core/applicationOwner.ts),
[request census](../../../../packages/persistence-postgres/src/core/recoveryJournal.ts)
and [DO adapter](../../../../apps/executor/src/applicationDO.ts) implement that
boundary. The [native facade](../../../../packages/persistence-postgres/src/frameworks/commerceTransaction/nativeOwnerHost.ts)
borrows the same owner and closes only its selected profile. An early tracked
maintenance port lets schema alarms progress during Application preparation,
after full outcome reconciliation. See the owning slice for exact current
scope and remaining native/retirement gates.

The supervisor seals new admission and a bounded census enrolled before claim
submission; cancels and joins invocation work; drains the entire old generation
Scope and actual SQL saves; opens a successor under lease fencing; reconciles
every unresolved request; and rebuilds fresh services, bindings and caches.
Independently durable later saves survive. Unsaved dependent work cannot become
a success. Claimless administrative state is reconstructed without invented
outcomes or body replay. Failed recovery keeps serving unavailable.

Lazy profile construction prevents a withdrawn native source from blocking
unrelated services or historical committed disclosure. A new database object
cannot validate old generation's opaque bindings. No framework adapter performs
its own settlement, retry, database restart or outcome protocol.

Required proof includes real SQL rollback and same-key caller retry, unknown
commit acknowledgement, all-inflight independent/dependent saves, stale-owner
fencing, gated concurrent reads, actual Worker cancellation/drain and app DO
reconstruction on PGlite and ordinary PostgreSQL as applicable. No additional
physical tables, data reset or performance acceptance is selected.
