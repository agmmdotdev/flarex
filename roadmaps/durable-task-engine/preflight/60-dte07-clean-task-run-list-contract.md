# DTE07 clean Task-run list contract

Status: implementation checkpoint completed privately on 2026-08-30.

Depends on the private run-list service and Standard bridge completed by
`4dfdf789`, plus the located PostgreSQL/PGlite store accepted after `8e4e5117`.
This checkpoint adds only the clean, unversioned Application facade. It adds no
SQL, route, production caller, deployment, live subscription, filter, event,
or attempt-history API.

## Decision

Add one root operation:

```ts
listTaskRuns(options?): Effect<
  TaskRunPage,
  ListTaskRunsError,
  StandardApplicationTaskRunListQuery
>
```

The options contain an optional page size and an optional opaque continuation.
Page size defaults to 50 and must be a safe integer from 1 through the existing
durable maximum of 100. The clean facade does not expose the internal cursor's
version, timestamp, run ID, ordering name, or persistence spelling.

## Cursor And Page

`TaskRunCursor` is a frozen process-local opaque handle. A private WeakMap owns
one defensive frozen copy of the internal keyset cursor. Only a cursor returned
by this package can be continued; a structural forgery fails as a clean option
error before query I/O. This is not a wire, HTTP, SDK, durable, or serializable
cursor contract.

`TaskRunPage` contains:

- authoritative `observedAtMs`;
- `runs`, the existing frozen/redacted `TaskRunStatus` projections; and
- `nextCursor`, which is null or a newly issued opaque cursor.

The facade renames the private page's generic `items` field to `runs` and
otherwise adds no lifecycle interpretation. It does not create typed
`TaskRun<Output>` handles because a scope-wide list has no captured definition
reference or output validator.

## Validation And Failures

The facade snapshots page size before cursor, validates the clean page-size
contract, and authenticates a supplied cursor before service invocation. It
maps only the private options error into `ListTaskRunsOptionsError`. Store and
store-contract failures retain identity without retry, logging, or
normalization. Defects and interruption remain outside the typed failure
channel.

## Ownership

- `@flarex/application-invocation` owns clean option names, the default size,
  opaque cursor authenticity, page naming, and clean option failures;
- `@flarex/standard-application-invocation` retains the scope-captured private
  query bridge and exports only the durable maximum needed by the facade;
- `@flarex/durable-task` retains ordering, cursor values, validation,
  projection, redaction, and query/store errors; and
- `@flarex/persistence-postgres` retains located authority, SQL, transaction,
  database time, collation, index, and corruption handling.

## Proof Gate

Focused tests must prove default and explicit page sizes, clean validation
before query I/O, opaque continuation round trips, frozen/redacted output,
absence of internal cursor fields, exact failure identity outside option
mapping, one clean root export, boundary admission, typechecks, lint gates, and
both standing reviews.

## Stop

Stop after this production-inert clean facade, tests, boundary receipt,
roadmap updates, validation, review, and commit. Do not add serialization,
filters, routes, deployment, live invalidation, bulk commands, attempts, or
events.

## Later Clean-Root Projection

The 2026-08-30 clean-root surface audit replaced the facade's direct status
alias with one Application-owned, unversioned projection shared by
`listTaskRuns()` and `inspectTask()`. The list service still supplies the exact
same authoritative durable facts and scope. The facade now copies and freezes
those facts, uses camel-case lifecycle vocabulary and its own opaque
`TaskRunId`, and omits the internal result codec. This later cleanup does not
change the query, store, cursor, ordering, redaction, or authority decisions in
this checkpoint.
