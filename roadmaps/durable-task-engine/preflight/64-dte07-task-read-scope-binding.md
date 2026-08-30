# DTE07 Task read scope binding

Status: DTE07-C15 implemented privately on 2026-08-30.

Depends on the clean Task run-list facade, process-local `TaskRunRef`, and the
central Standard Application Task read composition completed under preflights
60 through 63. This checkpoint closes one service-composition gap. It changes
no database query, stored schema, wire format, lifecycle authority, public
route, deployment, or production activation.

## Decision

The Standard run-list query service carries the exact point-query capability
that owns its authorization scope:

```ts
interface StandardApplicationTaskRunListQueryApi {
  readonly scope: StandardApplicationTaskRunQueryApi
  readonly list: (request: TaskRunListRequest) => TaskRunListEffect
}
```

`listTaskRuns()` requires only this bound list service. Every returned
`TaskRunRef` captures `listQuery.scope`; callers cannot separately provide an
unrelated point-query service during reference issuance.

The central `StandardApplicationTaskReadQuery` Layer is the only live factory
for the Standard list service. It accepts one authentic
`ApplicationTaskReadStore` and publishes list, point, attempt-history, and
event-history services from that store. The list, attempt, and event services
all retain the same point-query object by identity.

The displaced standalone list-service Layer and its package subpath are
removed. List service types and the direct operation wrapper are re-exported
from the central read-query subpath. The clean root operation and data shapes
remain unversioned and unchanged.

## Authority And Compatibility

This is an internal composition correction, not a new authorization model.
The located read store still owns scope capture and transaction-time scope
revalidation. `TaskRunRef` authentication still rejects forged and cross-bundle
references before persistence I/O.

Tests may provide a structurally valid service directly to isolate the clean
facade. Production composition cannot create a live list service from a
separate store or point-query capability because no such factory or package
entrypoint remains.

The Effect requirement channel becomes narrower: `listTaskRuns()` now depends
only on `StandardApplicationTaskRunListQuery`. Existing callers that provide
the central read Layer remain compatible. No dual path or fallback is added.

## Proof Gate

Focused proofs cover:

- central construction of list, point, attempt, and event queries from one
  authentic store;
- exact list-request delegation and typed failure identity without retry;
- exact identity between the list service's scope and the central point-query
  service;
- rejection of a forged store by the central Layer;
- clean list success with references issued from the bound scope;
- rejection of forged and cross-bundle references before query I/O; and
- package and Trigger-compatibility boundary enforcement for the single live
  composition owner.

Package typechecks, focused suites, Application boundary tests, Oxlint gates,
and both standing reviews must pass before commit. A real PostgreSQL receipt is
not required for this checkpoint because persistence behavior and SQL are
unchanged.

## Stop

Stop after scope binding, tests, roadmap receipts, validation, review, and
commit. Live invalidation, enriched attempt history, other commands, public
routes, hosted activation, and UI publication remain separately approved
gates.
