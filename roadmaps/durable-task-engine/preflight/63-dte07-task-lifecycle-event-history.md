# DTE07 Task lifecycle-event history

Status: DTE07-B4/C14 implemented privately on 2026-08-30. The connected
PGlite instance proof is complete. The checked-in disposable PostgreSQL lane
remains unexecuted because `FLAREX_POSTGRES_DATABASE_URL` is unavailable in
this workspace.

Depends on the durable requested-effect ledger, the private Task projection
owner, the opaque located Application Task read store, and process-local
`TaskRunRef` completed under preflights 20, 61, and 62. This checkpoint adds
one read-only lifecycle timeline. It does not expose the requested-effect
ledger, delivery state, execution fences, payload/result bodies, logs, traces,
commands, routes, deployment, live invalidation, or production activation.

## Decision

The clean operation is:

```ts
listTaskEvents(reference: TaskRunRef): Effect<
  TaskEventHistory,
  ListTaskEventsError,
  StandardApplicationTaskEventHistoryQuery
>
```

The returned history is a frozen owned projection containing the run identity,
database observation time, current run version, and the complete durable
lifecycle-event timeline in requested-effect sequence order. Each entry
exposes only its immutable sequence, recording run version, event observation
time, and the already-redacted `TaskLifecycleEventProjectionV1` contract.

The lifecycle model admits at most 751 events: 250 attempt grants, 250 first
execution observations, 249 retry schedules, one cancellation request, and one
terminal event. The API therefore returns one bounded timeline rather than
inventing a cursor. Heartbeat renewals and other internal requested effects can
grow independently, but the SQL owner filters them before applying the 752-row
corruption sentinel.

## Authority And Consistency

The requested-effect ledger is authoritative only for immutable accepted
intent. This query selects only `publish_lifecycle_event` rows and decodes and
correlates their complete persisted envelopes before projection. Dispatch,
wake, cancellation-delivery, queue-release, state-notification, lease, fence,
and provider facts remain private.

The existing opaque Application Task read store now owns list, point, attempt,
and event reads from one captured located authority. Its private issuance token
and runtime authenticity registry remain mandatory. One Standard read Layer
constructs the point, attempt, and event services from that authentic store;
both history services capture the exact newly issued point-query capability.
`listTaskEvents()` authenticates the process-local reference and rejects a
cross-bundle reference before persistence I/O.

The located store revalidates captured scope authority in its transaction. One
left join reads the Application run version and all lifecycle rows from the
same database statement snapshot. Rows are ordered by immutable requested-
effect sequence and limited to 752. The current ledger kind index owns this
access path; no schema or migration is added.

The durable projector rejects invalid observation time, run version, event
shape, count, non-increasing ledger sequence, non-advancing recording version,
and recording versions later than the returned run. It clones and freezes all
projected event objects, including nested retry, cancellation, and failure
facets, and preserves typed store failures without retry.

## Proof Gate

Focused proofs cover projection bounds, ordering, versions, nested ownership,
and failure identity; Standard shared-scope construction and forged-store
rejection; clean same-bundle success plus forged/cross-bundle rejection before
I/O; and a PGlite run with two attempt grants and a retry whose three lifecycle
events are returned in durable order. The PostgreSQL lane checks the same
connected read and ledger-kind index when its required database URL is
available.

Package typechecks, focused tests, Application package-boundary checks,
Oxlint gates, and both standing reviews must pass before commit. A real
PostgreSQL run remains required before claiming PostgreSQL acceptance.

## Stop

Stop after this lifecycle-event history, tests, roadmap receipts, validation,
review, and commit. Enriched historical attempt state is not reconstructible
from current retained evidence and must not be guessed. Live invalidation,
serializable transport cursors, logs, traces, output streams, routes, public
SDKs, UI, and production activation remain later separately approved gates.
