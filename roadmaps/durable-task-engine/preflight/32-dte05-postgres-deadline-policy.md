# Preflight 32: DTE05 PostgreSQL Deadline Policy

## Status

**Decision:** Complete DTE05-E2C2 as a production-inert PostgreSQL adapter and
genuine-PostgreSQL proof on 2026-08-10. This checkpoint owns only the database
deadline and connection-disposition contract required by the connected Task
repair runner. It does not add a Worker, Cron Trigger, binding, deployment,
public API, or activation path.

## Why The Deadline Starts With The Connection

The connected runner already waits for every scheduler transaction to settle.
An Effect timeout may interrupt the host fiber, but it cannot prove that an
in-flight PostgreSQL statement stopped or that its transaction committed or
rolled back. Returning before that outcome is known would make checkpoint and
lease decisions unsafe.

The Task repair host therefore requires a dedicated PostgreSQL pool whose
connections start with all three server-owned limits already installed:

- `lock_timeout` bounds each database lock acquisition;
- `statement_timeout` bounds each database statement; and
- PostgreSQL 18 `transaction_timeout` terminates a session whose transaction
  spans longer than the admitted whole-transaction limit.

The same final pool configuration owns a positive node-postgres
`connectionTimeoutMillis`, bounding both saturated-pool waits and connection
handshakes before `BEGIN`.

Installing these values in the PostgreSQL startup packet avoids an unbounded
configuration statement before the first transaction. The policy is scoped to
the dedicated Task repair pool; it must not mutate the shared application pool
or silently impose Task host limits on unrelated Flarex transactions.

## Admitted Policy Contract

The private PostgreSQL policy constructor must:

1. accept only positive safe-integer acquisition, lock, statement,
   transaction, and settlement-reserve millisecond values and revalidate them
   at the pool-configuration application boundary;
2. require `lock < statement < transaction` so the narrower database event
   normally reports the narrower deadline;
3. require `acquisition + transaction < settlement reserve`, exposing the
   remaining positive disposition margin and leaving the connected runner's
   reserved tail large enough for acquisition, database termination, driver
   settlement, and connection disposition;
4. apply to the complete final pool configuration, fail closed on competing
   acquisition, query, idle-transaction, or database deadlines in top-level
   fields or the connection-string query, and reject any connection-string
   `options` value because the installed driver would replace the owned startup
   string with it;
5. preserve unrelated trusted-host top-level startup options such as an isolated
   `search_path`, while failing closed if the supplied string mentions any of
   the three owned timeout names rather than attempting to parse or overwrite
   a competing deadline policy;
6. derive the PostgreSQL startup spelling from the revalidated numeric snapshot
   rather than trusting a caller-supplied or structurally forged string;
7. preserve all other caller-owned pool configuration without exposing it as
   Task authority; and
8. produce a frozen shallow configuration snapshot with the exact acquisition
   timeout and three
   PostgreSQL startup settings appended last.

This contract intentionally requires PostgreSQL 18 for the E2C2 host lane.
PGlite remains the fast ordinary-behavior lane and does not claim support for
the PostgreSQL session-termination proof.

## Settlement And Quarantine Contract

The existing located READ COMMITTED transaction owner remains responsible for
BEGIN/callback/commit-or-rollback settlement and pool release. E2C2 does not
add a second transaction wrapper.

- A lock or statement timeout observed inside the scheduler callback followed
  by a successful rollback is a direct-class confirmed rollback. The existing
  scheduler policy may retry the identical operation once when its claim and
  run reserve still admit it.
- A whole-transaction timeout terminates the PostgreSQL session. The located
  transaction owner must wait for the driver outcome, classify the failed
  cleanup without guessing a commit decision, and release the client with a
  discard error so the pool cannot reuse it.
- No timeout path may be converted into success, a stale checkpoint, or an
  uncertain retry. The connected runner may return only after the transaction
  outcome classification and connection release/discard operation have both
  settled.

## Genuine PostgreSQL Gate

The focused PostgreSQL 18 lane must prove:

- each fresh Task repair connection reports the admitted lock, statement, and
  transaction settings before any scheduler transaction;
- a saturated one-client pool rejects acquisition within the admitted
  connection timeout and accepts work after capacity returns;
- a deliberately blocked scheduler-row lock stops at `lock_timeout`, rolls
  back, and is classified through the existing confirmed-rollback contract;
- a deliberately long statement stops at `statement_timeout` and the same
  connection remains usable only after its rollback has settled;
- a transaction held beyond `transaction_timeout` terminates its session, the
  located runner supplies a non-empty discard reason, and the pool services the
  next operation with a healthy replacement connection; and
- the focused connected-runner and PGlite checkpoint regressions remain green.

Timing assertions must use generous outer test ceilings. The proof owns which
database deadline fired and whether settlement/disposition completed; it does
not claim millisecond-exact scheduling from Windows, Node.js, Vitest, or CI.

## Resolved Shared-Owner Evidence

The first E2C2 genuine-PostgreSQL run on 2026-08-10 used a disposable
PostgreSQL 18.3 cluster and the admitted `150ms` lock, `500ms` statement, and
`1000ms` transaction settings.

Reproduction:

1. acquire a client through the existing
   `createPostgresLocatedReadCommittedTransactionRunnerV1` owner;
2. begin its real Drizzle READ COMMITTED transaction;
3. leave the callback idle beyond `transaction_timeout` and then attempt one
   query; and
4. await the located runner's settlement and release path.

Expected behavior: the checked-out client has a scoped error observer from
acquisition through release; SQLSTATE `25P04` becomes transaction-termination
evidence; the runner waits for the callback/transaction outcome, supplies a
discard reason, and no process-level error escapes.

Actual behavior: PostgreSQL emits fatal SQLSTATE `25P04`, followed by the
driver's `Connection terminated unexpectedly` event. Because
`postgresLocatedReadCommitted.ts` does not own an error listener while its
`PoolClient` is checked out, Vitest observes both as uncaught exceptions. The
runner later reaches `callbackCleanupFailed` and its discard path, but a real
host could already have an unhandled error event.

Affected owner: the shared located PostgreSQL connection lifecycle in
`packages/persistence-postgres/src/postgresLocatedReadCommitted.ts`, not the
Task deadline-policy encoder or the E2C2 test harness. Lock-timeout and
statement-timeout cases already pass and prove rollback settlement plus safe
same-connection reuse; only the required session-termination path exposes this
gap.

Approved correction: the located pool runner now attaches a scoped error
observer inside the pool acquisition callback before that callback returns,
retains the first connection
event beside the transaction settlement cause, forces discard whenever that
event exists, and removes its observer only after release transfers lifecycle
ownership back to the pool. A focused fake-client regression proves listener
ownership, exact `25P04` evidence retention, cleanup-failure classification,
discard, and removal. The real PostgreSQL termination test no longer emits an
uncaught process-level error.

## Completion Evidence

Completion evidence on 2026-08-10:

- 18 pure policy tests prove exact startup spelling, application-boundary
  revalidation, forged-string non-authority, top-level configuration
  capture, all numeric/order/reserve failures, unrelated startup-option
  preservation, and competing-timeout rejection;
- 12 connected transaction tests prove existing settlement behavior plus
  checked-out-client error ownership and discard;
- 41 PGlite policy/checkpoint regressions pass;
- five genuine-PostgreSQL 18.3 checks prove the exact startup values, bounded
  saturated-pool acquisition and recovery,
  SQLSTATE `55P03` lock cancellation with rollback/reuse, SQLSTATE `57014`
  statement cancellation with rollback/reuse, and SQLSTATE `25P04` session
  termination with cleanup classification, discard, a replacement backend PID,
  and a healthy subsequent query;
- the three-test E2C1 genuine-PostgreSQL connected runner and 34-test executor
  connected-runner/core regressions pass;
- persistence-postgres typecheck and the workspace Effect boundary gate pass;
  and
- both required project reviewers accepted the final staged diff with no
  remaining findings.

E3 remains prohibited until its own scheduled-host and deployment preflight.

## Stop Boundary

E2C2 does not authorize:

- changing the general Flarex transaction runtime or all PostgreSQL pools;
- weakening confirmed-rollback versus uncertain/cleanup-failure semantics;
- adding client-only Promise rejection as a substitute for server
  cancellation;
- changing Task lifecycle, Queue, OCC, commit, outbox, or application-row
  owners;
- adding a scheduled host or deployment configuration; or
- marking DTE05-E3, DTE05-E, or Roadmap 05 complete.
