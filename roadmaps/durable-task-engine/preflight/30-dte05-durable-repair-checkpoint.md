# Preflight 30: DTE05 Durable Repair Checkpoint

## Status

**Decision:** Admit DTE05-E2A and E2B. E2A adds the canonical Task repair-sweep
continuation codec and distinct Task-owned scheduler row. E2B adds the private,
production-inert fenced acquire/renew/checkpoint/release transaction protocol.
It does not admit the connected repair runner, a scheduled host, Cloudflare
binding, deployment, or activation.

**E2A implementation status:** Complete on 2026-08-09.

**E2B implementation status:** Complete on 2026-08-09. DTE05-E2 remains
active. E2C1 is tracked by
[`31-dte05-connected-repair-runner.md`](./31-dte05-connected-repair-runner.md).

DTE05-E2 remains active after this slice. E2C1 owns the connected runner,
duplicate-host, expiry, crash/restart, and high-water fairness proofs; E2C2 owns
the database-timeout proof.

## Why E2 Is Split

The E1 sweep returns enough state to resume fairly, but its TypeScript object is
not durable evidence. Persisting that object safely requires two independent
claims:

1. the bytes have one versioned, bounded, canonical, digest-bound meaning; and
2. only a fenced database transaction may replace those bytes.

E2A establishes the first claim and the storage shape required by the second.
It deliberately does not publish transaction methods before their rollback,
uncertainty, expiry, and timeout contracts can be proved together. A table row
named `claimed` is inert storage state, not an operational lease API.

## Admitted E2A Contract

### Canonical continuation codec

`@flarex/executor/internal/task-repair-sweep-continuation-codec-v1` owns the
storage representation of `TaskRepairSweepContinuationV1`.

- encoding revalidates the complete continuation instead of trusting its
  TypeScript type;
- directory cursors reuse the replacement-scope directory decoder and Task due
  cursors reuse the durable-task run-read decoder;
- exact object keys, brands, cursor/due-kind correlation, and ordering are
  checked before the value is accepted;
- canonical JSON bytes are bounded, SHA-256-bound, detached on input/output,
  and re-encoded during decode to reject noncanonical evidence; and
- typed codec failures cover expected invalid evidence and crypto failures,
  while defects and interruption remain outside the typed error channel.

The persisted continuation still grants no tenant, scope, locator, database,
or execution authority. An active-partition resume must freshly resolve the
exact persisted deployment/scope candidate through the repair directory before
resuming its inner due cursor. The persisted directory position determines
only where the original bounded snapshot continues after that partition.

### Task-owned scheduler row

`fx_system_durable_task_repair_scheduler_v1` is a singleton control row in the
control metadata database. It is intentionally distinct from
`fx_system_point_mutation_redelivery_scheduler`.

The row reserves:

- a fixed Task repair scheduler key;
- idle/claimed state, database-owned claim timestamps, owner UUID, and a
  monotonic run fence;
- a monotonic checkpoint sequence and next-run timestamp; and
- all-or-none continuation codec version, canonical bytes, and SHA-256.

Database checks reject malformed state combinations, negative fences or
sequences, invalid/infinite timestamps, unsupported codec versions, oversized
continuations, and invalid digest lengths. The migration inserts one idle row
with no continuation. E2A exposes no repository that can mutate it.

## Admitted E2B Contract

`@flarex/persistence-postgres/internal/task-repair-scheduler-checkpoint-v1`
owns one private repository over the E2A singleton row.

- acquire locks the singleton, reads the database clock once, returns `notDue`
  or `busy` without mutation, and otherwise advances the lifetime fence before
  minting a process-local Task repair run handle;
- renew, checkpoint, and release accept only the exact handle minted by that
  repository instance and serialize same-handle operations;
- every mutation correlates owner UUID and run fence, while checkpoint and
  release additionally correlate the checkpoint sequence and continuation
  digest;
- continuation inputs are byte- and digest-validated, defensively captured,
  and written atomically; a checkpoint never authorizes a Task lifecycle
  transition or a trusted scope;
- database timestamps govern due, busy, expiry, renewal, and release decisions;
  no application clock participates in lease authority;
- a confirmed statement rollback permits exactly one retry of the identical
  command, while a changed retry, second rollback, stale state, uncertainty,
  or a defect/interruption after transaction dispatch closes the process-local
  run; pre-dispatch validation failure or interruption grants no database
  decision and does not close an otherwise current run; and
- decision-uncertain failures remain distinct from confirmed rollback so a
  caller cannot safely assume whether the database committed.

The shared fenced singleton engine is reused with an immutable physical
storage policy. The Task wrapper mints its own handle, exposes its own errors,
and selects only `fx_system_durable_task_repair_scheduler_v1`; it cannot mutate
or present the point-mutation scheduler as Task authority.

## Reuse And Ownership

The point-mutation checkpoint is implementation evidence only. E2A reuses the
executor-owned canonical codec mechanics through a package-local generic
helper, but it does not reuse the point-mutation table, key, model constants,
run handle, transaction repository, or authority.

The Task continuation decoder delegates leaf validation to existing owners:

- replacement-scope directory continuation policy stays in persistence; and
- due-discovery cursor policy stays in `@flarex/durable-task` and is reached
  through the already private repair-directory seam.

No Prisma or Trigger runtime package enters the active graph, and no Task
lifecycle transition is reimplemented.

## E2A Validation Gate

E2A must prove:

- round-trip canonical encoding with owned byte and digest snapshots;
- rejection of excess properties, invalid brands, cursor/due-kind mismatch,
  malformed JSON, invalid UTF-8, noncanonical bytes, digest mismatch, and byte
  overflow;
- defects and interruption remain outside the typed codec failure channel;
- migration idempotency and presence of exactly one idle Task repair row;
- database rejection of invalid key/state/claim/continuation/timestamp shapes;
- package typechecks plus Effect, Trigger, and Standard Application boundary
  checks; and
- no import from an app, Worker entrypoint, Wrangler file, scheduled handler,
  or deployment configuration.

## Deferred E2C Work

E2C must prove the connected protocol in genuine PostgreSQL with duplicate
hosts, claim expiry/takeover, stale-owner rejection, crash after lifecycle
commit but before scheduler checkpoint, process restart, and bounded
high-water fairness. It must also establish database-owned statement, lock,
and transaction timeout behavior and deliberately stall a transaction. Effect
interruption alone is not accepted as a hard wall-time proof.

## E2B Validation Gate

E2B must prove:

- the Task repository mutates only the Task scheduler row while preserving all
  existing point-mutation checkpoint behavior;
- handles are opaque, repository-local, and permanently closed after release,
  stale authority, uncertainty, invalid retry order, or defect/interruption
  after transaction dispatch;
- acquire/renew/checkpoint/release use database time and fenced correlations;
- input and reloaded continuation bytes/digests are ownership-isolated;
- a confirmed rollback permits only one identical retry, while database
  uncertainty remains a distinct typed failure;
- unexpected callback causes remain defects; and
- no app, Worker, scheduled handler, binding, or deployment imports the private
  protocol.

## Stop Boundary

DTE05-E2A/E2B do not authorize:

- copying or casting the point-mutation checkpoint as Task state;
- a public persistence API or executor-root export;
- treating a Task repair run handle as tenant, scope, lifecycle, or execution
  authority;
- trusting the persisted scope or deployment spelling as current authority;
- changing Task lifecycle, Queue, requested-effect, OCC, commit, or outbox
  owners;
- a new runtime bridge, scheduled Worker handler, Wrangler Cron Trigger,
  deployment, or production activation; or
- marking DTE05-E2 or DTE05-E complete.

## Completion Evidence

- all five Task continuation-codec tests and all four refactored
  point-mutation continuation-codec regressions passed;
- the full executor regression passed 368 active tests with five existing
  skips, while all 14 E1 repair-sweep tests remained green;
- the focused PGlite schema suite passed three tests and the complete migration
  regression passed all 26 tests;
- the final focused PostgreSQL 18 lane passed both its fail-closed environment
  gate and isolated 0048 migration/receipt/seed/constraint test; it used the
  repository's temporary-schema isolation with no database-admin privilege,
  and the disposable cluster was stopped and removed afterward;
- executor and persistence package typechecks, script typecheck, Drizzle
  consistency, Trigger and Standard Application boundaries, the 65-vector
  lifecycle gate, and the 29-entry source-map gate passed;
- a staged-source Effect boundary check passed for every changed production
  module; and
- both required project reviewers accepted the final staged diff with no
  findings. No app, Worker entrypoint, scheduled handler, Wrangler file,
  runtime bridge, or deployment configuration imports or activates E2A.

E2B additionally proves five focused Task protocol scenarios plus all 17
existing point-mutation checkpoint regressions in PGlite: Task-only
acquire/renew/checkpoint/release and restart reload, process-local handle and
stale-state rejection, exact confirmed-rollback retry policy, committed-but-
uncertain settlement closure, and defect preservation. The point-mutation row
remains unchanged while the Task protocol advances its separate row.
