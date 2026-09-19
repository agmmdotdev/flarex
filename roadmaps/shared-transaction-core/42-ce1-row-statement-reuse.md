# Row Batch Statement Reuse Within One Append

Status: implemented within the prepared row owner under standing core-redesign approval.

## Evidence And Decision

The matched bounded row reference performs the same number of scope, revision and
pointer statements as the core. Temporary CPU sampling of the 128-row case places
the largest identified core-specific cost in Drizzle entity classification and
SQL construction. Sampling includes inspector overhead and is attribution, not
timing acceptance; the diagnostic instrumentation is removed.

Reuse compiled revision-insert and first-pointer-insert statements for repeated
batch sizes within one `appendPreparedAppRowRevisionsInTransactionEffect` call.
Keep the existing Drizzle table metadata, codecs, result mapping, constraints and
physical transaction. Do not replace typed DML with a second raw-SQL lowering or
add cross-request/tenant caching to avoid repeated construction.

## Lifetime, Behavior And Cleanup

The operation owns at most 32 shapes for each of its two insert families. Every
execution supplies fresh bindings; no document or scope value is captured in a
statement template. The prepared queries reference only the current transaction
and become unreachable when the append ends. Use Drizzle's empty statement name:
the installed Node driver treats it as unnamed, and PGlite does not retain a
named server statement. No connection-global statement identity is introduced.

Preserve validation and first-failure order, byte/row packing, predecessor reads,
immutable creation times, exact returned identities, conditional pointer updates,
typed query failures, interruption masking and whole-operation rollback. Updates
and predecessor queries keep their existing construction until separately justified.
Prepared execution begins inside the existing masked driver boundary. Query
construction and pure bindings remain outside driver failure classification;
the query helper accepts a deferred execution function to avoid starting a
prepared query before that boundary takes ownership.
No public API, durable format/schema, lock, authority or migration changes.
Delete the displaced per-batch insert construction; retain no alternative writer.

## Completion Gates

Prove repeated equal-sized batches bind distinct identities and values, including
live/tombstone changes, nullable predecessors and large exact sequences, with no
cross-operation/scope retention. Preserve malformed-return, late-batch rollback,
creation-time and current-pointer conflict witnesses on PGlite and ordinary-role
PostgreSQL. Run the independent reference, actual native/CMS consumers, affected
types and lint, both final reviews and exact staged checks.

Compare isolated matched row samples before/after with SQL counts held constant;
do not claim observer-neutral timing or attribute a whole-request gain. If reuse
does not improve its declared repeated-batch workload, remove it. Keep complete
request reference and wider execution/capacity gates open. Stop owned resources
and commit only after validation, review and cleanup.
