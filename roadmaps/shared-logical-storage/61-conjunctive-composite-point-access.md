# Conjunctive Composite Point Access

## Status And Scope

Status: implemented shared correction. This owns recognition
of complete indexed points expressed as conjunctive scalar equalities. It
reuses existing point encoding, readiness, coverage and dependency owners;
it does not add a new index family, migration mechanism or transaction profile.

## Native Failure And Correct Owner

The native absolute Inventory Level update root captures tuple preimages and
then asks the genuine Inventory module to resolve those tuples before updating
actual IDs. The internal lookup rebuilds tuple fields in a different property
order. The shared planner currently selects one equal-cardinality scalar
prefix, despite the existing active composite tuple index.

Ordinary-role PostgreSQL reproduces two failures. Updating the first and third
of three Levels in one Location reads all three Level bodies as dependencies;
native results, mutations and events correctly contain only the first and
third. A missing tuple reads an existing Level for that Item at a different
Location, returns an empty preimage result, and the strict receipt rejects the
extra body before native NOT_FOUND can execute. The query result is not false;
the broad candidate read prevents the intended complete bounded point profile.

The adapter must not rewrite the native query, discard authenticated activity,
relax receipt checks or increase resource limits. Complete compound point access
belongs to the shared relational query planner and its existing selected
metadata/readiness contract.

## Contract And Invariants

Recognize supported singleton scalar equalities joined by AND when they cover
an existing indexed point. Reuse the existing explicit indexed-point path and
record its demand before narrowing selected read metadata. Preserve the full
residual predicate; do not infer equalities across unrelated OR branches or
create an unbounded Cartesian product.

Full-schema preparation records the existing descriptor's column order directly.
Compact read frames first authenticate their existing scalar access facts, then
request the visible descriptor's exact native-point facet before compilation.
Both acquisitions use the existing immutable metadata, coverage and dependency
owners. There is no catalog scan, permutation probing or persisted schema change.
Compact scalar facts expose the first descriptor for each leading-column and
predicate family; a later hidden descriptor retains the existing scalar plan.
This correction does not claim discovery of every overlapping index definition.

Keep empty predicates, contradictory constraints, explicit points, native key
order, encoding, limits, scope fencing and absence/completeness dependencies
under their current owners. Preserve eligible active partial-index priority and
require its null predicate proof. All-row reads cannot borrow active-only
coverage. Unavailable, stale or incomplete point coverage must refuse; no scan
fallback or compatibility bypass is introduced.

Existing int32, binary64, exact numeric and unsupported predicate admissions
remain unchanged. Postgres remains the committed data authority. This changes
relational planning, not Application OCC or the portable Convex developer API.

## Correctness Gates

Neutral PGlite and ordinary-role PostgreSQL cases must prove complete compound
point selection independent of equality property order, bounded ORs of points,
missing-point absence, active and historical rows, residual filtering and stale
coverage refusal. Exercise a broad-prefix neighbor cohort beyond the admitted
row allowance while the requested complete points remain within it.

The genuine native Inventory root must retain its strict four-entry/eight-row
requested-tuple/final-ID union, native duplicate order and NOT_FOUND behavior.
Regress existing point, prefix, partial-index, lifecycle and Inventory consumers.
Hosted activation and populated schema evolution remain separately gated.
