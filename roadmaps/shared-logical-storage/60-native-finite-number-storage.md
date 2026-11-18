# Native Finite Number Storage

## Status And Scope

Status: implemented private shared correction. This owns finite
binary64 relational values and defaults, generic framework lowering and both
logical and retained physical storage. Populated schema evolution and hosted
activation remain separately gated.

## Failure And Correct Owner

Pinned Medusa InventoryItem dimensions use DML `number()`. Executing the genuine
Inventory service, Drizzle repository, SQLite schema and serializer preserves
fractional dimensions and values beyond signed int32, including `1.25`,
`2147483648`, `-2147483649`, `9007199254740991` and `1e30`. SQLite INTEGER affinity
does not impose the adapter's signed int32 restriction.

The existing Medusa lowering selects relational `integer`, whose shared value
contract deliberately enforces int32. Native finite dimensions therefore cannot
round-trip through the admitted store. Narrowing dimensions, rounding input or
representing binary64 as exact decimal strings would change native behavior.
The correction belongs to relational representation and storage, with generic
DML lowering in the framework adapter.

## Contract And Invariants

Add `doublePrecision` and `doublePrecisionLiteral` for finite JavaScript numbers.
Retain int32 `integer` and exact-decimal `numeric` unchanged. Reject NaN and
infinity at input, stored-row and default boundaries. Normalize signed zero to
positive zero for equality and index identity. Reuse the existing ordered
float64 codec for ordinary and unique access rather than authoring a second
encoding. This does not add numeric query filters or binary64 aggregates.

Logical rows, defaults, index requirements and value admission share the
protocol representation. The retained physical Commerce owner uses PostgreSQL
`double precision`, with matching bind/read, catalog validation and default
attestation. Physical support exists for its current consumer obligation; it
does not displace the accepted shared logical storage destination.

## Source Admission And Durable Data

Generic DML `number` lowering changes canonical definitions and source hashes.
Existing full-definition/evidence admission and stable initialization receipts
must refuse stale source identities before ordinary callbacks. Do not reinterpret
populated integer rows under the changed definition, silently reinstall, reset,
convert or recreate durable data. The
[deferred schema evolution owner](./deferred-framework-schema-evolution.md)
retains those migration obligations.

## Compatibility And Correctness Gates

Application Convex value encoding already distinguishes numeric runtime values;
this relational representation does not change Application OCC or its public
developer model. Framework-owned DML remains responsible for selecting the
representation. Postgres remains the only committed data authority.

Neutral protocol and both-driver storage proofs must cover fractions, large
finite values, subnormals, extrema, negative zero, defaults, cold catalog reopen,
ordering, uniqueness, invalid values, replay and stale source refusal. Preserve
explicit int32 witnesses when native DML expectations change. The connected
Inventory Item update and affected Currency/Product consumers must retain their
native result, event, settlement and constraint behavior.
