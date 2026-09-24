# Null-index anchor for relational text residuals

Status: selected shared-core query correction under the standing storage goal.

## Trigger and owner

The selected Product Option path established that an indexed scalar equality
can bound a complete candidate set before an unindexed text filter is applied.
The relational compiler still rejects the same residual when its only indexed
conjunct is `isNull(deleted_at)`, even though the shared working set can select
the declared active-row index. This is a shared query-planning defect, not a
Medusa-specific filter rule. Currency supplies a real nullable active-row
index and an unindexed `name` field for a neutral two-driver witness.

## Connected change and boundary

The compiler may defer refusal only when every Boolean branch implies at
least one nullable-field predicate. It marks that the working set must prove
an admitted null-index selection against the actual installed definitions.
The working set rejects the query before reading candidates if no such index
exists. An identity-range fallback, page limit or earlier bounded scan cannot
stand in for the required index. Keep the final residual evaluation against
complete native rows, with pending changes and exact membership validation.

There is no public query, durable data, codec or schema break. Replace the
premature compiler refusal directly; no adapter path or second planner is
retained. Prove matching and nonmatching residuals against pending and committed
Currency rows, index-backed reads, missing-index refusal and unanchored text/OR
refusal on PGlite and ordinary-role PostgreSQL. Run affected
typechecks, lint and both read-only reviews before the scoped commit. The
active-row set remains resource bounded; this does not establish unbounded
count or multi-shop performance.
