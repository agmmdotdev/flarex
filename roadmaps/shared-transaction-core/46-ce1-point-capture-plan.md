# Cardinality-Aware Current Capture

Status: implemented under standing core approval; broader performance acceptance
remains open.

## Outcome And Evidence

The bounded capture contract is correct, but its complete-request comparison
did not establish a latency improvement. Exact point absence checks in CMS
inserts currently construct and execute the same aggregate CTE plan as scans.
The current-pointer primary key and exact revision join already bound a point
selection to zero or one row. Use that physical invariant at the shared row
owner instead of paying for a set aggregate on every point lookup.

## Decision And Boundaries

For an explicit, validated `rowId`, select the pointer and joined revision in
one statement. Compute the budget verdict from the identity ceiling and the
single revision's byte length. Project `valueBytes` through SQL CASE so an
over-budget body never crosses the driver; preserve the column's byte decoder.
An absent point returns an empty set even when the identity ceiling is zero.
A present point, including a tombstone, exceeds a zero identity ceiling.

Batch and scan selection retain bounded aggregation, including an array with
one requested identity. Selection semantics choose the SQL shape; there is no
fallback engine, adapter cache, new capability or configurable fast path.
Both shapes feed the same fresh-clock validation, error mapping, canonical
decoding, tombstone and dangling/future-pointer checks. Transaction isolation,
scope exclusion, sequence allocation and physical settlement remain unchanged.

Alternatives: reverting to two statements loses the single-snapshot budget/body
contract; gating after JavaScript decoding violates transfer bounds; removing
the fresh clock or assuming random insert IDs are absent weakens correctness.
Keep the common capture contract and specialize only where schema-enforced
cardinality proves the aggregate unnecessary.

## Breaks, Cleanup And Completion

No public API, observer name, durable format or data migration changes. Replace
the aggregate point execution path in place; do not retain it as an optional
implementation. Existing consumers continue through the shared row owner.

The complete local point-heavy insertion lane showed lower measured latency
with unchanged SQL counts after removing point aggregation. Candidate observer
calibration passed; one baseline workload exceeded the calibration threshold.
These sequential local samples support this plan choice, not a general speedup,
batch/scan improvement, large-catalog access guarantee or capacity claim.

Extend both-driver semantic and PostgreSQL transport witnesses to point
identity/byte refusals, zero-budget absence, exact byte limits, tombstones and
all corruption cases. Retain existing batch/scan and CMS/Payload regressions.
Measure the unchanged complete active-request lane and preserve slower samples
and calibration failures. Fewer SQL statements or a simpler plan alone is not
acceptance of latency, large-catalog or production-capacity claims.

Run affected types, lint, both project reviews, clean up and commit one coherent
slice. Keep broader CE0 reference and CE3 concurrency gates open.
