# Matched Bounded Row-Store Reference

Status: implemented test-only bounded row-store comparison. Complete-request
reference and wider CE0 acceptance remain open.

## Outcome And Contract

The core row owner batches first revisions, while the existing CE0 SQL reference
still performs three statements per row. Replace that scalar reference with an
independently written bounded SQL implementation of the same admitted first-live-
revision profile. Preserve one scope lookup, at most 32 rows and 256 KiB of
document bytes per statement group, with a single larger document permitted up
to the core's 8 MiB ceiling. Parameter counts stay bounded by the row ceiling.

Both candidates use factory-produced canonical documents, one scope/epoch/commit,
the same generic physical families and the same physical transaction owner.
Validate complete returned identities independently of row order. Missing scope,
duplicate first identity, incomplete revision/pointer writes and late failures
must roll back every batch. No local catch may commit a prefix.

The existing protocol codecs and error definitions are common; SQL construction,
batching and returned-set checks are independently implemented. Production must
not import the reference. This comparison includes differences in driver binding,
validation and SQL construction and does not isolate ORM overhead. Native OCC,
indexes/constraints, application authority, publication/replay and complete-request
equivalence remain separate CE0 requirements.

## Owners, Breaks And Cleanup

Replace the test-only scalar reference API and its caller loop rather than keep
two candidates. No production API, schema, codec, lock order or durable data change
is required. Keep the existing physical runner, ordinary-role PostgreSQL fixture,
environment provenance and aggregate observation owner. Do not introduce another
transaction runner, reference engine or production bypass.

## Completion Gates

Retain existing scope refusal, duplicate, rollback and two-connection contention
witnesses. Add 0/1/31/32/33/64/65 row boundaries, byte-driven splitting and an
oversized singleton; prove duplicate failure in a later batch rolls back its
earlier prefix. Use real PostgreSQL triggers to suppress or alter returned rows
and require complete rollback for both candidates. Check exact durable state and
query scaling before timing. Refresh alternating paired measurements at the
existing sizes, labeling both candidates as instrumented and bounded-batch.

Run existing PGlite row-batch semantics and focused ordinary-role PostgreSQL
reference witnesses, affected typecheck/lint, both reviews and staged checks.
Remove scalar names/claims, reconcile owning notes, stop owned resources and
commit. Do not claim a full-request ratio, capacity or completed CE0 acceptance.
