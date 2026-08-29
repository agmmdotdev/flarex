# DTE07 Private Task Run List Query Preflight

Status: implementation checkpoint approved on 2026-08-29.

Evidence snapshot: 2026-08-29 current repository state at commit `a5151ae1`.

## Decision

Add one production-inert, scope-captured private Task run list query beneath a
later clean `listTaskRuns()` facade.

This checkpoint defines:

- a maximum page size of 100;
- one concrete internal keyset cursor contract ordered by
  `(createdAtMs DESC, runId canonical-ASCII DESC)`;
- a captured Application-scope list-store capability returning only bounded
  projection inputs rather than lifecycle aggregates;
- one durable `TaskRunListQuery` service that validates input and store output,
  decodes each bounded input through the domain-owned Schema, applies the
  existing safe single-run projection owner, and derives the next cursor;
  and
- one private Standard Application bridge over that service.

There is no existing Task-run list store or PostgreSQL adapter. This checkpoint
does not add one. Hosts may provide the new capability only after separately
capturing and authorizing one Application scope.

## Cursor And Ordering

The internal `TaskRunListCursorV1` contains only:

```ts
{
  version: 1,
  createdAtMs,
  runId,
}
```

It means “continue strictly after this position” in newest-first ordering. The
query validates the cursor version and both branded fields, copies it, and
passes it to the captured store. Store pages must be strictly descending,
contain no position at or before the wrong side of the supplied cursor, and
contain no more than the requested page size.

Task run IDs have one fixed-length lowercase-ASCII spelling. Their tie-break is
canonical ASCII/UTF-8 byte order, which is the same as JavaScript string order
for this grammar. A PostgreSQL adapter must use the equivalent deterministic
binary ordering for both `ORDER BY` and its keyset predicate, for example
`COLLATE "C"`; database-default collation is not authority. The adapter gate
must prove the tie-break and continuation against genuine PostgreSQL.

This is keyset pagination, not a snapshot token. A run inserted ahead of the
cursor after page one is not returned by that continuation and is observed by
restarting from the first page. A later adapter must document and test
same-timestamp concurrent insertion explicitly; this private contract does not
claim repeatable-read or global creation-sequence authority.

## Store Contract

The captured store receives only a validated page size and validated cursor.
It returns one observation time, at most 100 compact Task-run projection
inputs, and a `hasMore` bit. Each input contains only `runId`, `createdAtMs`,
`runVersion`, and the bounded projected state union. It contains no lifecycle
aggregate, attempt or lease history, diagnostic message, evidence, requested
effect, result body, or other unbounded field. The query decodes every item
with strict `TaskRunListStoreItemSchema` before projection, then validates its
projection-relevant timeline and correlations. Event timestamps must fall
between creation and observation; deadlines may remain in the future but not
precede their owning event; nested retry eligibility and terminal cancellation
resolution must agree with the projected state. The store cannot select a
scope, locator, tenant, database, or authorization identity per request.

The query rejects a store page when:

- it exceeds the requested size;
- the observation, page shape, one bounded item, or its semantic timeline fails
  domain validation;
- entries are not strictly newest-first;
- an entry does not advance beyond the supplied cursor;
- an entry was created after the page observation time; or
- `hasMore` is true without a full nonempty page.

The next cursor is derived from the final validated item only when `hasMore` is
true. The store cannot inject a cursor.

## Projection And Redaction

Each bounded item is projected through the same `projectTaskRunListItem()`
owner used by `projectTaskRun()`, with the page observation time. The list
therefore retains the point projection's freezing and redaction guarantees and
exposes no:

- Application runtime target digest;
- attempt ID, execution fence, heartbeat, or cancellation generation;
- diagnostic message or result body;
- evidence, requested effect, database row, locator, or provider capability.

The returned page and item array are frozen. Items remain the exact existing
`TaskRunProjection` contract; this gate does not create a second list-specific
run model.

## Failure Contract

`TaskRunListQueryError` contains:

- `TaskRunListOptionsError` for an invalid page size or cursor;
- `TaskRunListStoreContractError` for a malformed page from the captured
  capability; and
- `TaskRunListStoreError`, preserved by identity without retry, wrapping, or
  logging.

Input failures occur before store I/O. Projection invariant defects remain
defects, matching the existing point projector.

## Ownership

- `@flarex/durable-task` owns list ordering, cursor contract, page bounds,
  store contract, projection validation, service, and errors;
- `@flarex/standard-application-invocation` owns only the private composition
  bridge;
- a later persistence checkpoint must own SQL, located-scope authorization,
  transaction observation time, narrow JSON/column projection, C-collated
  keyset ordering, row decoding, and database failure mapping;
  and
- `@flarex/application-invocation` will separately own clean options and any
  public opaque cursor representation.

## Validation

Focused proof must cover:

1. page-size and cursor validation before store I/O;
2. strict newest-first order, same-timestamp canonical-ASCII tie-break, and
   exact cursor derivation;
3. continuation after a concurrent newer insert excludes that insert;
4. malformed item structure, impossible item timeline/correlation, order,
   cursor advancement, observation time, and `hasMore` contracts fail safely;
5. store failures preserve identity and are not retried;
6. same run IDs in independently captured stores remain isolated;
7. list items reuse the frozen/redacted point projection; and
8. changing getters cannot swap validated request or page properties; and
9. focused tests, package typechecks, boundary checks, Oxlint gates, and both
   standing reviews pass before commit.

## Stop

Stop after the durable private list contract/service, Standard bridge, tests,
boundary receipt, roadmap updates, validation, review, and commit.

Do not add PostgreSQL/PGlite SQL, migrations, clean `listTaskRuns()`, public
cursor encoding, filters, attempt history, events, live invalidation, routes,
deployment, or production activation in this checkpoint.
