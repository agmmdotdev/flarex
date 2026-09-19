# Scope Clock Lock Contract Before Snapshot Reads

Status: lock-contract witnesses implemented against the existing PostgreSQL
clock schema and revocation owner. Production lock modes and transaction
profiles remain unchanged; connected snapshot-read cutover is open.

## Decision And Ownership

The scope clock combines sequence, generation, storage fence, epoch, revocation
and retained-history floor. A shared lock on that entire row currently excludes
publication throughout a standalone CMS read. Before adding a second fence row,
test whether PostgreSQL row-lock modes can separate these responsibilities at
the existing owner without duplicating authority.

The candidate contract is:

| Operation | Clock protection | Isolation and meaning |
| --- | --- | --- |
| Standalone snapshot read | `FOR KEY SHARE` | Repeatable read; preserve one data/clock snapshot and exclude strong authority transitions. |
| Ordinary publication | `FOR NO KEY UPDATE` | Existing write isolation and clock-first order; mutually exclusive sequence allocation remains. Only sequence/time may change under this mode. |
| Authority, retention or lifecycle transition | `FOR UPDATE` before inspecting/changing protected state | Retain strong exclusion against readers and publishers, including non-key authority fields. |

`FOR KEY SHARE` alone does not protect non-key fields. The explicit strong lock
at every transition owner is essential. Do not downgrade the general lifecycle
lock helper or substitute an unguarded `UPDATE` of authority columns. This is a
candidate protocol for the supported PostgreSQL version, not a new public API.

PostgreSQL documents compatible key-share/no-key-update modes and snapshot
failure on conflicting row changes in its [locking contract](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS)
and [repeatable-read contract](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-REPEATABLE-READ).
The decisive evidence must exercise Flarex's actual schema and transition owner;
compatibility of two locks alone is insufficient.

## Current Owner Inventory

- `scopeClock.ts` owns the full-row lock helpers and authorization revocation.
  Revocation already obtains `FOR UPDATE` before its conditional epoch update.
- `retainedHistoryFloorObservation.ts` protects floor advancement with the same
  strong clock lock. That protection must remain.
- `scopeClockInitialization.ts` owns initial identity; publication must never
  alter scope identity, generation, fence, epoch or revocation fields.
- `commitPublication/publication.ts` advances only sequence/time. Its callers
  currently obtain stronger clock locks in native point commit, CMS, commerce,
  atomic commerce and cross-domain hosts. They retain clock-first ordering.
- Activation, binding, schema-candidate, relation/index/unique build and readiness
  transitions also take strong clock protection. Do not classify them as ordinary
  publishers merely because they write metadata rather than the clock itself.
- `physicalSession/postgres.ts` currently starts read-committed transactions.
  `relationalTransaction/session.ts` exposes one such execution profile. CMS
  standalone reads and nested reads currently share that lifetime model; only a
  standalone read can select a future repeatable-read profile. Nested reads must
  retain their mutation's pending state.

This inventory identifies owners, not a completed audit of every SQL statement.
The connected cutover must trace direct and implicit locks and every affected
writer before claiming admission or overlap safety.

A strong clock lock without a clock-row update is not a durable version stamp.
Transitions that change active heads or readiness in other rows require their
own current, locked admission checks under repeatable read. The revocation
witness does not establish those contracts: revocation changes the clock row.

## Contract Witnesses And Non-Goals

Use the migrated `fx_system_scope_clock` under an ordinary PostgreSQL role and
distinct transactions. Prove compatibility with an uncommitted sequence update,
publication progress while a snapshot reader holds key share, and stable clock
observations after publication. A snapshot formed before ordinary sequence
advancement must also acquire its first key share after that advancement commits
without losing its original observation. Force the existing revocation owner to contend
with a live snapshot reader, then prove it succeeds after the reader ends.
If revocation commits after the snapshot forms but before key-share admission,
admission must fail with serialization refusal rather than accept stale authority.
The refusal must survive a later ordinary sequence update too, rather than
depending on revocation being the most recent row version.

Direct sequence updates in these tests are explicit lock-protocol probes. They
are not commit publication, CMS command execution, a benchmark or a second engine.
PGlite owner tests retain decoder/revocation semantics; only ordinary PostgreSQL
can establish these multi-connection lock outcomes. Run affected types, lint and
both reviews, and stop owned resources.

## Connected Cutover Gate

If these witnesses pass, implement the named standalone snapshot profile at the
existing physical/session owners and migrate CMS read admission plus all selected
ordinary publishers coherently. Preserve strong transition locks and replace the
displaced read-lock path. Keep a read-only data capability: PostgreSQL SQL `READ
ONLY` does not admit locking selects. No command callback may be retried merely
because repeatable-read admission can reject a stale snapshot.

Before activation, prove actual reads overlap held publication, repeated document
and incoming-relation reads remain coherent, transitions cannot admit stale
authority, nested reads retain pending changes, and deadlines/cleanup/replay
remain intact. If the real lock audit contradicts the candidate, select a separate
fence owner explicitly instead. This slice does not implement concurrent writers,
change dense sequence assignment, weaken corruption checks or complete CE3.
