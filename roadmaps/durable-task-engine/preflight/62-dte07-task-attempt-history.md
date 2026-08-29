# DTE07 Task attempt history

Status: DTE07-B3/C11/C12/C13 implemented privately on 2026-08-30. The
PGlite instance proof is complete. The equivalent disposable PostgreSQL test
lane is checked in but its acceptance receipt remains outstanding because
`FLAREX_POSTGRES_DATABASE_URL` was unavailable in this workspace.

Depends on the private Task projection owner, the captured Standard point-query
scope, the located Task persistence authority, and the process-local
`TaskRunRef` completed under preflight 61. This checkpoint adds one read-only
attempt-admission query. It does not add lifecycle-event reconstruction,
attempt status, result or failure bodies, commands, routes, deployment, live
delivery, or production activation.

## Decision

The clean operation is:

```ts
listTaskAttempts(reference: TaskRunRef): Effect<
  TaskAttemptHistory,
  ListTaskAttemptsError,
  StandardApplicationTaskAttemptHistoryQuery
>
```

The returned history is a frozen owned projection containing the run identity,
database observation time, current run version, and at most 250 immutable
attempt admissions in ascending attempt-number order. Each admission exposes
only `attemptId`, `attemptNumber`, and `admittedRunVersion`.

The persisted attempt-identity row is authoritative for those three facts. It
does not retain enough evidence to reconstruct every historical attempt's
status, duration, lease loss, completion, retry decision, result, or failure.
Those fields are therefore omitted rather than guessed from the current run
aggregate. The execution fence remains internal authority and is not projected.

## Authority And Consistency

`TaskRunRef` remains process-local and fieldless. The located persistence owner
issues one opaque, runtime-authenticated Task read store containing list, point,
and attempt-history operations captured from the same authority. Structural
method intersections and copied wrappers are not authentic stores. One
Standard read-bundle Layer accepts only that issued capability and constructs
both the point-query capability and history service from it. The history
service captures that newly issued point capability; its factory cannot accept
an independently supplied point scope or structurally mixed store.
`listTaskAttempts()` authenticates the reference and compares the captured
capability by identity before persistence I/O. Invalid point/history store
candidates and genuine references moved into another read bundle fail before
history I/O.

The previously accepted `listTaskRuns()` Layer still receives its list and
point services through trusted host composition. This checkpoint does not
claim that a deliberately cross-wired list service is detected. Production or
public activation must first bind list, point, and history through the opaque
located read store or approve an equivalent shared scope token.

The located persistence store revalidates captured scope authority inside its
transaction. One left-join statement reads the Application run version and
its immutable attempt rows from the same database statement snapshot. This
avoids combining a newer attempt admission with an older separately read run
version under `READ COMMITTED`. The query is capped at 251 joined rows so the
domain can reject an over-limit store without an unbounded read. The existing
run primary key and attempt ordinal unique index own the access path; no schema
or migration is added.

The durable projection rejects invalid observation time, run version, attempt
shape, count, numbering, order, non-advancing admitted versions, and admitted
versions later than the returned run version. It clones and freezes the output
and preserves typed store failures without retry.

## Proof Gate

Focused proofs cover projection ownership and every ordering/version bound;
Standard authentic read-bundle construction, structural mixed-store rejection,
and equal-run-ID isolation;
PGlite run creation, retry, two admitted attempts, empty history, missing run,
and stale authority; clean same-bundle success; and forged or cross-bundle
reference rejection before I/O.
The PostgreSQL lane creates a real run and attempt and inspects the ordinal
index plan when its required database URL is available.

Package typechecks, focused tests, Application-definition boundary checks,
Oxlint gates, and both standing reviews must pass before commit. A real
PostgreSQL run remains required before claiming PostgreSQL acceptance for this
store.

## Stop

Stop after this immutable attempt-admission history, tests, roadmap receipts,
validation, review, and commit. The next read-only gate may design persisted
lifecycle events or an explicitly state-enriched current-attempt view, but it
must not infer historical state from the current aggregate. Do not add event
storage, results, failure messages, execution fences, commands, serialization,
routes, live invalidation, UI, public SDK, or production activation here.
