# Live Clock Audit

Status: active migration evidence.

Evidence snapshot: 2026-08-28 with Effect `4.0.0-beta.90`.

## Classification

The audit separates acquiring the current time from deterministic conversion.
It also distinguishes application time from database and platform authority.

| Owner | Current use | Classification | Disposition |
| --- | --- | --- | --- |
| `SchedulerDO` Effect operations | Continuation due checks and the default connection-cleanup cutoff | Application time inside Effect | Migrated to scheduler-owned operations backed by Effect `Clock` and `DateTime` |
| `SchedulerDO.alarm` and alarm setters | Callback observation and Cloudflare alarm epoch values | Durable Object platform adapter | Retain direct platform time at the adapter |
| `SchedulerDO` continuation persistence helpers | Persisted retry and continuation scheduling inside Promise storage adapters | Application time entering a storage adapter | Migrated: owning Effect operations acquire and format time before the Promise boundary |
| Scheduler pending-state alarm recovery | Fallback when stored continuation data is missing or malformed | Platform recovery adapter | Retain direct platform time in the alarm-refresh adapter |
| `PartitionDO` commit metadata | Durable Object SQLite `created_at` values | Commit-metadata authority decision | Defer until one-read versus per-row time and transaction placement are specified |
| JWT bearer verification | Optional caller observation with a live default | Compatibility and foreign verification boundary | Retain the injected `now` contract |
| Executor `Clock` port | Health, sessions, retries, maintenance, and live queries behind Promise APIs | Existing package capability | Requires a separate executor composition preflight; do not partially replace it |
| PostgreSQL persistence | Leases, expiry, ordering, scope clocks, and stored evidence | Database authority | Retain PostgreSQL time inside the owning transaction |
| Delivery, connection, and runtime Durable Object edges | Alarms, heartbeat timestamps, request deadlines, and connection receipts | Cloudflare platform adapters | Retain unless domain timing is later moved behind an Effect operation |
| Tooling, probes, and tests | Watchdogs, elapsed duration, evidence timestamps, and generated-source cache busting | External wall clock or monotonic observation | Retain direct platform time |

## First Scheduler Slice

The first migration removes the six direct platform-clock reads identified by
the semantic lint rule inside `SchedulerDO` Effect operations. Scheduler-owned
operations now:

- compare a decoded continuation with `Clock.currentTimeMillis`;
- preserve an alarm callback's explicit platform observation without taking a
  second clock reading; and
- format the default connection-cleanup cutoff from `DateTime.now`.

The operations have no error channel and require no new service or Layer: the
installed Effect clock is already the correct capability. `TestClock` pins the
due boundary, one-millisecond pending boundary, exact ISO spelling, missing-date
short circuit, and explicit platform-observation behavior.

This slice does not change continuation persistence, Durable Object alarm
ownership, stored-state parsing, PostgreSQL time, retry delays, or public route
shapes.

## Scheduler Storage Slice

Scheduler retry and continuation timestamp acquisition now occurs in the
owning Effect operations. A scheduler-local delayed-instant operation reads
Effect `Clock`, adds the existing millisecond delay, and preserves the exact ISO
representation written to storage through the `@flarex/time` canonical-instant
owner. ISO formatting remains fallible and each caller maps that failure through
its existing route-operation error boundary.

The branch structure deliberately preserves:

- no clock read on delete, missing-cursor, and cursorless retry no-op branches;
- storage write and alarm-refresh order;
- retry-attempt calculation and delay caps;
- typed storage and runtime failure mapping; and
- the exact stored ISO representation.

The foreign boundary remains one `Effect.tryPromise` per selected storage
branch. It performs the same delete or put before refreshing the Cloudflare
alarm. The clock read occurs before that boundary and remains controllable by
`TestClock`.

## Next Bounded Gate

`PartitionDO` commit metadata remains a separate authority decision because a
single shared observation and two per-row observations are observably different
inside one commit. Preflight that decision before changing either `created_at`
write.
