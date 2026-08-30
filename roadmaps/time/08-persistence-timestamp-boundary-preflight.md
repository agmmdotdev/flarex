# Persistence Timestamp Boundary Preflight

Status: PTIME01 implementation complete; real PostgreSQL acceptance pending.

## Scope

This package-only gate covers two narrow timestamp boundaries in
`@flarex/persistence-postgres`:

- the implicit `updated_at` value used when an existing live-query
  subscription is updated without an explicit timestamp; and
- the exact duplicate driver timestamp normalization in the application-action
  authority row decoder.

It does not change `apps`, schemas or migrations, executor clocks, legacy
PartitionDO behavior, lease or expiry policy, timestamp column precision,
stored-state acceptance, or the existing uses of `current_timestamp` and
`clock_timestamp()` elsewhere in persistence.

## Authority Contract

PostgreSQL owns the implicit live-query subscription timestamp. Inserts already
use the column's database default. Conflict updates now use
`current_timestamp`, so the omitted-input path has one database authority and
inherits the surrounding transaction timestamp. An explicit `updatedAt`
remains caller-supplied evidence and is passed through unchanged.

This gate deliberately does not replace `current_timestamp` with
`clock_timestamp()`. The former is stable within a transaction; changing that
choice would alter observable transaction semantics and requires a separate
owner decision.

## Driver Codec Contract

`databaseTimestampFromUnknown` remains the persistence-local representation
normalizer for timestamps returned by supported drivers. It copies a finite
same-realm `Date`, accepts a JavaScript-parseable string, and returns `null` for
unsupported or invalid values.

The application-action authority now delegates its duplicate mechanics to
that helper and retains its local `undefined` projection and existing typed
failure mapping. Validation order, permissive string parsing, Date copying,
and public failure behavior are unchanged.

`liveQueryConnections.dateField` is intentionally retained. Its accepted
input shape overlaps the shared helper, but it returns an incoming `Date` by
identity and owns an exact throwing error message. Replacing it would be a
compatibility change rather than mechanical codec consolidation.

## Acceptance Gate

- PGlite and real-PostgreSQL regressions must prove an omitted conflict-update
  timestamp equals the surrounding transaction timestamp after JavaScript wall
  time has advanced.
- Existing explicit-timestamp live-query coverage must remain green.
- The application-action authority's focused tests and package validation must
  remain green.
- Real PostgreSQL is required before PTIME01 can be marked accepted because the
  gate changes transaction-clock semantics.
